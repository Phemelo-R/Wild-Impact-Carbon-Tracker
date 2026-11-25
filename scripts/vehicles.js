'use strict';

/* Distance-only vehicle-accounting page. Shared historical v1 backups are preserved. */
(async () => {
  const common = WildImpactVehicleCommon;
  const calculator = WildImpactVehicle;
  const byId = common.byId;
  const catalogue = await common.loadCatalogue();
  const vehicles = catalogue.vehicles;
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const status = byId('vehicle-status');
  const suggestions = byId('vehicle-model-results');
  let selectedId = '';
  let selectedAsset = null;
  let editingRecord = null;
  let preferences;

  const modelMatches = () => {
    const normaliseSearch = (text) => String(text).normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim();
    const query = normaliseSearch(byId('vehicle-model-search').value);
    const year = byId('vehicle-year-search').value;
    return vehicles.filter((vehicle) => {
      const description = normaliseSearch([vehicle.brand, vehicle.model,
        vehicle.variant, vehicle.years].filter(Boolean).join(' '));
      return (!query || description.includes(query)) &&
        (!year || calculator.matchesYear(vehicle, year));
    }).sort((left, right) => common.label(left).localeCompare(common.label(right)));
  };
  const selectedVehicle = () => vehicleById.get(selectedId) || null;
  const chooseVehicle = (vehicle) => {
    selectedId = vehicle.id;
    byId('vehicle-trip-select').value = vehicle.id;
    byId('vehicle-model-search').value = common.label(vehicle);
    common.empty(suggestions);
    byId('vehicle-model-search').setAttribute('aria-expanded', 'false');
    byId('vehicle-selection-note').textContent =
      `${vehicle.brand} ${vehicle.model} · ${vehicle.variant || 'variant unspecified'}` +
      ` · ${vehicle.years} · ${vehicle.technology} · ${vehicle.fuel}`;
    preview();
  };
  const renderSuggestions = () => {
    common.empty(suggestions);
    const matches = modelMatches();
    const query = byId('vehicle-model-search').value.trim();
    const year = byId('vehicle-year-search').value;
    if (!query && !year) {
      byId('vehicle-model-search').setAttribute('aria-expanded', 'false');
      return;
    }
    for (const vehicle of matches.slice(0, 15)) {
      const button = common.node('button', 'vehicle-model-choice');
      button.type = 'button';
      button.setAttribute('role', 'option');
      const name = common.node('strong', '', `${vehicle.brand} ${vehicle.model}`);
      const detail = common.node('span', '', [vehicle.variant, vehicle.years,
        vehicle.technology].filter(Boolean).join(' · '));
      button.append(name, detail);
      button.addEventListener('click', () => chooseVehicle(vehicle));
      suggestions.appendChild(button);
    }
    if (matches.length === 0) {
      suggestions.appendChild(common.node('p', 'vehicle-empty',
        'No variants match this model and production year. Try another year or a shorter model name.'));
    } else if (matches.length > 15) {
      suggestions.appendChild(common.node('p', 'vehicle-hint',
        `${matches.length} matching derivatives; showing 15. Refine the model name or year.`));
    }
    byId('vehicle-model-search').setAttribute('aria-expanded', String(matches.length > 0));
  };
  const selectedYearIsValid = () => {
    const selected = selectedVehicle();
    const year = byId('vehicle-year-search').value;
    return !selected || !year || calculator.matchesYear(selected, year);
  };
  const preview = () => {
    const target = byId('vehicle-trip-preview');
    common.empty(target);
    const selected = selectedVehicle();
    const distance = common.numeric(byId('vehicle-trip-km').value);
    if (!selected || !(distance > 0)) {
      target.textContent = 'Choose a vehicle variant and enter a positive distance to calculate emissions.';
      return;
    }
    if (!selectedYearIsValid()) {
      target.textContent = 'The selected variant does not match this model year. Choose a compatible variant.';
      return;
    }
    try {
      const result = calculator.calculateTrip(selected, distance, preferences.get());
      const total = common.node('div', 'vehicle-preview-total',
        `${common.fixed(result.operationalCo2eKg, 3)} kg CO₂e`);
      const details = common.node('p', '',
        `${common.fixed(distance, 1)} km · ${selected.technology} · ` +
        `${common.fixed(result.gramsCo2ePerKm, 1)} g CO₂e/km · category ${result.band}`);
      const fuel = result.fuelLitres > 0
        ? `Estimated ${common.fixed(result.fuelLitres, 2)} litres; direct CO₂ ` +
          `${common.fixed(result.fuelCo2Kg, 3)} kg (CO₂e ${common.fixed(result.fuelCo2eKg, 3)} kg).`
        : `Estimated charging electricity: ${common.fixed(result.gridKwh, 2)} kWh; ` +
          `grid emissions ${common.fixed(result.gridCo2eKg, 3)} kg CO₂e.`;
      const energy = common.node('p', '', fuel);
      const cost = common.node('p', '', result.energyCostLocal === null
        ? 'Add the corresponding energy price to estimate operating cost.'
        : `Estimated energy cost: ${common.renderCurrency(result.energyCostLocal, preferences.get())}.`);
      const caveat = common.node('p', 'vehicle-hint', result.method);
      target.append(total, details, energy, cost, caveat);
    } catch (error) {
      target.appendChild(common.node('p', 'vehicle-error', error.message));
    }
  };

  const editRecord = (id) => {
    const record = common.readRecords().find((item) => item.id === id && item.mode === 'vehicle');
    if (!record) { status.textContent = 'The selected journey is no longer available.'; return; }
    editingRecord = record;
    byId('vehicle-driver').value = record.driverName || '';
    byId('vehicle-trip-date').value = record.date || '';
    byId('vehicle-landscape').value = record.landscape || '';
    byId('vehicle-ownership').value = record.ownership || 'company';
    byId('vehicle-trip-km').value = record.distanceKm ?? '';
    byId('vehicle-registration').value = record.registrationNumber || '';
    byId('vehicle-asset-id').value = record.assetId || '';
    byId('vehicle-year-search').value = record.modelYear || '';
    selectedAsset = common.readPrivateFleet().find((item) =>
      item.id === record.privateFleetAssetKey) || null;
    byId('vehicle-fleet-asset').value = selectedAsset?.id || '';
    const vehicle = vehicleById.get(record.vehicleCatalogueId);
    if (vehicle) chooseVehicle(vehicle);
    else {
      selectedId = '';
      byId('vehicle-trip-select').value = '';
      byId('vehicle-model-search').value = record.name || '';
      byId('vehicle-selection-note').textContent =
        'This historical model is no longer in the catalogue. Select a matching vehicle variant to recalculate it.';
      preview();
    }
    byId('vehicle-save').textContent = 'Update vehicle journey';
    byId('vehicle-cancel-edit').hidden = false;
    const note = byId('vehicle-edit-status');
    note.hidden = false;
    note.textContent = 'Editing the journey from ' + (record.date || 'unknown date') +
      '. Saving will replace this record, retain its identity and update the emissions estimate.';
    byId('vehicle-form-error').textContent = '';
    const form = byId('vehicle-form');
    if (typeof form.scrollIntoView === 'function') {
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  const removeRecord = (id) => {
    if (!window.confirm('Delete this saved vehicle journey? Export a backup first if needed.')) return;
    try {
      common.writeRecords(common.readRecords().filter((record) => record.id !== id));
      if (editingRecord?.id === id) clearForm();
      renderRecords();
      renderFigures();
      status.textContent = 'Vehicle journey deleted from this browser.';
    } catch (error) { status.textContent = error.message; }
  };
  const renderRecords = () => {
    const target = byId('vehicle-record-rows');
    common.empty(target);
    try {
      const vehicleRecords = common.readRecords()
        .filter((record) => record.mode === 'vehicle')
        .sort((left, right) => (right.date || '').localeCompare(left.date || ''));
      const query = String(byId('vehicle-record-search').value || '').toLowerCase().trim();
      const matchingRecords = vehicleRecords.filter((record) => {
        if (!query) return true;
        return [record.date, record.driverName, record.assetId,
          record.registrationNumber, record.name, record.landscape, record.bodyType]
          .some((value) => String(value ?? '').toLowerCase().includes(query));
      });
      for (const record of matchingRecords.slice(0, 200)) {
        const row = common.node('tr');
        const dateCell = common.node('td');
        dateCell.append(common.node('strong', '', record.date || 'Unknown date'),
          common.node('small', '', record.driverName || 'Driver unrecorded'));
        const modelCell = common.node('td');
        modelCell.append(common.node('strong', '', record.name || 'Vehicle'),
          common.node('small', '', [record.assetId ? 'Asset ' + record.assetId : '',
            record.registrationNumber || 'Registration not provided']
            .filter(Boolean).join(' · ')));
        const areaCell = common.node('td');
        areaCell.append(common.node('strong', '', record.landscape || 'Landscape not recorded'),
          common.node('small', '', record.bodyType || 'Body type not recorded'));
        const distanceCell = common.node('td');
        distanceCell.append(common.node('strong', '', `${common.fixed(record.distanceKm || 0, 1)} km`));
        distanceCell.setAttribute('title', record.method || 'Historical calculation');
        const emissionsCell = common.node('td');
        const kilograms = Number(record.co2eKg ?? record.emissionsKg);
        emissionsCell.append(common.node('strong', '',
          Number.isFinite(kilograms) ? `${common.fixed(kilograms, 3)} kg` : 'Unavailable'),
          common.node('small', '', 'CO₂e'));
        const actions = common.node('td');
        const actionGroup = common.node('div', 'vehicle-record-actions');
        const editButton = common.node('button', 'vehicle-small-button', 'Edit');
        editButton.type = 'button';
        editButton.setAttribute('aria-label', `Edit journey on ${record.date || 'unknown date'}`);
        editButton.addEventListener('click', () => editRecord(record.id));
        const deleteButton = common.node('button', 'vehicle-small-button is-delete', 'Delete');
        deleteButton.type = 'button';
        deleteButton.setAttribute('aria-label', `Delete journey on ${record.date || 'unknown date'}`);
        deleteButton.addEventListener('click', () => removeRecord(record.id));
        actionGroup.append(editButton, deleteButton);
        actions.appendChild(actionGroup);
        row.append(dateCell, modelCell, areaCell, distanceCell, emissionsCell, actions);
        target.appendChild(row);
      }
      if (!matchingRecords.length) {
        const row = common.node('tr');
        const cell = common.node('td', '', vehicleRecords.length ?
          'No vehicle journeys match this search.' : 'No vehicle journeys have been saved yet.');
        cell.colSpan = 6;
        row.appendChild(cell);
        target.appendChild(row);
      }
      byId('vehicle-record-count').textContent = vehicleRecords.length
        ? `${vehicleRecords.length} stored vehicle journeys · ${matchingRecords.length} matching this search` +
          (matchingRecords.length > 200 ? ' (first 200 displayed; refine the search to see others).' : '.') +
          ' Records are stored locally and retain their factor history.'
        : 'No vehicle journeys saved yet. The totals and charts will populate after the first record.';
    } catch (error) { byId('vehicle-record-count').textContent = error.message; }
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const palette = ['#F15A29', '#BC7E27', '#B72126', '#B84626', '#85734A',
    '#E19B34', '#7C6D5B', '#C17B54', '#87633C', '#D39974'];
  const typePalette = { 'Pick-up': '#F15A29', MPV: '#BC7E27', Motorcycle: '#B72126' };
  const typeName = (value) => {
    const name = String(value || 'Unclassified').trim();
    return ['Mini-Van', 'Minivan'].includes(name) ? 'MPV' : name;
  };
  const svgElement = (tag, attributes = {}, content = null) => {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
    if (content !== null) element.textContent = String(content);
    return element;
  };
  const plotText = (svg, x, y, label, extra = {}) => {
    svg.appendChild(svgElement('text', {
      x, y, fill: '#5C5148', 'font-size': 12,
      'font-family': 'system-ui, -apple-system, Segoe UI, Arial, sans-serif', ...extra,
    }, label));
  };
  const chartSize = (svg) => ({
    width: svg.viewBox.baseVal.width || 680,
    height: svg.viewBox.baseVal.height || 350,
  });
  const emptyFigure = (svg, message) => {
    svg.replaceChildren();
    const { width, height } = chartSize(svg);
    plotText(svg, width / 2, height / 2, message,
      { 'text-anchor': 'middle', 'font-size': 14 });
  };
  const ordinate = (value) => Number(value || 0).toLocaleString('en-GB', {
    maximumFractionDigits: value < 10 ? 1 : 0,
  });
  const chartTitle = (shape, message) => shape.appendChild(svgElement('title', {}, message));
  const legend = (id, entries, colours) => {
    const container = byId(id);
    common.empty(container);
    for (const item of entries) {
      const node = common.node('span', 'vehicle-legend-item');
      const swatch = common.node('span', 'vehicle-legend-swatch');
      swatch.style.backgroundColor = colours.get(item);
      node.append(swatch, common.node('span', '', item));
      container.appendChild(node);
    }
  };
  const drawMonthly = (svg, records) => {
    svg.replaceChildren();
    const monthly = new Map();
    const landscapeTotals = new Map();
    for (const record of records) {
      const month = String(record.date || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      const name = String(record.landscape || 'Unspecified landscape').trim() || 'Unspecified landscape';
      if (!monthly.has(month)) monthly.set(month, new Map());
      const amount = Number(record.co2eKg ?? record.emissionsKg);
      monthly.get(month).set(name, (monthly.get(month).get(name) || 0) + amount);
      landscapeTotals.set(name, (landscapeTotals.get(name) || 0) + amount);
    }
    const months = [...monthly.keys()].sort();
    if (!months.length) {
      legend('vehicle-monthly-legend', [], new Map());
      emptyFigure(svg, 'Record journeys to show monthly emissions.');
      return 0;
    }
    // Include months with no recorded journeys between the oldest and newest displayed periods.
    const newest = months[months.length - 1];
    const firstMonth = new Date(newest + '-01T12:00:00Z');
    firstMonth.setUTCMonth(firstMonth.getUTCMonth() - 11);
    const displayedMonths = [];
    for (let index = 0; index < 12; index++) {
      const date = new Date(firstMonth.getTime());
      date.setUTCMonth(firstMonth.getUTCMonth() + index);
      displayedMonths.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    const areas = [...landscapeTotals.keys()].sort((a, b) =>
      (landscapeTotals.get(b) || 0) - (landscapeTotals.get(a) || 0));
    const colours = new Map(areas.map((area, index) => [area, palette[index % palette.length]]));
    legend('vehicle-monthly-legend', areas, colours);
    const { width, height } = chartSize(svg);
    const left = 70, right = 25, top = 34, bottom = 64;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const heights = displayedMonths.map((month) =>
      [...(monthly.get(month)?.values() || [])].reduce((total, amount) => total + amount, 0));
    const scale = Math.max(1, ...heights) * 1.12;
    for (let tick = 0; tick <= 4; tick++) {
      const amount = scale * tick / 4;
      const y = top + plotHeight * (1 - tick / 4);
      svg.appendChild(svgElement('line', {
        x1: left, y1: y, x2: width - right, y2: y,
        stroke: '#E7DCCF', 'stroke-width': 1,
      }));
      plotText(svg, left - 12, y + 4, ordinate(amount), { 'text-anchor': 'end', 'font-size': 11 });
    }
    const cell = plotWidth / displayedMonths.length;
    const barWidth = Math.min(54, cell * .64);
    displayedMonths.forEach((month, index) => {
      let accumulated = 0;
      const x = left + index * cell + (cell - barWidth) / 2;
      for (const area of areas) {
        const amount = monthly.get(month)?.get(area) || 0;
        if (!(amount > 0)) continue;
        const h = plotHeight * amount / scale;
        const rectangle = svgElement('rect', {
          x, y: top + plotHeight - accumulated - h,
          width: barWidth, height: h, rx: 1,
          fill: colours.get(area),
        });
        chartTitle(rectangle, `${month} · ${area}: ${common.fixed(amount, 2)} kg CO₂e`);
        svg.appendChild(rectangle);
        accumulated += h;
      }
      const date = new Date(month + '-01T12:00:00Z');
      const label = date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
      plotText(svg, left + cell * (index + .5), top + plotHeight + 23, label,
        { 'text-anchor': 'middle', 'font-size': 10.5 });
    });
    plotText(svg, 10, 18, 'kg CO₂e', { 'font-size': 12, 'font-weight': 700 });
    plotText(svg, width - 25, height - 12, 'Journey month',
      { 'font-size': 11, 'text-anchor': 'end' });
    return displayedMonths.filter((month) => monthly.has(month)).length;
  };
  const drawScatter = (svg, records) => {
    svg.replaceChildren();
    const points = records.filter((record) =>
      Number(record.distanceKm) > 0 &&
      Number.isFinite(Number(record.co2eKg ?? record.emissionsKg)));
    if (!points.length) {
      legend('vehicle-scatter-legend', [], new Map());
      emptyFigure(svg, 'Save journeys to compare distance and emissions.');
      return 0;
    }
    const types = [...new Set(points.map((record) => typeName(record.bodyType)))].sort();
    const colours = new Map(types.map((type, index) => [type,
      typePalette[type] || palette[(index + 4) % palette.length]]));
    legend('vehicle-scatter-legend', types, colours);
    const { width, height } = chartSize(svg);
    const left = 76, right = 33, top = 37, bottom = 69;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const maxDistance = Math.max(1, ...points.map((r) => Number(r.distanceKm))) * 1.10;
    const maxEmission = Math.max(1, ...points.map((r) =>
      Number(r.co2eKg ?? r.emissionsKg))) * 1.12;
    for (let tick = 0; tick <= 4; tick++) {
      const fraction = tick / 4;
      const y = top + plotHeight * (1 - fraction);
      const x = left + plotWidth * fraction;
      svg.appendChild(svgElement('line', {
        x1: left, y1: y, x2: width - right, y2: y, stroke: '#E7DCCF',
      }));
      svg.appendChild(svgElement('line', {
        x1: x, y1: top, x2: x, y2: top + plotHeight,
        stroke: '#F2EBE3',
      }));
      plotText(svg, left - 11, y + 4, ordinate(maxEmission * fraction),
        { 'text-anchor': 'end', 'font-size': 11 });
      plotText(svg, x, height - bottom + 24, ordinate(maxDistance * fraction),
        { 'text-anchor': 'middle', 'font-size': 11 });
    }
    plotText(svg, 12, 18, 'kg CO₂e', { 'font-weight': 700 });
    plotText(svg, width / 2, height - 13, 'Distance travelled (km)',
      { 'text-anchor': 'middle', 'font-size': 12 });
    for (const record of points) {
      const kilometres = Number(record.distanceKm);
      const kilograms = Number(record.co2eKg ?? record.emissionsKg);
      const body = typeName(record.bodyType);
      const circle = svgElement('circle', {
        cx: left + plotWidth * kilometres / maxDistance,
        cy: top + plotHeight * (1 - kilograms / maxEmission),
        r: 6, fill: colours.get(body), 'fill-opacity': .83,
        stroke: '#FFFFFF', 'stroke-width': 1.5,
      });
      chartTitle(circle, `${body} · ${common.fixed(kilometres, 1)} km · ${common.fixed(kilograms, 2)} kg CO₂e`);
      svg.appendChild(circle);
    }
    return points.length;
  };
  const drawIntensity = (svg, records) => {
    svg.replaceChildren();
    const types = new Map();
    for (const record of records) {
      const body = typeName(record.bodyType);
      if (!types.has(body)) types.set(body, { distance: 0, emissions: 0 });
      types.get(body).distance += Number(record.distanceKm);
      types.get(body).emissions += Number(record.co2eKg ?? record.emissionsKg);
    }
    const items = [...types.entries()]
      .map(([body, totals]) => ({ body, ...totals,
        intensity: totals.distance > 0 ? 100 * totals.emissions / totals.distance : 0 }))
      .filter((item) => item.distance > 0)
      .sort((a, b) => b.intensity - a.intensity);
    if (!items.length) {
      emptyFigure(svg, 'Record journeys to compare vehicle classes.');
      return 0;
    }
    const height = Math.max(350, items.length * 49 + 114);
    svg.setAttribute('viewBox', `0 0 680 ${height}`);
    const width = 680;
    const left = 125, right = 98, top = 55, bottom = 69;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const max = Math.max(1, ...items.map((item) => item.intensity)) * 1.18;
    for (let tick = 0; tick <= 4; tick++) {
      const x = left + plotWidth * tick / 4;
      svg.appendChild(svgElement('line', {
        x1: x, y1: top - 10, x2: x, y2: height - bottom,
        stroke: '#E7DCCF',
      }));
      plotText(svg, x, height - bottom + 24, ordinate(max * tick / 4),
        { 'text-anchor': 'middle', 'font-size': 11 });
    }
    const cell = plotHeight / items.length;
    items.forEach((item, index) => {
      const y = top + index * cell + cell * .20;
      const barHeight = cell * .60;
      const barWidth = plotWidth * item.intensity / max;
      const colour = typePalette[item.body] || palette[(index + 4) % palette.length];
      plotText(svg, left - 13, y + barHeight / 2 + 4, item.body.slice(0, 17),
        { 'text-anchor': 'end', 'font-size': 12, 'font-weight': 650 });
      const bar = svgElement('rect', {
        x: left, y, width: barWidth, height: barHeight,
        rx: 4, fill: colour,
      });
      chartTitle(bar, `${item.body}: ${common.fixed(item.intensity, 2)} kg CO₂e/100 km · ${common.fixed(item.distance, 0)} km travelled`);
      svg.appendChild(bar);
      plotText(svg, Math.min(width - 15, left + barWidth + 11), y + barHeight / 2 + 4,
        common.fixed(item.intensity, 1), { 'font-size': 11, 'font-weight': 700 });
    });
    plotText(svg, width / 2, height - 13, 'kg CO₂e per 100 km',
      { 'text-anchor': 'middle', 'font-size': 12 });
    return items.length;
  };
  const renderSummary = (records, journeyCount) => {
    const distance = records.reduce((total, record) => total + Number(record.distanceKm), 0);
    const kilograms = records.reduce((total, record) =>
      total + Number(record.co2eKg ?? record.emissionsKg), 0);
    byId('vehicle-total-emissions').textContent = common.fixed(kilograms / 1000, 4);
    byId('vehicle-total-distance').textContent = common.fixed(distance, 1);
    byId('vehicle-total-journeys').textContent = common.fixed(journeyCount, 0);
    byId('vehicle-average-intensity').textContent = common.fixed(
      distance > 0 ? kilograms * 1000 / distance : 0, 1);
  };
  const renderFigures = () => {
    let records = [];
    try { records = common.readRecords().filter((record) => record.mode === 'vehicle'); }
    catch (error) { status.textContent = error.message; }
    const validRecords = records.filter((record) =>
      Number.isFinite(Number(record.co2eKg ?? record.emissionsKg)) &&
      Number(record.distanceKm) > 0);
    renderSummary(validRecords, records.length);
    const monthlyPeriods = drawMonthly(byId('vehicle-monthly-figure'), validRecords);
    byId('vehicle-monthly-caption').textContent = monthlyPeriods
      ? `${monthlyPeriods} month(s) with journeys in the displayed 12-month period. Colours distinguish landscapes, not fuel types.`
      : 'No dated vehicle journeys with emissions are available yet.';
    const pointCount = drawScatter(byId('vehicle-scatter-figure'), validRecords);
    byId('vehicle-scatter-caption').textContent = pointCount
      ? `${pointCount} journeys plotted. Hover over a point for distance and emissions.`
      : 'No vehicle journeys available for this comparison.';
    const typeCount = drawIntensity(byId('vehicle-source-figure'), validRecords);
    byId('vehicle-source-caption').textContent = typeCount
      ? `${typeCount} body type(s) compared. Each value is total CO₂e divided by total distance × 100 (not a simple average of journey intensities).`
      : 'No body-type intensity values available yet.';
  };

  const saveJourney = (event) => {
    event.preventDefault();
    const error = byId('vehicle-form-error');
    error.textContent = '';
    try {
      const driverName = byId('vehicle-driver').value.trim();
      const landscape = byId('vehicle-landscape').value.trim();
      const date = byId('vehicle-trip-date').value;
      const registration = byId('vehicle-registration').value.trim();
      const selected = selectedVehicle();
      if (!driverName) throw new Error('Enter the driver or person recording the journey.');
      if (!landscape) throw new Error('Enter the operating landscape.');
      if (!common.safeDate(date)) throw new Error('Enter a valid journey date.');
      if (!selected) throw new Error('Choose a vehicle variant from the matching results.');
      if (selectedAsset && registration !== selectedAsset.registration) {
        throw new Error('Registration was edited after asset selection. Select the correct asset again or clear the asset selection.');
      }
      if (!selectedYearIsValid()) throw new Error('The selected model year and variant do not match.');
      const result = calculator.calculateTrip(selected,
        byId('vehicle-trip-km').value, preferences.get());
      const id = editingRecord?.id || (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID() : `vehicle-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const retainingAsset = Boolean(editingRecord &&
        editingRecord.vehicleCatalogueId === selected.id &&
        byId('vehicle-asset-id').value.trim() === (editingRecord.assetId || ''));
      const wasEditing = Boolean(editingRecord);
      const record = {
        ...(editingRecord || {}),
        id,
        mode: 'vehicle',
        date,
        driverName,
        registrationNumber: registration,
        assetId: selectedAsset?.assetId || (retainingAsset ? editingRecord.assetId : ''),
        privateFleetAssetKey: selectedAsset?.id ||
          (retainingAsset ? editingRecord.privateFleetAssetKey || '' : ''),
        landscape,
        ownership: byId('vehicle-ownership').value,
        name: common.label(selected),
        vehicleCatalogueId: selected.id,
        vehicleSourceRow: selected.sourceRow ?? null,
        modelYear: common.numeric(byId('vehicle-year-search').value),
        modelPeriod: selected.years,
        fuelType: selected.fuel,
        powertrain: selected.technology,
        bodyType: selected.body,
        emissionsKg: result.operationalCo2eKg,
        co2eKg: result.operationalCo2eKg,
        co2Kg: result.fuelCo2Kg,
        ...result,
        energyCostRand: result.currency === 'ZAR' ? result.energyCostLocal : null,
        createdAt: editingRecord?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const older = common.readRecords();
      if (wasEditing && !older.some((item) => item.id === id && item.mode === 'vehicle')) {
        throw new Error('The record being edited no longer exists. No changes were saved.');
      }
      common.writeRecords(wasEditing
        ? older.map((item) => item.id === id ? record : item)
        : [...older, record]);
      clearForm();
      renderRecords();
      renderFigures();
      status.textContent = wasEditing
        ? 'Journey updated in local storage. Totals, figures and backups reflect the replacement record.'
        : 'Journey saved locally. Updated vehicle figures and full JSON backup now include this record.';
    } catch (exception) { error.textContent = exception.message; }
  };
  const clearForm = () => {
    editingRecord = null;
    byId('vehicle-form').reset();
    byId('vehicle-save').textContent = 'Save vehicle journey';
    byId('vehicle-cancel-edit').hidden = true;
    byId('vehicle-edit-status').hidden = true;
    byId('vehicle-edit-status').textContent = '';
    byId('vehicle-trip-date').value = common.today();
    byId('vehicle-trip-select').value = '';
    byId('vehicle-fleet-asset').value = '';
    byId('vehicle-asset-id').value = '';
    selectedAsset = null;
    selectedId = '';
    common.empty(suggestions);
    byId('vehicle-selection-note').textContent =
      'Select an imported fleet asset or search for one of the eight owned-fleet variants.';
    byId('vehicle-form-error').textContent = '';
    preview();
  };
  const exportRecords = () => {
    const fields = ['date', 'driverName', 'assetId', 'registrationNumber', 'landscape', 'ownership',
      'name', 'modelYear', 'modelPeriod', 'vehicleSourceRow', 'distanceKm', 'fuelLitres',
      'gridKwh', 'fuelCo2Kg', 'fuelCo2eKg', 'gridCo2eKg', 'co2eKg', 'gramsCo2ePerKm',
      'band', 'method', 'dataStatus', 'fuelFactorProfile', 'fuelFactorYear',
      'gridFactor', 'gridFactorYear', 'chargingEfficiency', 'country', 'location',
      'currency', 'energyCostLocal'];
    common.exportCsv(common.readRecords().filter((entry) => entry.mode === 'vehicle'),
      fields, `Wild-Impact-Vehicle-Journeys-${common.today()}.csv`);
  };


  const privateFleetStatus = byId('vehicle-fleet-status');
  const selectAsset = byId('vehicle-fleet-asset');
  const renderFleetAssets = () => {
    const assets = common.readPrivateFleet();
    common.empty(selectAsset);
    selectAsset.appendChild(new Option(
      assets.length ? 'Select a registered fleet asset (or manually select a model)' :
        'Import your private fleet CSV first, or select a model below', ''));
    for (const asset of assets) {
      const descriptive = `${asset.assetId} · ${asset.registration} · ${asset.brand} ${asset.model} (${asset.year})`;
      const option = new Option(descriptive, asset.id);
      option.disabled = !asset.modelId;
      selectAsset.appendChild(option);
    }
    privateFleetStatus.textContent = assets.length
      ? `${assets.length} private fleet assets stored on this device. ` +
        'Registration numbers and asset IDs are not part of the public model catalogue.'
      : 'Private fleet not imported on this device. You can calculate from the fleet-model catalogue, ' +
        'but an individual asset cannot be identified until its register is imported.';
    return assets;
  };
  const chooseAsset = () => {
    const asset = common.readPrivateFleet().find((item) => item.id === selectAsset.value);
    selectedAsset = asset || null;
    if (!asset) {
      byId('vehicle-asset-id').value = '';
      return;
    }
    const model = vehicleById.get(asset.modelId);
    if (!model) { status.textContent = 'Selected asset has no compatible fleet specification.'; return; }
    byId('vehicle-asset-id').value = asset.assetId;
    byId('vehicle-registration').value = asset.registration;
    byId('vehicle-landscape').value = asset.landscape;
    byId('vehicle-year-search').value = asset.year;
    byId('vehicle-ownership').value = 'company';
    chooseVehicle(model);
    byId('vehicle-selection-note').textContent += ' · Selected from private owned fleet register.';
  };
  selectAsset.addEventListener('change', chooseAsset);
  byId('vehicle-fleet-file').addEventListener('change', async (event) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 1000000) throw new Error('Fleet CSV exceeds the 1 MB limit.');
      const source = new TextDecoder('windows-1252').decode(await file.arrayBuffer());
      const imported = common.parseFleetCsv(source, vehicles);
      const confirmed = window.confirm(`Load ${imported.assets.length} private assets on this device? ` +
        'This replaces any previously imported private fleet list but preserves saved journey records.');
      if (!confirmed) return;
      common.writePrivateFleet(imported.assets);
      const assets = renderFleetAssets();
      privateFleetStatus.textContent = `${assets.length} assets imported; ` +
        `${imported.matched} matched to supported fleet specifications. ` +
        (imported.warnings.length ? imported.warnings.join(' ') : 'No duplicate IDs or unmatched models found.');
      status.textContent = 'Private fleet loaded in local browser storage. It was not uploaded to GitHub.';
    } catch (error) {
      privateFleetStatus.textContent = 'Import failed: ' + error.message;
    } finally { input.value = ''; }
  });
  byId('vehicle-fleet-clear').addEventListener('click', () => {
    if (!window.confirm('Forget the private asset register on this device? Existing journey records remain.')) return;
    common.clearPrivateFleet();
    selectedAsset = null;
    selectAsset.value = '';
    byId('vehicle-asset-id').value = '';
    renderFleetAssets();
    status.textContent = 'Local asset register cleared. Saved journeys have not been deleted.';
  });
  renderFleetAssets();

  preferences = common.controls(() => preview());
  byId('vehicle-trip-date').value = common.today();
  byId('vehicle-model-search').addEventListener('input', () => {
    if (selectedAsset) byId('vehicle-registration').value = '';
    selectedAsset = null;
    byId('vehicle-fleet-asset').value = '';
    byId('vehicle-asset-id').value = '';
    selectedId = '';
    byId('vehicle-trip-select').value = '';
    renderSuggestions();
    preview();
  });
  byId('vehicle-year-search').addEventListener('input', () => {
    if (selectedAsset && String(selectedAsset.year) !== byId('vehicle-year-search').value) {
      selectedAsset = null;
      byId('vehicle-fleet-asset').value = '';
      byId('vehicle-asset-id').value = '';
    }
    if (!selectedYearIsValid()) {
      selectedId = '';
      byId('vehicle-trip-select').value = '';
      byId('vehicle-selection-note').textContent = 'Choose a variant matching the selected year.';
    }
    renderSuggestions();
    preview();
  });
  byId('vehicle-model-search').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      common.empty(suggestions);
      byId('vehicle-model-search').setAttribute('aria-expanded', 'false');
    }
    if (event.key === 'Enter') {
      const first = modelMatches()[0];
      if (first) {
        event.preventDefault();
        chooseVehicle(first);
      }
    }
  });
  byId('vehicle-trip-km').addEventListener('input', preview);
  byId('vehicle-form').addEventListener('submit', saveJourney);
  byId('vehicle-clear').addEventListener('click', clearForm);
  byId('vehicle-cancel-edit').addEventListener('click', clearForm);
  byId('vehicle-record-search').addEventListener('input', renderRecords);
  byId('vehicle-export').addEventListener('click', () => {
    try { exportRecords(); }
    catch (error) { status.textContent = error.message; }
  });
  const directVehicle = new URLSearchParams(window.location.search).get('model');
  if (vehicleById.has(directVehicle)) chooseVehicle(vehicleById.get(directVehicle));
  renderRecords();
  renderFigures();
  preview();
  status.textContent = 'Owned-fleet carbon accounting is ready. Imported asset identifiers remain on this device.';
})().catch((error) => {
  const target = document.getElementById('vehicle-status');
  if (target) {
    target.classList.add('is-error');
    target.textContent = 'Vehicle carbon calculator could not start: ' + error.message;
  }
  console.error('Wild Impact vehicle calculator:', error);
});
