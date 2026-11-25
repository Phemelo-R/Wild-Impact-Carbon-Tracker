'use strict';

/* Shared, static-data utilities. Settings are saved only on this browser.
 * No external currency-rate, electricity-price, fuel-price or geolocation API is called.
 */
(function (root) {
  const countries = Object.freeze({
    ZA: { name: 'South Africa', currency: 'ZAR', locale: 'en-ZA', gridFactor: 0.960, gridYear: '2024' },
    BW: { name: 'Botswana', currency: 'BWP', locale: 'en-BW' },
    KE: { name: 'Kenya', currency: 'KES', locale: 'en-KE' },
    MZ: { name: 'Mozambique', currency: 'MZN', locale: 'pt-MZ' },
    TZ: { name: 'Tanzania', currency: 'TZS', locale: 'sw-TZ' },
    NA: { name: 'Namibia', currency: 'NAD', locale: 'en-NA' },
    ZM: { name: 'Zambia', currency: 'ZMW', locale: 'en-ZM' },
    GB: { name: 'United Kingdom', currency: 'GBP', locale: 'en-GB' },
    US: { name: 'United States', currency: 'USD', locale: 'en-US' },
    EU: { name: 'Euro area', currency: 'EUR', locale: 'en-IE' },
    OTHER: { name: 'Other location', currency: 'USD', locale: 'en-US' },
  });
  const settingsKey = 'wild-impact-vehicle-settings-v2';
  const storageKey = 'wild-impact-carbon-tracker-v1';
  const fleetStorageKey = 'wild-impact-private-fleet-v1';
  const byId = (id) => document.getElementById(id);
  const numeric = (value) => value === '' || value === null || value === undefined ? null :
    Number.isFinite(Number(value)) ? Number(value) : null;
  const fixed = (value, places = 2) => Number(value).toLocaleString('en-GB', {
    minimumFractionDigits: places, maximumFractionDigits: places,
  });
  const safeDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T12:00:00Z')) &&
    new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
  const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-` +
      `${String(date.getDate()).padStart(2, '0')}`;
  };
  const empty = (element) => element.replaceChildren();
  const node = (tag, className = '', text = '') => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  };
  const label = (vehicle) => [vehicle.brand, vehicle.model, vehicle.variant].filter(Boolean).join(' · ');
  const readSettings = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(settingsKey) || 'null');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { return {}; }
  };
  const writeSettings = (value) => {
    localStorage.setItem(settingsKey, JSON.stringify(value));
  };
  const renderCurrency = (amount, settings, decimalPlaces = 2) => {
    if (amount === null || !Number.isFinite(Number(amount))) return 'Price unavailable';
    const country = countries[settings.country] || countries.OTHER;
    const currency = settings.currency || country.currency;
    try {
      return new Intl.NumberFormat(country.locale, {
        style: 'currency', currency, minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      }).format(Number(amount));
    } catch (_) { return `${currency} ${fixed(amount, decimalPlaces)}`; }
  };

  const readRecords = () => {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (!saved) return [];
    if (saved.schema !== 'wild-impact-carbon' || saved.version !== 1 ||
      !Array.isArray(saved.entries)) {
      throw new Error('Unrecognised local records. Export your backup before continuing.');
    }
    return saved.entries;
  };
  const writeRecords = (entries) => {
    if (entries.length > 100000) throw new Error('Local storage record limit exceeded.');
    localStorage.setItem(storageKey, JSON.stringify({
      schema: 'wild-impact-carbon', version: 1, entries,
      exportedAt: new Date().toISOString(),
    }));
  };
  const exportCsv = (records, fields, filename) => {
    const escapeCsv = (value) => {
      let text = String(value === null || value === undefined ? '' : value);
      if (/^\s*[=+@-]/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text.trim())) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    const rows = [fields.map(escapeCsv).join(',')];
    for (const record of records) rows.push(fields.map((field) => escapeCsv(record[field])).join(','));
    const blob = new Blob(['\ufeff', rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = node('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const loadCatalogue = async () => {
    const response = await fetch('../data/vehicle-reference.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('The vehicle database could not be loaded.');
    const catalogue = await response.json();
    if (catalogue.schema !== 'wild-impact-vehicle-catalogue-v1' ||
      !Array.isArray(catalogue.vehicles)) {
      throw new Error('The vehicle database format is not supported.');
    }
    return catalogue;
  };

  /* Transparent vehicle photographs supplied by the project team.
   * All assets are local; no external image services or inline SVG are required.
   * Filenames are whitelisted to prevent arbitrary paths from entering the DOM.
   */
  const bodyImageNames = new Set([
    'hatchback', 'sedan', 'suv', 'estate', 'coupe', 'liftback',
    'cabriolet', 'roadster', 'pickup', 'off-road', 'sport', 'micro',
    'van', 'muscle', 'formula-1', 'limousine', 'motorcycle', 'mpv',
  ]);
  const bodyIcon = (bodyType) => {
    const bodyAliases = { 'pick-up':'pickup', 'mini-van':'mpv', 'minivan':'mpv', 'mpv':'mpv', 'motorcycle':'motorcycle' };
    const normalised = String(bodyType || '').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const imageName = bodyAliases[normalised] || normalised;
    if (!bodyImageNames.has(imageName)) {
      return node('span', 'vehicle-all-bodies-icon', '?');
    }
    const image = node('img', 'vehicle-body-image');
    image.setAttribute('src', `../assets/body-types/${imageName}.png`);
    image.setAttribute('alt', '');
    image.setAttribute('aria-hidden', 'true');
    image.setAttribute('loading', 'lazy');
    image.setAttribute('decoding', 'async');
    image.setAttribute('width', '320');
    image.setAttribute('height', '160');
    return image;
  };


  /* The fleet register is user-selected and never fetched from the public website.
   * This stores registration, asset IDs and optional premiums on this browser only.
   * A public model catalogue without identifiers is loaded separately.
   */
  const readPrivateFleet = () => {
    try {
      const payload = JSON.parse(localStorage.getItem(fleetStorageKey) || 'null');
      if (!payload) return [];
      if (payload.schema !== 'wild-impact-private-fleet-v1' ||
        !Array.isArray(payload.assets) || payload.assets.length > 1000) {
        throw new Error('Stored private fleet has an invalid format.');
      }
      return payload.assets;
    } catch (error) {
      throw new Error('Private fleet data could not be loaded: ' + error.message);
    }
  };
  const writePrivateFleet = (assets) => {
    if (!Array.isArray(assets) || assets.length > 1000) {
      throw new Error('Private fleet import exceeds the 1000-asset limit.');
    }
    localStorage.setItem(fleetStorageKey, JSON.stringify({
      schema: 'wild-impact-private-fleet-v1', importedAt: new Date().toISOString(), assets,
    }));
  };
  const clearPrivateFleet = () => localStorage.removeItem(fleetStorageKey);
  const normaliseFleetText = (value) => String(value ?? '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const matchFleetModel = (asset, catalogue) => {
    const matched = catalogue.filter((vehicle) =>
      normaliseFleetText(asset.brand) === normaliseFleetText(vehicle.brand) &&
      normaliseFleetText(asset.model) === normaliseFleetText(vehicle.model) &&
      normaliseFleetText(asset.variant) === normaliseFleetText(vehicle.variant) &&
      String(asset.year) === String(vehicle.years) &&
      normaliseFleetText(asset.fuel) === normaliseFleetText(vehicle.fuel) &&
      Math.abs(Number(asset.fuelL100) - Number(vehicle.fuelL100)) < 0.00001
    );
    return matched.length === 1 ? matched[0] : null;
  };
  const parseFleetCsv = (source, catalogue) => {
    if (source.length > 1000000) throw new Error('Fleet CSV is too large (1 MB maximum).');
    const rows = [];
    let current = [], cell = '', quoted = false;
    const content = source.replace(/^\uFEFF/, '');
    for (let index = 0; index < content.length; index++) {
      const character = content[index];
      if (character === '"') {
        if (quoted && content[index + 1] === '"') { cell += '"'; index++; }
        else quoted = !quoted;
      } else if (character === ',' && !quoted) {
        current.push(cell); cell = '';
      } else if ((character === '\r' || character === '\n') && !quoted) {
        if (character === '\r' && content[index+1] === '\n') index++;
        current.push(cell);
        if (current.some((part) => String(part).trim())) rows.push(current);
        current = []; cell = '';
      } else cell += character;
    }
    if (quoted) throw new Error('Unclosed quoted field in fleet CSV.');
    current.push(cell);
    if (current.some((part) => String(part).trim())) rows.push(current);
    if (rows.length < 2 || rows.length > 1001) throw new Error('Fleet CSV must contain 1–1000 data rows.');
    const headers = rows.shift().map((field) => normaliseFleetText(field));
    const required = ['brand','model','variant','registration number','asset id',
      'year year range','body type','fuel type','fuel consumption','landscape'];
    for (const field of required) if (!headers.includes(field)) {
      throw new Error('Missing fleet CSV column: ' + field);
    }
    if (headers.length > 40 || new Set(headers).size !== headers.length) {
      throw new Error('Fleet CSV has duplicate headers or an excessive number of columns.');
    }
    const assets = [], unmatched = [], warnings = [];
    for (let index = 0; index < rows.length; index++) {
      if (rows[index].length !== headers.length) {
        throw new Error(`Row ${index+2} has ${rows[index].length} fields; expected ${headers.length}.`);
      }
      const data = Object.fromEntries(headers.map((key, col) => [key, rows[index][col].trim()]));
      const fleet = {
        id: `local-fleet-${index + 1}`,
        assetId: data['asset id'].slice(0, 80),
        registration: data['registration number'].slice(0, 80),
        brand: data.brand.slice(0, 90),
        model: data.model.slice(0, 90),
        variant: data.variant.slice(0, 160),
        year: data['year year range'],
        fuel: data['fuel type'],
        fuelL100: numeric(data['fuel consumption']),
        body: data['body type'].slice(0, 70),
        landscape: data.landscape.slice(0, 100),
        annualInsuranceZar: numeric(data['annual insurance zar'] || data['annual insurance'] || ''),
      };
      if (!fleet.assetId || !fleet.registration ||
        !/^(19|20)\d{2}$/.test(fleet.year) || !(fleet.fuelL100 > 0)) {
        throw new Error(`Row ${index + 2}: asset ID, registration, year or fuel rate invalid.`);
      }
      const matched = matchFleetModel(fleet, catalogue);
      fleet.modelId = matched ? matched.id : null;
      if (!matched) unmatched.push(index + 2);
      assets.push(fleet);
    }
    const plateCounts = new Map(), idCounts = new Map();
    for (const item of assets) {
      const plate = normaliseFleetText(item.registration);
      const id = normaliseFleetText(item.assetId);
      plateCounts.set(plate, (plateCounts.get(plate) || 0) + 1);
      idCounts.set(id, (idCounts.get(id) || 0) + 1);
    }
    const duplicatePlates = [...plateCounts.values()].filter((count) => count > 1).length;
    const duplicateIds = [...idCounts.values()].filter((count) => count > 1).length;
    if (duplicatePlates) warnings.push(`${duplicatePlates} repeated registration number(s); each row is retained independently.`);
    if (duplicateIds) warnings.push(`${duplicateIds} repeated asset ID(s); registrations distinguish these records.`);
    if (unmatched.length) warnings.push(`${unmatched.length} asset(s) have no matching specification in the installed public catalogue (CSV rows: ${unmatched.slice(0,10).join(', ')}).`);
    return { assets, warnings, matched: assets.length - unmatched.length };
  };

  const controls = (onChange) => {
    const saved = readSettings();
    const countrySelect = byId('vehicle-country');
    const customLocation = byId('vehicle-location');
    const customCountry = byId('vehicle-custom-country');
    const customCurrency = byId('vehicle-custom-currency');
    const fields = ['vehicle-country', 'vehicle-grid-factor', 'vehicle-grid-year',
      'vehicle-charge-efficiency', 'vehicle-petrol-price', 'vehicle-diesel-price',
      'vehicle-electric-price', 'vehicle-location', 'vehicle-custom-country',
      'vehicle-custom-currency'];
    const applyCountry = (country, resetPrices = false) => {
      const profile = countries[country] || countries.OTHER;
      const custom = country === 'OTHER';
      byId('vehicle-custom-fields').hidden = !custom;
      if (resetPrices) {
        for (const id of ['vehicle-petrol-price','vehicle-diesel-price','vehicle-electric-price']) {
          byId(id).value = '';
        }
      }
      byId('vehicle-currency-label').textContent = `Price currency: ${custom ? (customCurrency.value || 'USD') : profile.currency} — enter local tariffs, not converted prices.`;
      for (const [field, unit] of [['vehicle-petrol-price','L'],['vehicle-diesel-price','L'],
        ['vehicle-electric-price','kWh']]) {
        byId(field).closest('label').querySelector('.currency-unit').textContent =
          `${custom ? (customCurrency.value || 'USD') : profile.currency}/${unit}`;
      }
      if (country === 'ZA') {
        if (resetPrices) {
          byId('vehicle-grid-year').value = '2024';
          byId('vehicle-grid-factor').value = '0.960';
        }
      } else if (resetPrices) {
        byId('vehicle-grid-year').value = '';
        byId('vehicle-grid-factor').value = '';
      }
    };
    const savedCountry = countries[saved.country] ? saved.country : 'ZA';
    countrySelect.value = savedCountry;
    customLocation.value = saved.location || '';
    customCountry.value = saved.customCountry || '';
    customCurrency.value = saved.customCurrency || 'USD';
    byId('vehicle-grid-year').value = saved.gridFactorYear ?? '2024';
    byId('vehicle-grid-factor').value = saved.gridFactor === undefined ? '0.960' : String(saved.gridFactor);
    byId('vehicle-charge-efficiency').value = String(saved.chargingEfficiency ?? 0.9);
    for (const [key, id] of [['petrolPrice','vehicle-petrol-price'],
      ['dieselPrice','vehicle-diesel-price'], ['electricityPrice','vehicle-electric-price']]) {
      byId(id).value = saved[key] === undefined || saved[key] === null ? '' : String(saved[key]);
    }
    if (savedCountry !== 'ZA' && saved.gridFactor === undefined) byId('vehicle-grid-factor').value = '';
    applyCountry(savedCountry);
    const current = () => {
      const country = countrySelect.value;
      const profile = countries[country] || countries.OTHER;
      return {
        country,
        customCountry: customCountry.value.trim(),
        currency: country === 'OTHER' ? customCurrency.value.toUpperCase().trim() : profile.currency,
        customCurrency: customCurrency.value.toUpperCase().trim(),
        location: customLocation.value.trim(),
        gridFactor: numeric(byId('vehicle-grid-factor').value),
        gridFactorYear: byId('vehicle-grid-year').value.trim(),
        chargingEfficiency: numeric(byId('vehicle-charge-efficiency').value),
        petrolPrice: numeric(byId('vehicle-petrol-price').value),
        dieselPrice: numeric(byId('vehicle-diesel-price').value),
        electricityPrice: numeric(byId('vehicle-electric-price').value),
      };
    };
    const save = () => {
      const state = current();
      writeSettings(state);
      applyCountry(state.country);
      byId('vehicle-grid-warning').textContent = state.country === 'ZA'
        ? state.gridFactor === 0.960 && state.gridFactorYear === '2024'
          ? '0.960 kg CO₂e/kWh is South Africa’s published 2024 national generation factor, used here as a historical proxy for journeys in later years.'
          : 'A non-default South African grid factor has been entered. Verify its source, location and reporting year before using it.'
        : state.gridFactor === null || state.gridFactor <= 0
          ? 'No electricity factor supplied for this location. Electric calculations will remain data deficient until a locally appropriate factor is entered.'
          : 'Custom electricity factor supplied by the user. Check the location, year, unit (kg CO₂e/kWh) and original publication.';
      onChange(state);
    };
    countrySelect.addEventListener('change', () => {
      applyCountry(countrySelect.value, true);
      save();
    });
    for (const id of fields.filter((id) => id !== 'vehicle-country')) {
      byId(id).addEventListener('input', save);
      byId(id).addEventListener('change', save);
    }
    save();
    return { get: current, save };
  };

  root.WildImpactVehicleCommon = Object.freeze({
    countries, byId, numeric, fixed, safeDate, today, node, empty, label,
    renderCurrency, readRecords, writeRecords, exportCsv, loadCatalogue, bodyIcon, controls,
    readPrivateFleet, writePrivateFleet, clearPrivateFleet, parseFleetCsv, matchFleetModel,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
