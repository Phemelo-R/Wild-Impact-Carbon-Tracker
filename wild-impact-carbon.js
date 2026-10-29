'use strict';

// Wild Impact-specific adaptation of the Les Hyperion Carbon Tracker.
// Reference datasets are bundled locally so that this copy has no dependency on the Les Hyperion repository.
const WILD_IMPACT_DATA_ROOT = './data/';
const WILD_IMPACT_STORAGE_KEY = 'wild-impact-carbon-tracker-v1';
const WILD_IMPACT_CUSTOM_AIRCRAFT = 'Unlisted aircraft — documented estimate';

const elementById = (id) => document.getElementById(id);
const normaliseText = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const formatNumber = (value, decimals = 2) => Number(value || 0).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const safeDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
const financialYear = (date) => 'FY' + String(Number(date.slice(0, 4)) + (Number(date.slice(5, 7)) >= 7 ? 1 : 0)).slice(-2);

const showToast = (message) => {
  const toast = elementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window.wildImpactToastTimer);
  window.wildImpactToastTimer = setTimeout(() => toast.classList.remove('show'), 3600);
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const loadWildImpactReference = async () => {
  const sourceFiles = [
    'airport-reference.json',
    'aircraft-reference.json',
    'airline-reference.json',
    'landscape-reference.json',
    'flight-configurations.json',
    'icao-legacy-fuel-curves.json',
    'icao-v13-fuel-curves.json',
  ];
  const responseData = await Promise.all(sourceFiles.map(async (fileName) => {
    const response = await fetch(WILD_IMPACT_DATA_ROOT + fileName);
    if (!response.ok) throw new Error('Could not load ' + fileName + '.');
    return response.json();
  }));

  const [airportFile, aircraftCatalogue, operatorCatalogue, landscapeCatalogue, configurationCatalogue, legacyFuel, v13Fuel] = responseData;
  const combinedCurves = {
    ...Object.fromEntries(Object.entries(v13Fuel.curves).map(([icaoCode, values]) => [icaoCode, values.map((value, index) => [legacyFuel.stages[index], value])])),
    ...legacyFuel.curves,
  };

  return {
    airports: airportFile.airports,
    aircraft: aircraftCatalogue,
    operators: operatorCatalogue,
    landscapes: landscapeCatalogue,
    configurations: configurationCatalogue,
    legacyCurves: Object.keys(legacyFuel.curves).filter((code) => code !== '295'),
    curves: combinedCurves,
  };
};

loadWildImpactReference().then((carbonData) => {
  startWildImpactTracker(carbonData);
}).catch((error) => {
  const statusBox = elementById('app-status');
  statusBox.classList.add('error');
  statusBox.textContent = 'The tracker could not load its reference data. Check your internet connection and reload the page. ' + error.message;
  console.error('Wild Impact Carbon Tracker:', error);
});

const startWildImpactTracker = (carbonData) => {
  const airportLookup = new Map(carbonData.airports.map((airport) => [airport.code, airport]));
  let activeMode = 'flight';
  let routeMode = 'domestic';
  let editingRecord = null;
  let deletedRecord = null;
  let flightCharts = {};
  let bikeCharts = {};
  let boatCharts = {};
  let records = [];

  const currentValue = (id) => elementById(id).value.trim();
  const numericValue = (id) => elementById(id).value === '' ? NaN : Number(elementById(id).value);
  const currentAirport = (id) => {
    const code = currentValue(id).split(' — ')[0].toUpperCase();
    return airportLookup.get(code) || carbonData.airports.find((airport) => airport.icao === code);
  };
  const currentLandscape = (id) => carbonData.landscapes.find((landscape) => landscape.name === currentValue(id));
  const airportLabel = (airport) => `${airport.code} — ${airport.name} · ${airport.city || airport.country} · ${airport.country}`;
  const countryName = (code) => carbonData.airports.find((airport) => airport.countryCode === code)?.country || code;

  const persistence = {
    load() {
      try {
        const raw = localStorage.getItem(WILD_IMPACT_STORAGE_KEY);
        records = raw ? JSON.parse(raw).entries || [] : [];
      } catch (error) {
        records = [];
        elementById('storage-status').textContent = 'Browser storage unavailable';
      }
    },
    save() {
      try {
        localStorage.setItem(WILD_IMPACT_STORAGE_KEY, JSON.stringify({ schema: 'wild-impact-carbon', version: 1, entries: records, exportedAt: new Date().toISOString() }));
        elementById('storage-status').textContent = `Saved locally · ${records.length} records`;
        return true;
      } catch (error) {
        elementById('storage-status').textContent = 'Storage full or unavailable';
        return false;
      }
    },
  };

  const haversineDistance = (fromAirport, toAirport) => {
    const radians = Math.PI / 180;
    const haversine = Math.sin(((toAirport.lat - fromAirport.lat) * radians) / 2) ** 2 + Math.cos(fromAirport.lat * radians) * Math.cos(toAirport.lat * radians) * Math.sin(((toAirport.lon - fromAirport.lon) * radians) / 2) ** 2;
    return 6371.0088 * 2 * Math.atan2(Math.sqrt(Math.min(1, haversine)), Math.sqrt(Math.max(0, 1 - haversine)));
  };

  const interpolateFuel = (curve, stage) => {
    if (!curve || curve.length < 2) return null;
    let upperIndex = curve.findIndex((point) => point[0] >= stage);
    if (upperIndex <= 0) upperIndex = upperIndex === -1 ? curve.length - 1 : 1;
    const lowerPoint = curve[upperIndex - 1];
    const upperPoint = curve[upperIndex];
    return {
      fuel: Math.max(0, lowerPoint[1] + ((upperPoint[1] - lowerPoint[1]) * (stage - lowerPoint[0])) / (upperPoint[0] - lowerPoint[0])),
      range: stage < curve[0][0] ? 'below table' : stage > curve[curve.length - 1][0] ? 'above table' : 'within table',
    };
  };

  const routeAllocation = (fromAirport, toAirport) => {
    const regions = [fromAirport.region, toAirport.region].sort();
    const pair = regions.join('-');
    const domestic = fromAirport.countryCode === toAirport.countryCode;
    if (domestic && fromAirport.region === 'SSA') return { load: 0.7112, cargo: 0.8441, name: 'Sub-Saharan Africa domestic', source: 'ICAO v9 Appendix A' };
    if (pair === 'SSA-SSA') return { load: 0.654, cargo: 0.8441, name: 'Intra Sub-Saharan Africa', source: 'ICAO v9 Appendix A' };
    const legacy = { EUR: [0.7831, 0.8216], NAM: [0.7693, 0.9074], MEA: [0.732, 0.8309], SAM: [0.6458, 0.8441], NAF: [0.654, 0.8441], PSEA: [0.7308, 0.839], NAS: [0.7308, 0.839], SWA: [0.7308, 0.839] };
    const otherRegion = regions.find((region) => region !== 'SSA');
    if (regions.includes('SSA') && legacy[otherRegion]) return { load: legacy[otherRegion][0], cargo: legacy[otherRegion][1], name: otherRegion + ' / Sub-Saharan Africa', source: 'ICAO v9 Appendix A' };
    const regionalGroups = {
      'NAF-PSEA': [0.737, 0.8382], 'NAF-NAS': [0.737, 0.8382], 'NAF-SWA': [0.737, 0.8382], 'MEA-NAF': [0.741, 0.8292], 'NAF-NAM': [0.771, 0.9111],
      'CAM-NAF': [0.779, 0.8403], 'CAM-SSA': [0.779, 0.8403], 'CAM-MEA': [0.779, 0.8403], 'NAF-SAM': [0.65, 0.8397], 'MEA-SAM': [0.65, 0.8397],
      'CAM-EUR': [0.817, 0.8657], 'CAM-NAM': [0.807, 0.9317], 'CAM-SAM': [0.797, 0.8942], 'EUR-SWA': [0.815, 0.6343], 'CAM-SWA': [0.803, 0.8445],
      'SAM-SWA': [0.803, 0.8445], 'MEA-SWA': [0.789, 0.8118], 'NAM-SWA': [0.833, 0.6238], 'NAS-SWA': [0.712, 0.7947], 'PSEA-SWA': [0.748, 0.8012],
      'EUR-MEA': [0.745, 0.7719], 'EUR-NAF': [0.736, 0.8199], 'EUR-NAM': [0.831, 0.7996], 'EUR-NAS': [0.8, 0.6343], 'EUR-PSEA': [0.802, 0.6343],
      'EUR-SAM': [0.849, 0.7669], 'NAF-NAF': [0.661, 0.8432], 'CAM-CAM': [0.677, 0.9609], 'SWA-SWA': [0.698, 0.7947], 'EUR-EUR': [0.823, 0.9612],
      'MEA-MEA': [0.702, 0.8456], 'NAM-NAM': [0.791, 0.9335], 'NAS-NAS': [0.753, 0.7947], 'PSEA-PSEA': [0.778, 0.7947], 'SAM-SAM': [0.771, 0.8266],
      'CAM-NAS': [0.729, 0.8467], 'CAM-PSEA': [0.729, 0.8467], 'NAS-SAM': [0.729, 0.8467], 'PSEA-SAM': [0.729, 0.8467], 'MEA-NAM': [0.839, 0.7989],
      'MEA-NAS': [0.765, 0.8118], 'MEA-PSEA': [0.765, 0.8118], 'NAM-NAS': [0.823, 0.6644], 'NAM-PSEA': [0.809, 0.8457], 'NAM-SAM': [0.826, 0.7727], 'NAS-PSEA': [0.753, 0.7947],
    };
    const selectedGroup = regionalGroups[pair];
    if (!selectedGroup) throw new Error('No supported regional allocation for this route.');
    return { load: selectedGroup[0], cargo: selectedGroup[1], name: pair + (domestic ? ' (regional domestic average)' : ''), source: 'ICAO v13.1 Appendix A' };
  };

  const isWideBody = (aircraftName) => /Boeing (747|767|777|787)|Airbus A(300|330|340|350|380)/.test(aircraftName);
  const availableLayouts = (airlineName, aircraftName) => {
    const published = carbonData.configurations.profiles.filter((profile) => profile.operator.toLowerCase() === airlineName.trim().toLowerCase() && profile.aircraft === aircraftName);
    const aircraft = carbonData.aircraft[aircraftName];
    if (!aircraft) return [];
    const weightGroup = isWideBody(aircraftName) ? 'widebody' : 'regional';
    const factors = aircraft.seats < 60 ? { economy: 1 } : carbonData.configurations.weights[weightGroup];
    const fallback = { id: 'reference', label: 'Aircraft-type estimate · airline layout unverified', aircraft: aircraftName, operator: airlineName, equivalentSeats: aircraft.seats, factors, weightGroup, cabins: null, status: 'Aircraft-type estimate', source: 'Retained aircraft reference; airline seating unverified' };
    return [...published, fallback];
  };
  const cabinLabels = { economy: 'Economy', premium: 'Premium Economy', business: 'Business', first: 'First' };
  const cabinOrder = ['economy', 'premium', 'business', 'first'];
  const calculateAllocation = () => {
    const airline = currentValue('flight-airline');
    const aircraftName = currentValue('flight-aircraft');
    const layout = availableLayouts(airline, aircraftName).find((profile) => profile.id === currentValue('flight-layout'));
    if (!layout) throw new Error('Choose the aircraft and seating layout.');
    const weights = layout.factors || carbonData.configurations.weights[layout.weightGroup];
    const availableCabins = cabinOrder.filter((cabin) => layout.cabins ? layout.cabins[cabin] > 0 : weights[cabin] > 0);
    const selectedCabin = currentValue('flight-cabin');
    if (!availableCabins.includes(selectedCabin)) throw new Error('Choose a cabin available in this layout.');
    const seatEquivalents = layout.cabins ? Object.entries(layout.cabins).reduce((sum, [cabin, seats]) => sum + seats * weights[cabin], 0) : layout.equivalentSeats;
    return {
      seats: seatEquivalents,
      cabin: weights[selectedCabin],
      cabinKey: selectedCabin,
      cabinLabel: cabinLabels[selectedCabin],
      layoutId: layout.id,
      layoutLabel: layout.label,
      physicalSeats: layout.cabins ? Object.values(layout.cabins).reduce((sum, count) => sum + count, 0) : null,
      cabinSeats: layout.cabins || null,
      cabinWeights: weights,
      layoutSource: layout.source,
      layoutStatus: layout.status,
    };
  };

  const calculateFlight = (input) => {
    if (!input.from || !input.to) throw new Error('Choose recognised departure and arrival airports from the search results.');
    if (input.from.code === input.to.code) throw new Error('Departure and arrival must differ.');
    if (!Number.isInteger(input.passengers) || input.passengers < 1 || input.passengers > 500) throw new Error('Enter between 1 and 500 traveller names.');
    if (!input.aircraft || !Number.isFinite(input.seats) || input.seats < 1 || !Number.isFinite(input.cabin) || input.cabin < .1) throw new Error('Check the aircraft and cabin allocation.');
    const distance = haversineDistance(input.from, input.to);
    const detour = distance < 550 ? 50 : distance <= 5500 ? 100 : 125;
    const nauticalMiles = (distance + detour) / 1.852;
    const fuelCurve = interpolateFuel(carbonData.curves[input.aircraft.icao], nauticalMiles);
    const allocation = routeAllocation(input.from, input.to);
    if (!fuelCurve && !(Number.isFinite(input.manualKg) && input.manualKg > 0 && input.manualSource)) throw new Error('This aircraft needs a documented CO₂ estimate per passenger.');
    const perPassenger = fuelCurve ? ((fuelCurve.fuel * 3.16 * allocation.cargo) / (input.seats * allocation.load)) * input.cabin : input.manualKg;
    return {
      distance, detour, billableDistance: distance + detour, nauticalMiles, fuel: fuelCurve?.fuel ?? null, range: fuelCurve?.range ?? 'manual', allocation,
      perPassenger, emissionsKg: perPassenger * input.passengers, domestic: input.from.countryCode === input.to.countryCode,
    };
  };

  const calculateBike = (input) => {
    if (!safeDate(input.start) || !safeDate(input.end) || input.end < input.start) throw new Error('Enter a valid recording period.');
    if (input.start.slice(0, 7) !== input.end.slice(0, 7)) throw new Error('Keep each e-bike record within one calendar month.');
    if (!Number.isFinite(input.distance) || input.distance <= 0) throw new Error('Distance must be positive.');
    if (![input.intensity, input.gridFactor, input.baselineFactor, input.substitution].every(Number.isFinite) || input.intensity <= 0 || input.gridFactor < 0 || input.baselineFactor <= 0 || input.substitution < 0 || input.substitution > 100) throw new Error('Check the project factors.');
    let gridShare = input.gridShare;
    if (input.charging === 'auto') {
      if (input.start < '2025-04-01') throw new Error('Before April 2025, choose the actual charging source.');
      gridShare = input.end < '2025-09-01' ? 100 : 0;
    } else if (input.charging === 'grid') gridShare = 100;
    else if (input.charging === 'solar') gridShare = 0;
    if (!Number.isFinite(gridShare) || gridShare < 0 || gridShare > 100) throw new Error('Grid share must be between 0 and 100%.');
    if (input.measured !== null && (!Number.isFinite(input.measured) || input.measured < 0)) throw new Error('Measured electricity must be zero or positive.');
    const energy = input.measured === null ? input.distance * input.intensity : input.measured;
    const baselineKg = input.distance * input.baselineFactor * input.substitution / 100;
    const emissionsKg = energy * gridShare / 100 * input.gridFactor;
    return { energy, gridShare, baselineKg, emissionsKg, savedKg: baselineKg - emissionsKg };
  };

  const initialiseDateInputs = () => {
    const today = todayIso();
    elementById('flight-date').value = today;
    elementById('bike-start').value = today;
    elementById('bike-end').value = today;
  };

  const fillLandscapes = () => {
    for (const id of ['flight-landscape', 'bike-landscape']) {
      elementById(id).replaceChildren(...carbonData.landscapes.map((landscape) => {
        const option = document.createElement('option');
        option.value = landscape.name;
        option.textContent = `${landscape.name} · ${landscape.country}`;
        return option;
      }));
    }
    elementById('flight-landscape').value = 'Head Office — Sandton';
    elementById('bike-landscape').value = 'Masai Mara';
  };

  const countryOptions = () => {
    const countries = [...new Map(carbonData.airports.map((airport) => [airport.countryCode, airport.country])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    for (const id of ['departure-country', 'arrival-country', 'airline-country']) {
      elementById(id).replaceChildren(new Option('All countries', ''));
      for (const [code, name] of countries) elementById(id).append(new Option(name, code));
    }
    elementById('departure-country').value = 'ZA';
    elementById('arrival-country').value = '';
  };

  const chooseRouteMode = (mode) => {
    routeMode = mode;
    elementById('domestic-mode').classList.toggle('active', mode === 'domestic');
    elementById('international-mode').classList.toggle('active', mode === 'international');
    elementById('international-country-row').hidden = mode !== 'international';
    if (mode === 'domestic') elementById('arrival-country').value = elementById('departure-country').value;
    renderFlightCalculation();
  };

  const searchableItems = (inputId, items, formatter) => {
    const input = elementById(inputId);
    const resultsBox = elementById(inputId + '-results');
    const show = () => {
      const query = normaliseText(input.value);
      const matches = items().filter((item) => formatter.search(item).includes(query));
      resultsBox.replaceChildren();
      const count = document.createElement('p');
      count.className = 'search-count';
      count.textContent = `${Math.min(matches.length, 25)} of ${matches.length.toLocaleString('en-GB')} matches`;
      resultsBox.append(count);
      matches.slice(0, 25).forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'search-result';
        const heading = document.createElement('strong');
        heading.textContent = formatter.heading(item);
        const detail = document.createElement('span');
        detail.textContent = formatter.detail(item);
        button.append(heading, detail);
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => {
          input.value = formatter.value(item);
          resultsBox.hidden = true;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        resultsBox.append(button);
      });
      resultsBox.hidden = matches.length === 0;
    };
    input.addEventListener('focus', show);
    input.addEventListener('input', show);
    document.addEventListener('click', (event) => { if (!resultsBox.contains(event.target) && event.target !== input) resultsBox.hidden = true; });
    return { refresh: show };
  };

  const airportItems = (fieldName) => {
    const country = routeMode === 'domestic' ? currentValue('departure-country') : currentValue(fieldName === 'from' ? 'departure-country' : 'arrival-country');
    return carbonData.airports.filter((airport) => !country || airport.countryCode === country);
  };
  const airlineItems = () => carbonData.operators.filter((operator) => !currentValue('airline-country') || operator.countryCode === currentValue('airline-country'));

  searchableItems('flight-from', () => airportItems('from'), {
    search: (airport) => normaliseText([airport.code, airport.icao, airport.name, airport.city, airport.country].join(' ')),
    heading: (airport) => `${airport.code} · ${airport.name}`,
    detail: (airport) => `${airport.city || airport.country} · ${airport.country} · ICAO ${airport.icao}`,
    value: airportLabel,
  });
  searchableItems('flight-to', () => airportItems('to'), {
    search: (airport) => normaliseText([airport.code, airport.icao, airport.name, airport.city, airport.country].join(' ')),
    heading: (airport) => `${airport.code} · ${airport.name}`,
    detail: (airport) => `${airport.city || airport.country} · ${airport.country} · ICAO ${airport.icao}`,
    value: airportLabel,
  });
  searchableItems('flight-airline', airlineItems, {
    search: (operator) => normaliseText(operator.name + ' ' + countryName(operator.countryCode)),
    heading: (operator) => operator.name,
    detail: (operator) => countryName(operator.countryCode),
    value: (operator) => operator.name,
  });

  const chooseAircraft = (preserve = true) => {
    const select = elementById('flight-aircraft');
    const previous = currentValue('flight-aircraft');
    const selectedOperator = carbonData.operators.find((operator) => normaliseText(operator.name) === normaliseText(currentValue('flight-airline')));
    const models = selectedOperator?.aircraft?.length && !elementById('show-all-aircraft').checked ? [...selectedOperator.aircraft, WILD_IMPACT_CUSTOM_AIRCRAFT] : Object.keys(carbonData.aircraft);
    select.replaceChildren(new Option('Choose aircraft used on ticket', ''), ...models.sort().map((name) => new Option(carbonData.curves[carbonData.aircraft[name]?.icao] ? name : `${name} — documented estimate`, name)));
    if (preserve && models.includes(previous)) select.value = previous;
    chooseLayouts(true);
  };

  const chooseLayouts = (preserve = true) => {
    const layoutSelect = elementById('flight-layout');
    const previous = currentValue('flight-layout');
    const layouts = availableLayouts(currentValue('flight-airline'), currentValue('flight-aircraft'));
    layoutSelect.replaceChildren(...layouts.map((layout) => new Option(layout.label, layout.id)));
    if (preserve && layouts.some((layout) => layout.id === previous)) layoutSelect.value = previous;
    chooseCabins(true);
  };

  const chooseCabins = (preserve = true) => {
    const cabinSelect = elementById('flight-cabin');
    const previous = currentValue('flight-cabin');
    const layouts = availableLayouts(currentValue('flight-airline'), currentValue('flight-aircraft'));
    const selectedLayout = layouts.find((layout) => layout.id === currentValue('flight-layout'));
    const weights = selectedLayout ? (selectedLayout.factors || carbonData.configurations.weights[selectedLayout.weightGroup]) : {};
    const choices = cabinOrder.filter((cabin) => selectedLayout?.cabins ? selectedLayout.cabins[cabin] > 0 : weights[cabin] > 0);
    cabinSelect.replaceChildren(...choices.map((cabin) => new Option(cabinLabels[cabin], cabin)));
    if (preserve && choices.includes(previous)) cabinSelect.value = previous;
    if (choices.length && !choices.includes(previous)) cabinSelect.value = choices[0];
    renderFlightCalculation();
  };

  const populateDefaultFlightRoute = () => {
    const office = carbonData.landscapes.find((landscape) => landscape.name === 'Head Office — Sandton');
    const defaultFrom = office && airportLookup.get(office.airport) ? airportLookup.get(office.airport) : airportLookup.get('JNB');
    if (defaultFrom) elementById('flight-from').value = airportLabel(defaultFrom);
    const defaultTo = airportLookup.get('CPT');
    if (defaultTo) elementById('flight-to').value = airportLabel(defaultTo);
    chooseAircraft(false);
    chooseRouteMode('domestic');
  };

  const renderFlightCalculation = () => {
    const resultBox = elementById('flight-result');
    const breakdownBox = elementById('flight-breakdown');
    const names = currentValue('flight-names').split(/[\n;]+/).map((name) => name.trim()).filter(Boolean);
    elementById('passenger-count').textContent = `${names.length} ${names.length === 1 ? 'passenger' : 'passengers'}`;
    try {
      const allocation = calculateAllocation();
      const aircraft = carbonData.aircraft[currentValue('flight-aircraft')];
      const from = currentAirport('flight-from');
      const to = currentAirport('flight-to');
      const result = calculateFlight({ from, to, aircraft, seats: allocation.seats, cabin: allocation.cabin, passengers: names.length, curves: carbonData.curves, manualKg: numericValue('manual-flight-kg'), manualSource: currentValue('manual-flight-source') });
      resultBox.innerHTML = `<strong>${formatNumber(result.emissionsKg / 1000, 3)} <small>tCO₂</small></strong>`;
      breakdownBox.innerHTML = [
        ['Route', `${from.code} → ${to.code}`], ['Distance', `${formatNumber(result.distance, 0)} km`], ['Estimated fuel', result.fuel === null ? 'Documented estimate' : `${formatNumber(result.fuel, 1)} kg`], ['Passengers', names.length], ['Cabin', `${allocation.cabinLabel} · ${formatNumber(allocation.cabin, 2)}×`], ['Allocation', `${formatNumber(allocation.seats, 2)} economy-equivalent seats`], ['Curve range', result.range],
      ].map(([label, value]) => `<div class="calculation-item"><span>${label}</span><strong>${value}</strong></div>`).join('');
      elementById('flight-error').textContent = '';
    } catch (error) {
      resultBox.textContent = error.message;
      breakdownBox.innerHTML = '';
    }
  };

  const bikeInputs = () => {
    const distanceMode = currentValue('bike-distance-mode');
    const distance = distanceMode === 'odometer' ? numericValue('bike-closing') - numericValue('bike-opening') : numericValue('bike-distance');
    return {
      start: currentValue('bike-start'), end: currentValue('bike-end'), distance,
      intensity: numericValue('bike-energy-intensity'), gridFactor: numericValue('bike-grid-factor'), baselineFactor: numericValue('bike-baseline-factor'), substitution: numericValue('bike-substitution'), charging: currentValue('bike-charging'), gridShare: numericValue('bike-grid-share'), measured: currentValue('bike-measured') === '' ? null : numericValue('bike-measured'),
    };
  };

  const renderBikeCalculation = () => {
    const input = bikeInputs();
    elementById('bike-odometer-fields').hidden = currentValue('bike-distance-mode') !== 'odometer';
    elementById('bike-distance-fields').hidden = currentValue('bike-distance-mode') === 'odometer';
    elementById('bike-grid-share-field').hidden = currentValue('bike-charging') !== 'mixed';
    try {
      const result = calculateBike(input);
      elementById('bike-result').innerHTML = `<strong>${formatNumber(result.savedKg)} <small>kg avoided</small></strong><div>${formatNumber(result.baselineKg > 0 ? (result.savedKg / result.baselineKg) * 100 : 0, 1)}% reduction against the selected baseline</div>`;
      elementById('bike-breakdown').innerHTML = [['Distance', `${formatNumber(input.distance, 1)} km`], ['Electricity', `${formatNumber(result.energy, 2)} kWh`], ['Grid share', `${formatNumber(result.gridShare, 0)}%`], ['Boda-boda baseline', `${formatNumber(result.baselineKg)} kg`], ['Charging emissions', `${formatNumber(result.emissionsKg)} kg`]].map(([label, value]) => `<div class="calculation-item"><span>${label}</span><strong>${value}</strong></div>`).join('');
      elementById('bike-error').textContent = '';
    } catch (error) {
      elementById('bike-result').textContent = error.message;
      elementById('bike-breakdown').innerHTML = '';
    }
  };

  const boatInputs = () => ({
    date: currentValue('boat-date'), landscape: currentValue('boat-landscape'), vessel: currentValue('boat-vessel'),
    activity: currentValue('boat-activity'), site: currentValue('boat-site'), skipper: currentValue('boat-skipper'),
    guide: currentValue('boat-guide'), started: currentValue('boat-start-time'), ended: currentValue('boat-end-time'),
    engineHours: currentValue('boat-engine-hours') === '' ? null : numericValue('boat-engine-hours'),
    pax: currentValue('boat-pax') === '' ? null : numericValue('boat-pax'),
    group: currentValue('boat-group'), engines: currentValue('boat-engines'), notes: currentValue('boat-notes'),
    petrolLitres: currentValue('boat-petrol') === '' ? null : numericValue('boat-petrol'),
  });

  const renderBoatCalculation = () => {
    const resultBox = elementById('boat-result');
    const breakdownBox = elementById('boat-breakdown');
    if (currentValue('boat-petrol') === '') {
      resultBox.textContent = 'Enter petrol used to calculate emissions.';
      breakdownBox.replaceChildren();
      elementById('boat-error').textContent = '';
      return;
    }
    try {
      const result = WildImpactBoat.calculate(numericValue('boat-petrol'));
      resultBox.innerHTML = `<strong>${formatNumber(result.co2eKg, 2)} <small>kg CO₂e</small></strong>`;
      breakdownBox.innerHTML = [
        ['Total boat petrol', `${formatNumber(result.petrolLitres, 2)} L`],
        ['CO₂', `${formatNumber(result.co2Kg, 2)} kg`],
        ['CH₄', `${formatNumber(result.ch4Kg, 4)} kg`],
        ['N₂O', `${formatNumber(result.n2oKg, 5)} kg`],
        ['CO₂e', `${formatNumber(result.co2eKg, 2)} kg`],
        ['Combustion factor', `${WildImpactBoat.factors.co2e} kg CO₂e/L · UK ${WildImpactBoat.factors.year}`],
      ].map(([label, value]) => `<div class="calculation-item"><span>${label}</span><strong>${value}</strong></div>`).join('');
      elementById('boat-error').textContent = '';
    } catch (error) {
      resultBox.textContent = error.message;
      breakdownBox.replaceChildren();
    }
  };

  const saveBoat = () => {
    const input = boatInputs();
    if (!safeDate(input.date)) throw new Error('Choose a valid journey date.');
    if (!input.landscape || !input.vessel || !input.site || !input.activity) throw new Error('Enter landscape, vessel, site and activity.');
    if (input.engineHours !== null && (!Number.isFinite(input.engineHours) || input.engineHours < 0 || input.engineHours > 48)) throw new Error('Enter valid engine hours or leave them blank.');
    if (input.pax !== null && (!Number.isInteger(input.pax) || input.pax < 0)) throw new Error('Passenger count must be a whole number.');
    if ((input.started && !input.ended) || (!input.started && input.ended)) throw new Error('Enter both start and end times, or leave both blank.');
    const emissions = WildImpactBoat.calculate(input.petrolLitres);
    const record = {
      ...input,
      id: editingRecord?.mode === 'boat' ? editingRecord.id : (globalThis.crypto?.randomUUID?.() ?? Date.now() + '-' + Math.random().toString(36).slice(2)),
      mode: 'boat', name: input.vessel,
      emissionsKg: emissions.co2eKg, co2Kg: emissions.co2Kg, co2eKg: emissions.co2eKg,
      factorYear: emissions.factorYear, fuelFactorCode: 'UK-DESNZ-2026-PETROL-100-MINERAL',
      updatedAt: new Date().toISOString(),
    };
    records = records.filter((item) => item.id !== record.id);
    records.unshift(record);
    persistence.save();
    clearBoatForm();
    refresh();
    showToast('Boat journey saved.');
  };

  const clearBoatForm = () => {
    editingRecord = null;
    elementById('boat-form').reset();
    elementById('boat-date').value = todayIso();
    elementById('boat-landscape').value = 'Benguerra, Mozambique';
    elementById('boat-vessel').value = 'Chissumba';
    elementById('boat-engines').value = '2 × Suzuki DF80A · petrol · 58.8 kW each';
    elementById('boat-cancel').hidden = true;
    elementById('boat-error').textContent = '';
    renderBoatCalculation();
  };

  const boatGasKeys = { co2e: 'co2eKg', co2: 'co2Kg', ch4: 'ch4Kg', n2o: 'n2oKg' };
  const boatGasNames = { co2e: 'CO₂e', co2: 'CO₂', ch4: 'CH₄', n2o: 'N₂O' };
  const currentBoatGas = () => currentValue('boat-gas') || 'co2e';
  const boatGasValue = (record, gas = currentBoatGas()) => {
    // Old boat backups without factor snapshots are reproducible using their recorded litres.
    const calculated = WildImpactBoat.calculate(record.petrolLitres);
    return calculated[boatGasKeys[gas]];
  };
  const filteredBoatRecords = () => records.filter((record) => record.mode === 'boat'
    && (!currentValue('boat-site-filter') || normaliseText(record.site) === currentValue('boat-site-filter'))
    && (!currentValue('boat-activity-filter') || normaliseText(record.activity) === currentValue('boat-activity-filter')));

  const updateBoatFilterOptions = () => {
    for (const [field, key, label] of [['boat-site-filter', 'site', 'All sites'], ['boat-activity-filter', 'activity', 'All activities']]) {
      const select = elementById(field);
      const selected = select.value;
      const uniqueValues = new Map();
      records.filter((record) => record.mode === 'boat').forEach((record) => {
        const value = String(record[key] || '').trim();
        if (value && !uniqueValues.has(normaliseText(value))) uniqueValues.set(normaliseText(value), value);
      });
      const choices = [...uniqueValues.entries()].sort((a,b) => a[1].localeCompare(b[1]));
      select.replaceChildren(new Option(label, ''), ...choices.map(([value, name]) => new Option(name, value)));
      select.value = choices.some(([value]) => value === selected) ? selected : '';
    }
    for (const [id, key] of [['boat-site-options', 'site'], ['boat-activity-options', 'activity'], ['boat-skipper-options', 'skipper'], ['boat-guide-options', 'guide'], ['boat-vessel-options', 'vessel'], ['boat-landscape-options', 'landscape']]) {
      const unique = [...new Set(records.filter((record) => record.mode === 'boat').map((record) => record[key]).filter(Boolean))];
      if (id === 'boat-vessel-options') unique.push('Chissumba');
      if (id === 'boat-landscape-options') unique.push('Benguerra, Mozambique');
      if (id === 'boat-activity-options') unique.push('Dive', 'Transfer', 'BRUVS', 'Sardinha');
      elementById(id).replaceChildren(...[...new Set(unique)].sort().map((value) => new Option(value, value)));
    }
  };

  const updateBoatSummary = () => {
    const subset = filteredBoatRecords();
    const litres = subset.reduce((total, record) => total + Number(record.petrolLitres || 0), 0);
    const hours = subset.reduce((total, record) => total + Number(record.engineHours || 0), 0);
    const gas = currentBoatGas();
    const totalKg = subset.reduce((total, record) => total + boatGasValue(record, gas), 0);
    const isMinorGas = gas === 'ch4' || gas === 'n2o';
    const unit = isMinorGas ? `kg ${boatGasNames[gas]}` : `t ${boatGasNames[gas]}`;
    elementById('boat-emissions-label').textContent = `Filtered ${boatGasNames[gas]}`;
    elementById('boat-total-emissions').textContent = formatNumber(isMinorGas ? totalKg : totalKg / 1000, isMinorGas ? 4 : 3);
    elementById('boat-total-unit').textContent = unit;
    elementById('boat-total-petrol').textContent = formatNumber(litres, 1);
    elementById('boat-total-hours').textContent = formatNumber(hours, 1);
    elementById('boat-total-journeys').textContent = formatNumber(subset.length, 0);
    elementById('boat-filter-status').textContent = `${subset.length} of ${records.filter((record) => record.mode === 'boat').length} boat journeys shown. Chart values are physical kg of the selected gas (CO₂e is kg CO₂-equivalent).`;
  };

  const drawBoatCharts = () => {
    const subset = filteredBoatRecords();
    const gas = currentBoatGas();
    const title = boatGasNames[gas];
    ['boat-month-chart-unit', 'boat-site-chart-unit', 'boat-activity-chart-unit'].forEach((id) => elementById(id).textContent = `kg ${title}`);
    const accumulate = (key) => {
      const totals = new Map();
      subset.forEach((record) => { const value = key === 'month' ? record.date.slice(0, 7) : String(record[key] || 'Unspecified').trim(); totals.set(value, (totals.get(value) || 0) + boatGasValue(record, gas)); });
      return [...totals.entries()];
    };
    const months = accumulate('month').sort((a,b) => a[0].localeCompare(b[0]));
    const sites = accumulate('site').sort((a,b) => b[1] - a[1]);
    const activities = accumulate('activity').sort((a,b) => b[1] - a[1]);
    const options = () => ({ ...chartBaseOptions(), plugins: { ...chartBaseOptions().plugins, legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: chartTextColour() } }, y: { beginAtZero: true, grid: { color: chartGridColour() }, ticks: { color: chartTextColour() }, title: { display: true, text: `kg ${title}`, color: chartTextColour() } } } });
    boatCharts.month = new Chart(elementById('boat-month-chart'), { type: 'bar', data: { labels: months.map(([name]) => name), datasets: [{ label: `kg ${title}`, data: months.map(([, amount]) => amount), backgroundColor: '#ff4a00', borderRadius: 3, maxBarThickness: 52 }] }, options: options() });
    boatCharts.site = new Chart(elementById('boat-site-chart'), { type: 'bar', data: { labels: sites.map(([name]) => name), datasets: [{ label: `kg ${title}`, data: sites.map(([, amount]) => amount), backgroundColor: '#667b6d', borderRadius: 3 }] }, options: { ...options(), indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { color: chartTextColour() }, grid: { color: chartGridColour() } }, y: { grid: { display: false }, ticks: { color: chartTextColour() } } } } });
    boatCharts.activity = new Chart(elementById('boat-activity-chart'), { type: 'bar', data: { labels: activities.map(([name]) => name), datasets: [{ label: `kg ${title}`, data: activities.map(([, amount]) => amount), backgroundColor: '#c9a75c', borderRadius: 3, maxBarThickness: 60 }] }, options: options() });
  };

  const refreshStorageStatus = () => {
    try { elementById('storage-status').textContent = `Saved locally · ${records.length} records`; } catch (error) {}
  };

  const aggregateMonths = (mode) => {
    const filteredRecords = records.filter((record) => record.mode === mode);
    const months = new Map();
    for (const record of filteredRecords) {
      const month = record.date.slice(0, 7);
      if (!months.has(month)) months.set(month, { distance: 0, flightKg: 0, baselineKg: 0, chargingKg: 0, savedKg: 0 });
      const monthly = months.get(month);
      monthly.distance += Number(record.distance || 0);
      if (mode === 'flight') monthly.flightKg += Number(record.emissionsKg || 0);
      if (mode === 'ebike') {
        monthly.baselineKg += Number(record.baselineKg || 0);
        monthly.chargingKg += Number(record.emissionsKg || 0);
        monthly.savedKg += Number(record.savedKg || 0);
      }
    }
    return [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };

  const destroyCharts = () => {
    Object.values(flightCharts).forEach((chart) => chart?.destroy());
    Object.values(bikeCharts).forEach((chart) => chart?.destroy());
    Object.values(boatCharts).forEach((chart) => chart?.destroy());
    flightCharts = {};
    bikeCharts = {};
    boatCharts = {};
  };

  const chartTextColour = () => getComputedStyle(document.body).color || '#000000';
  const chartGridColour = () => '#deddd7';
  const chartBaseOptions = () => ({ responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: chartTextColour(), font: { family: 'Montserrat', size: 10 } } }, tooltip: { bodyFont: { family: 'Montserrat' }, titleFont: { family: 'Montserrat' } } } });

  const drawFlightCharts = () => {
    const monthData = aggregateMonths('flight');
    const labels = monthData.map(([month]) => month);
    const totalByLandscape = new Map();
    records.filter((record) => record.mode === 'flight').forEach((record) => totalByLandscape.set(record.landscape, (totalByLandscape.get(record.landscape) || 0) + Number(record.emissionsKg || 0)));
    const colours = ['#ff4a00', '#667b6d', '#c9a75c', '#EEE1D4', '#a75546', '#8b9b92', '#e38b5e', '#4e6860'];
    flightCharts.bar = new Chart(elementById('flight-bar-chart'), { type: 'bar', data: { labels, datasets: [{ label: 'Flight CO₂', data: monthData.map(([, total]) => total.flightKg / 1000), backgroundColor: '#ff4a00', borderRadius: 2, maxBarThickness: 46 }] }, options: { ...chartBaseOptions(), scales: { x: { grid: { display: false }, ticks: { color: chartTextColour() } }, y: { beginAtZero: true, grid: { color: chartGridColour() }, ticks: { color: chartTextColour() }, title: { display: true, text: 'tCO₂', color: chartTextColour() } } } } });
    const landscapeLabels = [...totalByLandscape.keys()].sort((a, b) => totalByLandscape.get(b) - totalByLandscape.get(a));
    flightCharts.pie = new Chart(elementById('flight-pie-chart'), { type: 'pie', data: { labels: landscapeLabels, datasets: [{ data: landscapeLabels.map((label) => totalByLandscape.get(label) / 1000), backgroundColor: landscapeLabels.map((_, index) => colours[index % colours.length]), borderWidth: 2, borderColor: '#ffffff' }] }, options: { ...chartBaseOptions(), plugins: { ...chartBaseOptions().plugins, legend: { position: 'bottom', labels: { color: chartTextColour(), boxWidth: 10, font: { family: 'Montserrat', size: 10 } } } } } });
  };

  const drawBikeCharts = () => {
    const monthData = aggregateMonths('ebike');
    const labels = monthData.map(([month]) => month);
    let cumulative = 0;
    const cumulativeValues = monthData.map(([, total]) => { cumulative += total.savedKg / 1000; return cumulative; });

    bikeCharts.distanceSaved = new Chart(elementById('bike-distance-saved-chart'), { data: { labels, datasets: [
      { type: 'bar', label: 'Distance travelled', data: monthData.map(([, total]) => total.distance), backgroundColor: '#EEE1D4', borderRadius: 2, maxBarThickness: 48, yAxisID: 'distance', order: 10 },
      { type: 'line', label: 'CO₂ saved', data: monthData.map(([, total]) => total.savedKg / 1000), borderColor: '#ff4a00', backgroundColor: '#ff4a00', pointBackgroundColor: '#ff4a00', pointBorderColor: '#ffffff', pointBorderWidth: 2, pointRadius: 5, pointHoverRadius: 7, borderWidth: 3, tension: .18, yAxisID: 'saved', order: 0 },
    ] }, type: 'bar', options: { ...chartBaseOptions(), scales: {
      x: { grid: { display: false }, ticks: { color: chartTextColour() } },
      distance: { beginAtZero: true, position: 'left', grid: { color: chartGridColour() }, ticks: { color: chartTextColour() }, title: { display: true, text: 'Distance (km)', color: chartTextColour() } },
      saved: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: chartTextColour() }, title: { display: true, text: 'CO₂ saved (t)', color: chartTextColour() } },
    } } });

    bikeCharts.emissions = new Chart(elementById('bike-emissions-chart'), { type: 'line', data: { labels, datasets: [
      { label: 'Boda-boda baseline', data: monthData.map(([, total]) => total.baselineKg / 1000), borderColor: '#a75546', backgroundColor: '#a75546', pointRadius: 3, tension: .18 },
      { label: 'Charging emissions', data: monthData.map(([, total]) => total.chargingKg / 1000), borderColor: '#c9a75c', backgroundColor: '#c9a75c', pointRadius: 3, tension: .18 },
    ] }, options: { ...chartBaseOptions(), scales: { x: { grid: { display: false }, ticks: { color: chartTextColour() } }, y: { beginAtZero: true, grid: { color: chartGridColour() }, ticks: { color: chartTextColour() }, title: { display: true, text: 'tCO₂', color: chartTextColour() } } } } });

    bikeCharts.cumulative = new Chart(elementById('bike-cumulative-chart'), { type: 'line', data: { labels, datasets: [{ label: 'Cumulative CO₂ saved', data: cumulativeValues, borderColor: '#ff4a00', backgroundColor: 'rgba(255,74,0,.08)', fill: true, pointRadius: 3, tension: .18 }] }, options: { ...chartBaseOptions(), scales: { x: { grid: { display: false }, ticks: { color: chartTextColour() } }, y: { beginAtZero: true, grid: { color: chartGridColour() }, ticks: { color: chartTextColour() }, title: { display: true, text: 'Cumulative tCO₂ saved', color: chartTextColour() } } } } });
  };

  const drawCurrentCharts = () => {
    destroyCharts();
    const hasRecords = activeMode === 'boat' ? filteredBoatRecords().length > 0 : records.some((record) => record.mode === activeMode);
    elementById('chart-empty').hidden = hasRecords;
    elementById('chart-empty').textContent = activeMode === 'boat' && records.some((record) => record.mode === 'boat') ? 'No boat trips match the selected filters.' : 'Save records to populate these figures.';
    if (!hasRecords || typeof Chart === 'undefined') return;
    if (activeMode === 'flight') drawFlightCharts();
    else if (activeMode === 'ebike') drawBikeCharts();
    else if (activeMode === 'boat') drawBoatCharts();
  };

  const renderSummary = () => {
    const flights = records.filter((record) => record.mode === 'flight');
    const bikes = records.filter((record) => record.mode === 'ebike');
    const sum = (items, key) => items.reduce((total, item) => total + Number(item[key] || 0), 0);
    elementById('flight-total-tonnes').textContent = formatNumber(sum(flights, 'emissionsKg') / 1000, 3);
    elementById('flight-total-legs').textContent = formatNumber(flights.length, 0);
    elementById('flight-total-passengers').textContent = formatNumber(sum(flights, 'passengers'), 0);
    elementById('flight-total-distance').textContent = formatNumber(sum(flights, 'distance'), 0);
    elementById('bike-total-electric').textContent = formatNumber(sum(bikes, 'emissionsKg') / 1000, 3);
    elementById('bike-total-saved').textContent = formatNumber(sum(bikes, 'savedKg') / 1000, 3);
    elementById('bike-total-distance').textContent = formatNumber(sum(bikes, 'distance'), 0);
    elementById('bike-total-records').textContent = formatNumber(bikes.length, 0);
    elementById('flight-summary').hidden = activeMode !== 'flight';
    elementById('bike-summary').hidden = activeMode !== 'ebike';
    elementById('boat-summary').hidden = activeMode !== 'boat';
    updateBoatSummary();
  };

  const renderRecords = () => {
    const query = normaliseText(currentValue('record-search'));
    const recordsForMode = records.filter((record) => record.mode === activeMode && normaliseText([record.name, record.landscape, record.from, record.to, record.airline, record.aircraft, record.registration, record.site, record.activity, record.skipper, record.guide, record.notes].join(' ')).includes(query)).sort((a, b) => b.date.localeCompare(a.date));
    const head = elementById('records-head');
    const body = elementById('records-body');
    if (activeMode === 'flight') {
      head.innerHTML = '<tr><th>Date</th><th>Traveller(s)</th><th>Landscape</th><th>Route / aircraft / cabin</th><th>Distance</th><th>Emissions</th><th>Actions</th></tr>';
      body.innerHTML = recordsForMode.length ? recordsForMode.map((record) => `<tr><td>${record.date}<br><span class="field-help">${financialYear(record.date)}</span></td><td>${escapeHtml(record.name)}</td><td>${escapeHtml(record.landscape)}</td><td>${escapeHtml(record.from)} → ${escapeHtml(record.to)}<br><span class="field-help">${escapeHtml(record.aircraft)} · ${escapeHtml(record.cabinLabel)}</span></td><td>${formatNumber(record.distance, 0)} km</td><td>${formatNumber(record.emissionsKg)} kg</td><td><button class="table-action" data-edit="${record.id}">Edit</button><button class="table-action" data-delete="${record.id}">Delete</button></td></tr>`).join('') : '<tr><td colspan="7">No flight records yet.</td></tr>';
    } else if (activeMode === 'boat') {
      head.innerHTML = '<tr><th>Date / hours</th><th>Site / activity</th><th>Boat / crew</th><th>Passengers</th><th>Fuel (L)</th><th>CO₂ (kg)</th><th>CO₂e (kg)</th><th>Actions</th></tr>';
      body.innerHTML = recordsForMode.length ? recordsForMode.map((record) => `<tr><td>${escapeHtml(record.date)}<br><span class="field-help">${escapeHtml([record.started, record.ended].filter(Boolean).join('–'))}${record.engineHours !== null && record.engineHours !== undefined ? ` · ${formatNumber(record.engineHours, 2)} engine h` : ''}</span></td><td>${escapeHtml(record.site)}<br><span class="field-help">${escapeHtml(record.activity)} · ${escapeHtml(record.landscape)}</span></td><td>${escapeHtml(record.vessel)}<br><span class="field-help">${escapeHtml([record.skipper, record.guide].filter(Boolean).join(' / '))}</span></td><td>${record.pax ?? '—'}</td><td>${formatNumber(record.petrolLitres, 2)}</td><td>${formatNumber(boatGasValue(record, 'co2'), 2)}</td><td>${formatNumber(boatGasValue(record, 'co2e'), 2)}</td><td><button class="table-action" data-edit="${escapeHtml(record.id)}">Edit</button><button class="table-action" data-delete="${escapeHtml(record.id)}">Delete</button></td></tr>`).join('') : '<tr><td colspan="8">No boat journeys recorded yet.</td></tr>';
    } else {
      head.innerHTML = '<tr><th>Period</th><th>Ranger</th><th>Landscape</th><th>Motorcycle</th><th>Distance</th><th>Charging</th><th>Avoided</th><th>Actions</th></tr>';
      body.innerHTML = recordsForMode.length ? recordsForMode.map((record) => `<tr><td>${record.start} – ${record.end}</td><td>${escapeHtml(record.name)}</td><td>${escapeHtml(record.landscape)}</td><td>${escapeHtml(record.registration)}</td><td>${formatNumber(record.distance, 1)} km</td><td>${formatNumber(record.emissionsKg)} kg</td><td>${formatNumber(record.savedKg)} kg</td><td><button class="table-action" data-edit="${record.id}">Edit</button><button class="table-action" data-delete="${record.id}">Delete</button></td></tr>`).join('') : '<tr><td colspan="8">No e-bike records yet.</td></tr>';
    }
    elementById('record-status').textContent = `${recordsForMode.length} ${activeMode === 'flight' ? 'flight' : activeMode === 'boat' ? 'boat' : 'e-bike'} records shown.`;
  };

  const refresh = () => {
    refreshStorageStatus();
    updateBoatFilterOptions();
    renderSummary();
    renderRecords();
    drawCurrentCharts();
    const bikes = records.filter((record) => record.mode === 'ebike');
    elementById('ranger-options').replaceChildren(...[...new Set(bikes.map((record) => record.name).filter(Boolean))].map((name) => new Option(name, name)));
    elementById('registration-options').replaceChildren(...[...new Set(bikes.map((record) => record.registration).filter(Boolean))].map((name) => new Option(name, name)));
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[character]);

  const saveFlight = () => {
    const names = currentValue('flight-names').split(/[\n;]+/).map((name) => name.trim()).filter(Boolean);
    const from = currentAirport('flight-from');
    const to = currentAirport('flight-to');
    if (!safeDate(currentValue('flight-date'))) throw new Error('Choose a valid flight date.');
    if (!currentLandscape('flight-landscape')) throw new Error('Choose a landscape or programme.');
    if (!from || !to) throw new Error('Choose both airports from the search results.');
    if (routeMode === 'domestic' && (from.countryCode !== currentValue('departure-country') || to.countryCode !== currentValue('departure-country'))) throw new Error('Both airports must be in the selected domestic country.');
    if (routeMode === 'international' && from.countryCode === to.countryCode) throw new Error('The airports are in the same country. Use Domestic for this leg.');
    if (new Set(names.map(normaliseText)).size !== names.length) throw new Error('A traveller appears twice. Check the names.');
    const allocation = calculateAllocation();
    const aircraft = carbonData.aircraft[currentValue('flight-aircraft')];
    const result = calculateFlight({ from, to, aircraft, seats: allocation.seats, cabin: allocation.cabin, passengers: names.length, curves: carbonData.curves, manualKg: numericValue('manual-flight-kg'), manualSource: currentValue('manual-flight-source') });
    const record = {
      id: editingRecord?.id || (globalThis.crypto?.randomUUID?.() ?? Date.now() + '-' + Math.random().toString(36).slice(2)), mode: 'flight', date: currentValue('flight-date'), name: names.join('; '), names, landscape: currentValue('flight-landscape'), airline: currentValue('flight-airline'), aircraft: currentValue('flight-aircraft'), customAircraft: currentValue('flight-aircraft') === WILD_IMPACT_CUSTOM_AIRCRAFT ? currentValue('custom-aircraft') : '', cabinKey: allocation.cabinKey, cabinLabel: allocation.cabinLabel, layoutId: allocation.layoutId, layoutLabel: allocation.layoutLabel, passengers: names.length, from: from.code, to: to.code, distance: result.distance, detour: result.detour, emissionsKg: result.emissionsKg, perPassenger: result.perPassenger, fuel: result.fuel, updatedAt: new Date().toISOString(),
    };
    records = records.filter((item) => item.id !== record.id);
    records.unshift(record);
    persistence.save();
    editingRecord = null;
    elementById('flight-cancel').hidden = true;
    refresh();
    showToast('Flight record saved.');
  };

  const saveBike = () => {
    const input = bikeInputs();
    const place = currentLandscape('bike-landscape');
    if (!currentValue('bike-ranger') || !currentValue('bike-registration')) throw new Error('Enter the ranger / recorder and motorcycle ID.');
    if (!place) throw new Error('Choose a landscape or programme.');
    if (input.distance <= 0) throw new Error('Distance must be positive.');
    if ((input.intensity !== .0405 || input.gridFactor !== .226 || Math.abs(input.baselineFactor - (2.075 / 45.5) * 1.28) > 1e-12 || input.substitution !== 100 || place.countryCode !== 'KE') && !currentValue('bike-factor-note')) throw new Error('Add a source or explanation for changed assumptions or use outside the default Masai Mara model.');
    const overlap = records.find((record) => record.mode === 'ebike' && record.id !== editingRecord?.id && normaliseText(record.registration) === normaliseText(currentValue('bike-registration')) && record.start <= input.end && record.end >= input.start);
    if (overlap) throw new Error('This motorcycle already has a record overlapping these dates. Edit the existing record or use another period.');
    const result = calculateBike(input);
    const record = {
      id: editingRecord?.id || (globalThis.crypto?.randomUUID?.() ?? Date.now() + '-' + Math.random().toString(36).slice(2)), mode: 'ebike', date: input.end, start: input.start, end: input.end, name: currentValue('bike-ranger'), registration: currentValue('bike-registration'), landscape: place.name, distance: input.distance, charging: input.charging, gridShare: result.gridShare, energy: result.energy, energyIntensity: input.intensity, gridFactor: input.gridFactor, baselineFactor: input.baselineFactor, substitution: input.substitution, emissionsKg: result.emissionsKg, baselineKg: result.baselineKg, savedKg: result.savedKg, measured: input.measured, factorNote: currentValue('bike-factor-note'), note: currentValue('bike-note'), updatedAt: new Date().toISOString(),
    };
    records = records.filter((item) => item.id !== record.id);
    records.unshift(record);
    persistence.save();
    editingRecord = null;
    elementById('bike-cancel').hidden = true;
    refresh();
    showToast('E-bike record saved.');
  };

  const clearFlightForm = () => {
    editingRecord = null;
    elementById('flight-date').value = todayIso();
    elementById('flight-names').value = '';
    elementById('flight-landscape').value = 'Head Office — Sandton';
    elementById('flight-airline').value = '';
    elementById('flight-aircraft').value = '';
    elementById('flight-cabin').replaceChildren();
    elementById('flight-layout').replaceChildren();
    elementById('custom-aircraft').value = '';
    elementById('manual-flight-kg').value = '';
    elementById('manual-flight-source').value = '';
    elementById('flight-cancel').hidden = true;
    elementById('flight-error').textContent = '';
    populateDefaultFlightRoute();
    renderFlightCalculation();
  };

  const clearBikeForm = () => {
    editingRecord = null;
    elementById('bike-start').value = todayIso();
    elementById('bike-end').value = todayIso();
    elementById('bike-ranger').value = '';
    elementById('bike-registration').value = '';
    elementById('bike-landscape').value = 'Masai Mara';
    elementById('bike-distance').value = '';
    elementById('bike-opening').value = '';
    elementById('bike-closing').value = '';
    elementById('bike-charging').value = 'auto';
    elementById('bike-measured').value = '';
    elementById('bike-factor-note').value = '';
    elementById('bike-note').value = '';
    elementById('bike-cancel').hidden = true;
    elementById('bike-error').textContent = '';
    renderBikeCalculation();
  };

  const editRecord = (record) => {
    editingRecord = record;
    if (record.mode === 'flight') {
      activeMode = 'flight';
      switchMode('flight');
      elementById('flight-date').value = record.date;
      elementById('flight-names').value = (record.names || record.name.split('; ')).join('\n');
      elementById('flight-landscape').value = record.landscape;
      const from = airportLookup.get(record.from);
      const to = airportLookup.get(record.to);
      elementById('flight-from').value = from ? airportLabel(from) : record.from;
      elementById('flight-to').value = to ? airportLabel(to) : record.to;
      const sameCountry = from && to && from.countryCode === to.countryCode;
      elementById('departure-country').value = from?.countryCode || 'ZA';
      elementById('arrival-country').value = to?.countryCode || '';
      chooseRouteMode(sameCountry ? 'domestic' : 'international');
      elementById('flight-airline').value = record.airline;
      elementById('airline-country').value = '';
      chooseAircraft(true);
      elementById('flight-aircraft').value = record.aircraft;
      chooseLayouts(false);
      elementById('flight-layout').value = record.layoutId;
      chooseCabins(false);
      elementById('flight-cabin').value = record.cabinKey;
      elementById('custom-aircraft').value = record.customAircraft || '';
      elementById('flight-cancel').hidden = false;
      renderFlightCalculation();
      elementById('flight-view').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (record.mode === 'boat') {
      switchMode('boat');
      for (const [field, key] of [['boat-date','date'], ['boat-landscape','landscape'], ['boat-vessel','vessel'], ['boat-activity','activity'], ['boat-site','site'], ['boat-skipper','skipper'], ['boat-guide','guide'], ['boat-start-time','started'], ['boat-end-time','ended'], ['boat-engine-hours','engineHours'], ['boat-pax','pax'], ['boat-group','group'], ['boat-engines','engines'], ['boat-notes','notes'], ['boat-petrol','petrolLitres']]) elementById(field).value = record[key] ?? '';
      elementById('boat-cancel').hidden = false;
      renderBoatCalculation();
      elementById('boat-view').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      switchMode('ebike');
      elementById('bike-start').value = record.start;
      elementById('bike-end').value = record.end;
      elementById('bike-ranger').value = record.name;
      elementById('bike-registration').value = record.registration;
      elementById('bike-landscape').value = record.landscape;
      elementById('bike-distance-mode').value = 'distance';
      elementById('bike-distance').value = record.distance;
      elementById('bike-charging').value = record.charging;
      elementById('bike-grid-share').value = record.gridShare;
      elementById('bike-energy-intensity').value = record.energyIntensity;
      elementById('bike-grid-factor').value = record.gridFactor;
      elementById('bike-baseline-factor').value = record.baselineFactor;
      elementById('bike-substitution').value = record.substitution;
      elementById('bike-measured').value = record.measured ?? '';
      elementById('bike-factor-note').value = record.factorNote || '';
      elementById('bike-note').value = record.note || '';
      elementById('bike-cancel').hidden = false;
      renderBikeCalculation();
      elementById('ebike-view').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const populateRecommendationCountries = () => {
    const countryNames = new Map(carbonData.airports.map((airport) => [airport.countryCode, airport.country]));
    const operatorCodes = [...new Set(carbonData.operators.map((operator) => operator.countryCode))];
    const countries = operatorCodes.map((code) => [code, countryNames.get(code) || code]).sort((a, b) => a[1].localeCompare(b[1]));
    const select = elementById('recommendation-country');
    select.replaceChildren(...countries.map(([code, name]) => new Option(name, code)));
    select.value = countries.some(([code]) => code === 'ZA') ? 'ZA' : countries[0]?.[0] || '';
    renderAirlineRecommendations();
  };

  const renderAirlineRecommendations = () => {
    const selectedCountry = currentValue('recommendation-country');
    const standardDistanceKm = 1000;
    const standardFlightNauticalMiles = (standardDistanceKm + 100) / 1.852;
    const operatorScores = carbonData.operators.filter((operator) => operator.countryCode === selectedCountry).map((operator) => {
      const aircraftScores = (operator.aircraft || []).map((aircraftName) => {
        const aircraft = carbonData.aircraft[aircraftName];
        if (!aircraft || !aircraft.seats || !carbonData.curves[aircraft.icao]) return null;
        const fuelEstimate = interpolateFuel(carbonData.curves[aircraft.icao], standardFlightNauticalMiles);
        if (!fuelEstimate || !Number.isFinite(fuelEstimate.fuel) || fuelEstimate.fuel <= 0) return null;
        return { aircraftName, kgPerPassengerKm: (fuelEstimate.fuel * 3.16 * 0.85) / (aircraft.seats * 0.8 * standardDistanceKm) };
      }).filter(Boolean);
      if (!aircraftScores.length) return null;
      return { name: operator.name, score: aircraftScores.reduce((sum, aircraft) => sum + aircraft.kgPerPassengerKm, 0) / aircraftScores.length, aircraftCount: aircraftScores.length, aircraft: aircraftScores.sort((a, b) => a.kgPerPassengerKm - b.kgPerPassengerKm) };
    }).filter(Boolean).sort((a, b) => a.score - b.score).slice(0, 5);

    const target = elementById('airline-recommendations');
    if (!operatorScores.length) {
      target.innerHTML = '<p>No operators in this country have aircraft with supported fuel curves in the current reference data.</p>';
      return;
    }
    const bestScore = operatorScores[0].score;
    target.innerHTML = operatorScores.map((operator, index) => {
      const aircraftSummary = operator.aircraft.slice(0, 3).map((aircraft) => aircraft.aircraftName).join(', ');
      const moreAircraft = operator.aircraft.length > 3 ? ` + ${operator.aircraft.length - 3} more` : '';
      const comparison = index === 0 ? 'Lowest modelled estimate in this country' : `${formatNumber(((operator.score / bestScore) - 1) * 100, 0)}% above the lowest estimate`;
      return `<article class="recommendation-item"><div class="recommendation-rank">${index + 1}</div><div><strong>${escapeHtml(operator.name)}</strong><p>${escapeHtml(aircraftSummary + moreAircraft)}</p><p>${comparison} · ${operator.aircraftCount} supported aircraft model${operator.aircraftCount === 1 ? '' : 's'}</p></div><div class="recommendation-value">${formatNumber(operator.score, 4)}<small>kg CO₂ / passenger-km</small></div></article>`;
    }).join('');
  };

  const switchMode = (mode) => {
    activeMode = mode;
    const recommendations = mode === 'recommendations';
    elementById('flight-view').hidden = mode !== 'flight';
    elementById('ebike-view').hidden = mode !== 'ebike';
    elementById('boat-view').hidden = mode !== 'boat';
    elementById('recommendations-view').hidden = !recommendations;
    elementById('summary-section').hidden = recommendations;
    elementById('figures-section').hidden = recommendations;
    elementById('records-section').hidden = recommendations;
    elementById('methods-section').hidden = recommendations;
    elementById('flight-figures').hidden = mode !== 'flight';
    elementById('bike-figures').hidden = mode !== 'ebike';
    elementById('boat-figures').hidden = mode !== 'boat';
    if (!recommendations) {
      elementById('summary-title').textContent = mode === 'flight' ? 'Flight totals' : mode === 'boat' ? 'Boat totals' : 'E-bike totals';
      elementById('figures-title').textContent = mode === 'flight' ? 'Flight footprint' : mode === 'boat' ? 'Boat footprint' : 'E-bike impact';
      elementById('records-title').textContent = mode === 'flight' ? 'Flight records' : mode === 'boat' ? 'Boat records' : 'E-bike records';
      elementById('record-search').placeholder = mode === 'flight' ? 'Search travellers, routes, airlines…' : mode === 'boat' ? 'Search boats, sites, activities, skippers…' : 'Search rangers, registrations…';
    }
    document.querySelectorAll('.transport-tab[data-mode]').forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === mode));
    if (!recommendations) {
      renderSummary();
      renderRecords();
      drawCurrentCharts();
    }
  };

  const exportWorkbook = () => {
    if (typeof XLSX === 'undefined') throw new Error('Excel export library unavailable.');

    const flightRecords = records
      .filter((record) => record.mode === 'flight')
      .sort((a, b) => a.date.localeCompare(b.date));
    const bikeRecords = records
      .filter((record) => record.mode === 'ebike')
      .sort((a, b) => a.date.localeCompare(b.date));
    const boatRecords = records.filter((record) => record.mode === 'boat').sort((a, b) => a.date.localeCompare(b.date));

    const gridShareForRecord = (record) => {
      if (record.charging === 'grid') return 100;
      if (record.charging === 'solar') return 0;
      if (record.charging === 'mixed') return Number(record.gridShare ?? 0);
      if (record.charging === 'auto') return String(record.end || record.date) < '2025-09-01' ? 100 : 0;
      return Number(record.gridShare ?? 0);
    };

    const calculatedBikeValues = (record) => {
      const distance = Number(record.distance || 0);
      const intensity = Number(record.energyIntensity ?? record.intensity ?? 0);
      const measured = record.measured === null || record.measured === undefined || record.measured === '' ? null : Number(record.measured);
      const energy = measured === null ? distance * intensity : measured;
      const baselineFactor = Number(record.baselineFactor || 0);
      const substitution = Number(record.substitution || 0);
      const baselineKg = distance * baselineFactor * substitution / 100;
      const gridShare = gridShareForRecord(record);
      const gridFactor = Number(record.gridFactor || 0);
      const chargingKg = energy * gridShare / 100 * gridFactor;
      const savedKg = baselineKg - chargingKg;
      return { distance, intensity, measured, energy, baselineKg, gridShare, chargingKg, savedKg };
    };

    const monthSet = new Set([
      ...flightRecords.map((record) => record.date.slice(0, 7)),
      ...bikeRecords.map((record) => record.date.slice(0, 7)),
      ...boatRecords.map((record) => record.date.slice(0, 7)),
    ]);
    const reportingMonths = [...monthSet].sort();

    const cachedFlightTotals = new Map();
    const cachedBikeTotals = new Map();
    const cachedBoatTotals = new Map();
    boatRecords.forEach((record) => {
      const month = record.date.slice(0, 7);
      const current = cachedBoatTotals.get(month) || { petrol: 0, co2: 0, co2e: 0 };
      current.petrol += Number(record.petrolLitres || 0);
      current.co2 += boatGasValue(record, 'co2');
      current.co2e += boatGasValue(record, 'co2e');
      cachedBoatTotals.set(month, current);
    });

    flightRecords.forEach((record) => {
      const month = record.date.slice(0, 7);
      cachedFlightTotals.set(month, (cachedFlightTotals.get(month) || 0) + Number(record.emissionsKg || 0));
    });

    bikeRecords.forEach((record) => {
      const month = record.date.slice(0, 7);
      const calculated = calculatedBikeValues(record);
      const current = cachedBikeTotals.get(month) || { distance: 0, baselineKg: 0, chargingKg: 0, savedKg: 0 };
      current.distance += calculated.distance;
      current.baselineKg += calculated.baselineKg;
      current.chargingKg += calculated.chargingKg;
      current.savedKg += calculated.savedKg;
      cachedBikeTotals.set(month, current);
    });

    const formulaCell = (formula, cachedValue, numberFormat) => ({
      f: formula,
      v: Number.isFinite(cachedValue) ? cachedValue : 0,
      t: 'n',
      ...(numberFormat ? { z: numberFormat } : {}),
    });

    const flightRows = [[
      'Record ID', 'Reporting month', 'Date', 'Financial year', 'Traveller names', 'Landscape',
      'Airline', 'Aircraft', 'From', 'To', 'Passengers', 'Distance km', 'Fuel kg', 'Cabin',
      'CO₂ per passenger kg', 'Flight CO₂ kg', 'Flight CO₂ tonnes'
    ]];

    flightRecords.forEach((record, index) => {
      const row = index + 2;
      flightRows.push([
        record.id,
        formulaCell(`=LEFT(C${row},7)`, record.date.slice(0, 7), '@'),
        record.date,
        financialYear(record.date),
        record.name,
        record.landscape,
        record.airline,
        record.customAircraft || record.aircraft,
        record.from,
        record.to,
        Number(record.passengers || 0),
        Number(record.distance || 0),
        Number(record.fuel || 0),
        record.cabinLabel || '',
        Number(record.perPassenger || 0),
        formulaCell(`=K${row}*O${row}`, Number(record.emissionsKg || 0), '#,##0.000'),
        formulaCell(`=P${row}/1000`, Number(record.emissionsKg || 0) / 1000, '#,##0.000'),
      ]);
    });

    const bikeRows = [[
      'Record ID', 'Reporting month', 'Period starts', 'Period ends', 'Financial year',
      'Ranger / recorder', 'Registration', 'Landscape', 'Distance basis', 'Opening odometer km',
      'Closing odometer km', 'Entered distance km', 'Distance km', 'Energy intensity kWh/km',
      'Measured charging kWh', 'Energy kWh', 'Charging source', 'Grid share %', 'Mixed grid share %',
      'Grid kg/kWh', 'Boda-boda baseline kg/km', 'Substitution %', 'Baseline kg',
      'Charging emissions kg', 'CO₂ saved kg', 'CO₂ saved tonnes', 'Notes / factor source'
    ]];

    bikeRecords.forEach((record, index) => {
      const row = index + 2;
      const calculated = calculatedBikeValues(record);
      const distanceBasis = record.distanceMode || 'direct';
      const measured = calculated.measured === null ? '' : calculated.measured;

      bikeRows.push([
        record.id,
        formulaCell(`=LEFT(C${row},7)`, record.start.slice(0, 7), '@'),
        record.start,
        record.end,
        financialYear(record.date),
        record.name,
        record.registration,
        record.landscape,
        distanceBasis,
        record.opening ?? '',
        record.closing ?? '',
        distanceBasis === 'odometer' ? '' : calculated.distance,
        formulaCell(
          `=IF(I${row}="odometer",K${row}-J${row},L${row})`,
          calculated.distance,
          '#,##0.0'
        ),
        calculated.intensity,
        measured,
        formulaCell(
          `=IF(O${row}<>"",O${row},M${row}*N${row})`,
          calculated.energy,
          '#,##0.000'
        ),
        record.charging || '',
        formulaCell(
          `=IF(Q${row}="grid",100,IF(Q${row}="solar",0,IF(Q${row}="auto",IF(VALUE(LEFT(D${row},4)&MID(D${row},6,2)&RIGHT(D${row},2))<20250901,100,0),S${row})))`,
          calculated.gridShare,
          '0.0'
        ),
        Number(record.gridShare || 0),
        Number(record.gridFactor || 0),
        Number(record.baselineFactor || 0),
        Number(record.substitution || 0),
        formulaCell(
          `=M${row}*U${row}*V${row}/100`,
          calculated.baselineKg,
          '#,##0.000'
        ),
        formulaCell(
          `=P${row}*R${row}/100*T${row}`,
          calculated.chargingKg,
          '#,##0.000'
        ),
        formulaCell(
          `=W${row}-X${row}`,
          calculated.savedKg,
          '#,##0.000'
        ),
        formulaCell(
          `=Y${row}/1000`,
          calculated.savedKg / 1000,
          '#,##0.000'
        ),
        [record.note, record.factorNote].filter(Boolean).join(' · '),
      ]);
    });

    // The master Boats sheet intentionally contains just CO₂ and CO₂e, not CH₄/N₂O columns.
    const boatRows = [[
      'Record ID', 'Reporting month', 'Date', 'Financial year', 'Landscape / seascape', 'Boat ID',
      'Site', 'Activity', 'Skipper', 'Guide / crew', 'Start time', 'End time', 'Engine hours', 'PAX',
      'Room / group', 'Engine configuration', 'Petrol used (L)', 'CO₂ factor kg/L',
      'CO₂ kg', 'CO₂e factor kg/L', 'CO₂e kg', 'Source / notes'
    ]];
    boatRecords.forEach((record, index) => {
      const row = index + 2;
      const co2 = boatGasValue(record, 'co2');
      const co2e = boatGasValue(record, 'co2e');
      boatRows.push([
        record.id, record.date.slice(0, 7), record.date, financialYear(record.date),
        record.landscape, record.vessel, record.site, record.activity, record.skipper || '', record.guide || '',
        record.started || '', record.ended || '', record.engineHours ?? '', record.pax ?? '', record.group || '',
        record.engines || '', Number(record.petrolLitres), WildImpactBoat.factors.co2,
        formulaCell(`=Q${row}*R${row}`, co2, '#,##0.000'), WildImpactBoat.factors.co2e,
        formulaCell(`=Q${row}*T${row}`, co2e, '#,##0.000'), record.notes || '',
      ]);
    });

    const summaryRows = [[
      'Month', 'Financial year', 'Flight CO₂ (t)', 'E-bike distance (km)',
      'Boda-boda baseline (t)', 'Charging emissions (t)', 'CO₂ saved (t)',
      'Cumulative CO₂ saved (t)', 'Boat petrol (L)', 'Boat CO₂ (t)', 'Boat CO₂e (t)'
    ]];

    reportingMonths.forEach((month, index) => {
      const row = index + 2;
      const cachedBike = cachedBikeTotals.get(month) || { distance: 0, baselineKg: 0, chargingKg: 0, savedKg: 0 };
      const cachedFlightTonnes = (cachedFlightTotals.get(month) || 0) / 1000;
      const cachedSavedTonnes = cachedBike.savedKg / 1000;
      const cumulativeCached = reportingMonths
        .slice(0, index + 1)
        .reduce((total, currentMonth) => total + ((cachedBikeTotals.get(currentMonth)?.savedKg || 0) / 1000), 0);

      const boatMonth = cachedBoatTotals.get(month) || { petrol: 0, co2: 0, co2e: 0 };
      summaryRows.push([
        month,
        financialYear(`${month}-01`),
        formulaCell(`=SUMIF(Flights!$B$2:$B$1001,A${row},Flights!$Q$2:$Q$1001)`, cachedFlightTonnes, '#,##0.000'),
        formulaCell(`=SUMIF('E-bikes'!$B$2:$B$1001,A${row},'E-bikes'!$M$2:$M$1001)`, cachedBike.distance, '#,##0.0'),
        formulaCell(`=SUMIF('E-bikes'!$B$2:$B$1001,A${row},'E-bikes'!$W$2:$W$1001)/1000`, cachedBike.baselineKg / 1000, '#,##0.000'),
        formulaCell(`=SUMIF('E-bikes'!$B$2:$B$1001,A${row},'E-bikes'!$X$2:$X$1001)/1000`, cachedBike.chargingKg / 1000, '#,##0.000'),
        formulaCell(`=SUMIF('E-bikes'!$B$2:$B$1001,A${row},'E-bikes'!$Y$2:$Y$1001)/1000`, cachedSavedTonnes, '#,##0.000'),
        formulaCell(
          index === 0 ? `=G${row}` : `=H${row - 1}+G${row}`,
          cumulativeCached,
          '#,##0.000'
        ),
        formulaCell(`=SUMIF(Boats!$B$2:$B$10001,A${row},Boats!$Q$2:$Q$10001)`, boatMonth.petrol, '#,##0.0'),
        formulaCell(`=SUMIF(Boats!$B$2:$B$10001,A${row},Boats!$S$2:$S$10001)/1000`, boatMonth.co2 / 1000, '#,##0.000'),
        formulaCell(`=SUMIF(Boats!$B$2:$B$10001,A${row},Boats!$U$2:$U$10001)/1000`, boatMonth.co2e / 1000, '#,##0.000'),
      ]);
    });

    const methodsRows = [
      ['Topic', 'Method / calculation', 'Source / interpretation'],
      ['Flights — route distance', 'Great-circle distance between the selected airports, with the tracker detour methodology applied before the aircraft fuel curve is evaluated.', 'ICAO Carbon Emissions Calculator methodology v13.1 and the bundled Wild Impact flight reference data.'],
      ['Flights — emissions', 'Flight CO₂ kg = passengers × CO₂ kg per passenger. Flight CO₂ tonnes = Flight CO₂ kg ÷ 1,000. The per-passenger factor is calculated by the tracker from route allocation, aircraft curve, load factor, cargo share and cabin allocation; the final arithmetic remains an Excel formula.', 'The Wild Impact export preserves the calculated per-passenger factor and exposes the final multiplication in the Flights worksheet.'],
      ['E-bikes — distance', 'If distance basis is odometer: distance = closing odometer − opening odometer. Otherwise distance = entered distance. The Distance km column is an Excel formula.', 'Wild Impact Carbon Tracker input convention.'],
      ['E-bikes — energy', 'Energy kWh = measured charging kWh when supplied; otherwise distance km × energy intensity kWh/km. The Energy kWh column is an Excel formula.', 'Wild Impact project factor carried from the Les Hyperion tracker.'],
      ['E-bikes — grid share', 'Grid share is 100% for grid charging, 0% for solar charging. For automatic charging, periods ending before 1 September 2025 are treated as grid (100%); periods ending on or after 1 September 2025 are treated as solar (0%). Mixed charging uses the entered grid share. The Grid share column is an Excel formula.', 'Wild Impact project accounting convention, reflecting the project history: grid before September 2025, solar from September 2025.'],
      ['E-bikes — charging emissions', 'Charging emissions kg = Energy kWh × Grid share ÷ 100 × Grid kg/kWh. The Charging emissions kg column is an Excel formula.', 'Wild Impact project factor carried from the Les Hyperion tracker.'],
      ['E-bikes — boda-boda baseline', 'Baseline kg = Distance km × Boda-boda baseline kg/km × Substitution percentage ÷ 100. The Baseline kg column is an Excel formula.', 'Wild Impact project factor carried from the Les Hyperion tracker.'],
      ['E-bikes — CO₂ saved', 'CO₂ saved kg = Boda-boda baseline kg − Charging emissions kg. CO₂ saved tonnes = CO₂ saved kg ÷ 1,000. Both columns are Excel formulas.', 'Wild Impact Carbon Tracker accounting convention. Negative values are retained.'],
      ['Monthly Summary', 'Monthly totals are SUMIF formulas linked directly to the Flights and E-bikes worksheets. Cumulative CO₂ saved adds the current monthly saving to the previous month.', 'The cached values shown on export are recalculated from the saved record inputs, so historical automatic charging uses the project grid-before-September-2025 rule even where an older saved result was stale.'],
      ['Boats — direct combustion', 'Enter total petrol consumed by all engines on the boat (litres). Boat CO₂ kg = litres × 2.33955; boat CO₂e kg = litres × 2.35372. Both figures are formula cells on the Boats sheet. CH₄ and N₂O are calculated for app charts only, not added to the master Boats sheet.', 'UK DESNZ 2026 full conversion factors: https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026 — petrol (100% mineral). UK-based fuel composition is an assumed proxy for Mozambique.'],
      ['Boats — exclusions', 'Do not estimate fuel from engine hours; blank or unresolvable mixed-fuel entries should not be saved. If petrol is already a whole-boat quantity, do not double for twin engines.', 'Direct combustion only; no well-to-tank factor added; no double counting of CH₄/N₂O.'],
      ['Data provenance', 'This is a Wild Impact-specific adaptation of the Les Hyperion Carbon Tracker. The Wild Impact copy contains its own local reference-data files and does not depend on the Les Hyperion repository at runtime.', 'Developed and modified in 2026 for the Landscape Conservation Department.'],
    ];

    const workbook = XLSX.utils.book_new();
    workbook.Workbook = workbook.Workbook || {};
    workbook.Workbook.CalcPr = { calcMode: 'auto', fullCalcOnLoad: true, forceFullCalc: true };

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    const flightSheet = XLSX.utils.aoa_to_sheet(flightRows);
    const bikeSheet = XLSX.utils.aoa_to_sheet(bikeRows);
    const boatSheet = XLSX.utils.aoa_to_sheet(boatRows);
    const methodsSheet = XLSX.utils.aoa_to_sheet(methodsRows);

    [summarySheet, flightSheet, bikeSheet, boatSheet, methodsSheet].forEach((sheet) => {
      sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
      if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
    });

    summarySheet['!cols'] = [
      { wch: 13 }, { wch: 14 }, { wch: 20 }, { wch: 22 },
      { wch: 25 }, { wch: 24 }, { wch: 18 }, { wch: 26 }
    ];
    flightSheet['!cols'] = [
      { wch: 28 }, { wch: 16 }, { wch: 13 }, { wch: 14 }, { wch: 28 }, { wch: 24 },
      { wch: 24 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 15 },
      { wch: 12 }, { wch: 18 }, { wch: 22 }, { wch: 17 }, { wch: 17 }
    ];
    bikeSheet['!cols'] = [
      { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 22 },
      { wch: 16 }, { wch: 24 }, { wch: 15 }, { wch: 18 }, { wch: 18 }, { wch: 20 },
      { wch: 15 }, { wch: 22 }, { wch: 22 }, { wch: 16 }, { wch: 18 }, { wch: 15 },
      { wch: 20 }, { wch: 14 }, { wch: 24 }, { wch: 15 }, { wch: 17 }, { wch: 22 },
      { wch: 17 }, { wch: 18 }, { wch: 50 }
    ];
    boatSheet['!cols'] = boatRows[0].map((_, i) => ({ wch: [27, 14, 14, 14, 26, 20, 20, 20, 18, 20, 12, 12, 14, 9, 20, 34, 17, 19, 17, 21, 19, 48][i] }));
    methodsSheet['!cols'] = [{ wch: 28 }, { wch: 105 }, { wch: 65 }];

    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Monthly Summary');
    XLSX.utils.book_append_sheet(workbook, flightSheet, 'Flights');
    XLSX.utils.book_append_sheet(workbook, bikeSheet, 'E-bikes');
    XLSX.utils.book_append_sheet(workbook, boatSheet, 'Boats');
    XLSX.utils.book_append_sheet(workbook, methodsSheet, 'Methods');

    XLSX.writeFile(workbook, `Wild-Impact-Carbon-${todayIso()}.xlsx`, {
      bookType: 'xlsx',
      cellFormula: true,
    });
    showToast('Excel workbook exported with formula-driven calculations, Monthly Summary and Methods sheets.');
  };

  const importBoatHoursWorkbook = async (file) => {
    if (typeof XLSX === 'undefined') throw new Error('Excel import library unavailable. Check the internet connection.');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const monthSheets = new Set(['jan', 'feb', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);
    const selectedSheets = workbook.SheetNames.filter((name) => monthSheets.has(normaliseText(name)));
    if (!selectedSheets.length) throw new Error('No monthly boat-log tabs found. Expected Jan, Feb, March … December.');
    const imported = [];
    const exclusions = { noFuel: 0, quad: 0, splitQuad: 0, invalid: 0 };
    const timeLabel = (value) => {
      if (value instanceof Date) return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
      if (typeof value === 'number' && Number.isFinite(value)) {
        const minutes = Math.round(((value % 1 + 1) % 1) * 1440) % 1440;
        return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      }
      const valueString = String(value || '').trim();
      return /^\d{1,2}:\d{2}/.test(valueString) ? valueString.slice(0, 5).padStart(5, '0') : '';
    };
    const hoursValue = (value) => {
      if (value === null || value === '' || value === undefined) return null;
      if (value instanceof Date) return value.getUTCHours() + value.getUTCMinutes() / 60;
      if (typeof value === 'number') return value <= 1 ? value * 24 : value;
      const hours = String(value).split(':').map(Number);
      return hours.length >= 2 && hours.every(Number.isFinite) ? hours[0] + hours[1] / 60 : null;
    };
    const dateValue = (value) => {
      if (value instanceof Date) return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
      if (typeof value === 'number') {
        const parts = XLSX.SSF.parse_date_code(value);
        return parts ? `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}` : '';
      }
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
      return '';
    };
    for (const sheetName of selectedSheets) {
      const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: '' });
      const monthHasExpectedColumns = sheet.some((row) => String(row[0] || '').trim().toUpperCase() === 'DATE' && String(row[12] || '').toUpperCase().includes('PETROL USED'));
      if (!monthHasExpectedColumns) continue;
      sheet.forEach((row, index) => {
        const date = dateValue(row[0]);
        const activity = String(row[1] || '').trim();
        if (!date || !activity || /^opening\s*bal/i.test(activity)) return;
        const notes = String(row[14] || '').trim();
        if (/quad/i.test(activity)) { exclusions.quad += 1; return; }
        const loggedPetrol = row[12] === '' || row[12] == null ? NaN : Number(String(row[12]).replace(',', '.'));
        if (!Number.isFinite(loggedPetrol) || loggedPetrol <= 0) { exclusions.noFuel += 1; return; }
        let quadAllocation = 0;
        if (/quad/i.test(notes)) {
          // Subtract only an explicitly documented amount, never an inferred allocation.
          const listedQuadFuel = notes.match(/(\d+(?:[.,]\d+)?)\s*(?:l\b|litres?\b|liters?\b)/i);
          quadAllocation = listedQuadFuel ? Number(listedQuadFuel[1].replace(',', '.')) : NaN;
          if (!Number.isFinite(quadAllocation) || quadAllocation <= 0 || quadAllocation >= loggedPetrol) { exclusions.quad += 1; return; }
          exclusions.splitQuad += 1;
        }
        const petrol = loggedPetrol - quadAllocation;
        const site = String(row[2] || '').trim();
        if (!site) { exclusions.invalid += 1; return; }
        const engineHours = hoursValue(row[10]);
        const pax = row[6] === '' ? null : Number(row[6]);
        const importedId = `benguerra-boat-hours-${date}-${sheetName.toLowerCase()}-${index+1}`;
        const record = {
          id: importedId, mode: 'boat', date, name: 'Chissumba', landscape: 'Benguerra, Mozambique', vessel: 'Chissumba',
          site, activity, skipper: String(row[3] || '').trim(), guide: String(row[4] || '').trim(),
          group: String(row[5] || '').trim(), started: timeLabel(row[7]), ended: timeLabel(row[8]),
          engineHours: engineHours !== null && engineHours >= 0 && engineHours <= 48 ? engineHours : null,
          pax: Number.isInteger(pax) && pax >= 0 ? pax : null,
          petrolLitres: petrol, engines: '2 × Suzuki DF80A · petrol · 58.8 kW each',
          notes: `Source: ${file.name} · ${sheetName}!${index+1}` + (quadAllocation ? ` · Logged ${loggedPetrol} L; ${quadAllocation} L quad-bike fuel excluded` : '') + (notes ? ` · ${notes}` : ''),
          co2Kg: petrol * WildImpactBoat.factors.co2,
          co2eKg: petrol * WildImpactBoat.factors.co2e,
          emissionsKg: petrol * WildImpactBoat.factors.co2e,
          factorYear: 2026, fuelFactorCode: 'UK-DESNZ-2026-PETROL-100-MINERAL',
          updatedAt: new Date().toISOString(),
        };
        imported.push(record);
      });
    }
    if (!imported.length) throw new Error('No eligible boat trips with recorded petrol were found.');
    const alreadyRecorded = new Set(records.map((record) => record.id));
    const fresh = imported.filter((record) => !alreadyRecorded.has(record.id));
    const details = `${fresh.length} new boat journeys eligible; ${imported.length - fresh.length} previously imported; ${exclusions.splitQuad} with explicitly documented quad-bike fuel deducted; ${exclusions.noFuel} without petrol, ${exclusions.quad} quad-only or unallocatable, ${exclusions.invalid} missing site excluded.`;
    if (!fresh.length) { elementById('boat-import-status').textContent = details; showToast('No new boat journeys to import.'); return; }
    if (!window.confirm(`${details}\n\nImport the eligible records into this browser’s master database?`)) { elementById('boat-import-status').textContent = 'Import cancelled. ' + details; return; }
    records.unshift(...fresh);
    persistence.save();
    refresh();
    elementById('boat-import-status').textContent = `${fresh.length} boat records imported. ${exclusions.splitQuad} split-fuel rows corrected; ${exclusions.noFuel + exclusions.quad + exclusions.invalid} rows excluded. The original spreadsheet was not changed.`;
    showToast(`${fresh.length} boat journeys imported.`);
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify({ schema: 'wild-impact-carbon', version: 1, exportedAt: new Date().toISOString(), entries: records }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Wild-Impact-Carbon-Backup-${todayIso()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('Backup downloaded.');
  };

  const importBackup = async (file) => {
    const backup = JSON.parse(await file.text());
    if (backup.schema !== 'wild-impact-carbon' || backup.version !== 1 || !Array.isArray(backup.entries)) throw new Error('This is not a Wild Impact Carbon Tracker backup.');
    const incomingById = new Map(backup.entries.map((record) => [record.id, record]));
    const currentById = new Map(records.map((record) => [record.id, record]));
    incomingById.forEach((record, id) => { if (!currentById.has(id) || Date.parse(record.updatedAt || 0) > Date.parse(currentById.get(id).updatedAt || 0)) currentById.set(id, record); });
    records = [...currentById.values()];
    persistence.save();
    refresh();
    showToast(`Backup imported · ${backup.entries.length} records supplied.`);
  };

  persistence.load();
  initialiseDateInputs();
  clearBoatForm();
  fillLandscapes();
  countryOptions();
  populateRecommendationCountries();
  populateDefaultFlightRoute();
  elementById('recommendation-country').addEventListener('change', renderAirlineRecommendations);
  elementById('flight-landscape').addEventListener('change', () => {
    const landscape = currentLandscape('flight-landscape');
    if (routeMode === 'domestic' && landscape) {
      elementById('departure-country').value = landscape.countryCode;
      const airport = airportLookup.get(landscape.airport);
      if (airport) elementById('flight-from').value = airportLabel(airport);
    }
    renderFlightCalculation();
  });
  elementById('departure-country').addEventListener('change', () => { if (routeMode === 'domestic') chooseRouteMode('domestic'); renderFlightCalculation(); });
  elementById('arrival-country').addEventListener('change', renderFlightCalculation);
  elementById('airline-country').addEventListener('change', () => { if (!currentValue('airline-country')) return; const operator = carbonData.operators.find((item) => normaliseText(item.name) === normaliseText(currentValue('flight-airline'))); if (operator && operator.countryCode !== currentValue('airline-country')) elementById('flight-airline').value = ''; renderFlightCalculation(); });
  elementById('flight-airline').addEventListener('change', () => { chooseAircraft(false); renderFlightCalculation(); });
  elementById('flight-aircraft').addEventListener('change', () => { chooseLayouts(false); renderFlightCalculation(); });
  elementById('flight-layout').addEventListener('change', () => { chooseCabins(true); renderFlightCalculation(); });
  elementById('flight-cabin').addEventListener('change', renderFlightCalculation);
  ['flight-date','flight-names','manual-flight-kg','manual-flight-source'].forEach((id)=>elementById(id).addEventListener('input', renderFlightCalculation));
  elementById('show-all-aircraft').addEventListener('change', () => chooseAircraft(true));
  elementById('reverse-route').addEventListener('click', () => { const from = currentValue('flight-from'); const fromCountry = currentValue('departure-country'); elementById('flight-from').value = currentValue('flight-to'); elementById('flight-to').value = from; elementById('departure-country').value = currentValue('arrival-country'); elementById('arrival-country').value = fromCountry; renderFlightCalculation(); });
  elementById('domestic-mode').addEventListener('click', () => chooseRouteMode('domestic'));
  elementById('international-mode').addEventListener('click', () => chooseRouteMode('international'));
  document.querySelectorAll('.transport-tab[data-mode]').forEach((tab) => tab.addEventListener('click', () => switchMode(tab.dataset.mode)));
  elementById('flight-form').addEventListener('submit', (event) => { event.preventDefault(); try { saveFlight(); } catch (error) { elementById('flight-error').textContent = error.message; } });
  elementById('flight-cancel').addEventListener('click', clearFlightForm);

  elementById('bike-distance-mode').addEventListener('change', renderBikeCalculation);
  ['bike-start','bike-end','bike-distance','bike-opening','bike-closing','bike-charging','bike-grid-share','bike-energy-intensity','bike-grid-factor','bike-baseline-factor','bike-substitution','bike-measured'].forEach((id)=>elementById(id).addEventListener('input', renderBikeCalculation));
  elementById('bike-charging').addEventListener('change', renderBikeCalculation);
  elementById('ebike-form').addEventListener('submit', (event) => { event.preventDefault(); try { saveBike(); } catch (error) { elementById('bike-error').textContent = error.message; } });
  elementById('bike-cancel').addEventListener('click', clearBikeForm);
  elementById('boat-form').addEventListener('submit', (event) => { event.preventDefault(); try { saveBoat(); } catch (error) { elementById('boat-error').textContent = error.message; } });
  elementById('boat-cancel').addEventListener('click', clearBoatForm);
  elementById('boat-petrol').addEventListener('input', renderBoatCalculation);
  elementById('boat-gas').addEventListener('change', () => { updateBoatSummary(); drawCurrentCharts(); });
  ['boat-site-filter', 'boat-activity-filter'].forEach((id) => elementById(id).addEventListener('change', () => { updateBoatSummary(); drawCurrentCharts(); }));
  elementById('boat-clear-filters').addEventListener('click', () => { elementById('boat-site-filter').value = ''; elementById('boat-activity-filter').value = ''; updateBoatSummary(); drawCurrentCharts(); });
  elementById('boat-import-button').addEventListener('click', () => elementById('boat-import-file').click());
  elementById('boat-import-file').addEventListener('change', async (event) => { const file = event.target.files[0]; if (!file) return; try { await importBoatHoursWorkbook(file); } catch (error) { elementById('boat-import-status').textContent = error.message; showToast('Boat import failed: ' + error.message); } finally { event.target.value = ''; } });
  elementById('record-search').addEventListener('input', renderRecords);
  elementById('toggle-records').addEventListener('click', () => {
    const content = elementById('records-content');
    const collapsed = content.classList.toggle('is-collapsed');
    elementById('toggle-records').textContent = collapsed ? 'Show records' : 'Collapse records';
    elementById('toggle-records').setAttribute('aria-expanded', String(!collapsed));
  });
  elementById('records-body').addEventListener('click', (event) => { const button = event.target.closest('button'); if (!button) return; const record = records.find((item) => item.id === button.dataset.edit); if (button.dataset.edit && record) editRecord(record); if (button.dataset.delete) { deletedRecord = records.find((item) => item.id === button.dataset.delete); records = records.filter((item) => item.id !== button.dataset.delete); persistence.save(); elementById('undo-delete').hidden = false; refresh(); showToast('Record deleted.'); } });
  elementById('undo-delete').addEventListener('click', () => { if (!deletedRecord) return; records.unshift(deletedRecord); deletedRecord = null; persistence.save(); elementById('undo-delete').hidden = true; refresh(); showToast('Record restored.'); });
  elementById('export-workbook').addEventListener('click', () => { try { exportWorkbook(); } catch (error) { showToast('Export failed: ' + error.message); } });
  elementById('export-backup').addEventListener('click', exportBackup);
  elementById('import-backup-button').addEventListener('click', () => elementById('import-backup').click());
  elementById('import-backup').addEventListener('change', async (event) => { const file = event.target.files[0]; if (!file) return; try { await importBackup(file); } catch (error) { showToast('Import failed: ' + error.message); } finally { event.target.value = ''; } });
  window.addEventListener('resize', () => { if (window.wildImpactResizeTimer) clearTimeout(window.wildImpactResizeTimer); window.wildImpactResizeTimer = setTimeout(drawCurrentCharts, 150); });

  elementById('app-status').classList.add('ready');
  elementById('app-status').textContent = 'Tracker ready. Record flights, e-bike periods and boat journeys; export them together in one workbook.';
  refresh();
  renderFlightCalculation();
  renderBikeCalculation();
  renderBoatCalculation();
};
