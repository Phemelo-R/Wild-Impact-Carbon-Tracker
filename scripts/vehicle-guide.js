'use strict';

/* Vehicle Guide: model-family cards, unique-family top ten and local-cost comparison. */
(async () => {
  const common = WildImpactVehicleCommon;
  const api = WildImpactVehicle;
  const byId = common.byId;
  const reference = await common.loadCatalogue();
  const vehicles = reference.vehicles;
  const selectedIds = new Set();
  const openFamilies = new Set();
  const status = byId('vehicle-status');
  let preferences;
  let shownFamilies = 18;
  let bodyFilter = '';

  const fillFilter = (id, values) => {
    const select = byId(id);
    const options = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
    for (const value of options) select.appendChild(new Option(value, value));
  };
  fillFilter('vehicle-brand', vehicles.map((vehicle) => vehicle.brand));
  fillFilter('vehicle-technology', vehicles.map((vehicle) => vehicle.technology));
  fillFilter('vehicle-fuel', vehicles.map((vehicle) => vehicle.fuel));
  const availableYears = [...new Set(vehicles.flatMap((vehicle) => {
    const bounds = api.yearRange(vehicle);
    return bounds.from ? [bounds.from] : [];
  }))].sort((a, b) => a - b);
  for (const year of availableYears) {
    byId('vehicle-year').appendChild(new Option(String(year), String(year)));
  }

  const sortedBodies = ['Pick-up', 'MPV', 'Motorcycle'];
  const bodyPicker = byId('vehicle-body-picker');
  const makeBody = (name, text) => {
    const button = common.node('button', 'vehicle-body-choice');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(bodyFilter === name));
    button.dataset.body = name;
    if (name) button.appendChild(common.bodyIcon(name));
    else button.appendChild(common.node('span', 'vehicle-all-bodies-icon', 'ALL'));
    button.appendChild(common.node('span', '', text));
    button.addEventListener('click', () => {
      bodyFilter = name;
      for (const choice of bodyPicker.querySelectorAll('button')) {
        choice.setAttribute('aria-pressed', String(choice.dataset.body === bodyFilter));
      }
      shownFamilies = 18;
      render();
    });
    return button;
  };
  bodyPicker.appendChild(makeBody('', 'All types'));
  for (const body of sortedBodies) {
    if (vehicles.some((vehicle) => vehicle.body === body)) {
      bodyPicker.appendChild(makeBody(body, body));
    }
  }

  const filteredRows = () => {
    const normaliseSearch = (text) => String(text).normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim();
    const query = normaliseSearch(byId('vehicle-search').value);
    const year = byId('vehicle-year').value;
    const make = byId('vehicle-brand').value;
    const technology = byId('vehicle-technology').value;
    const fuel = byId('vehicle-fuel').value;
    const band = byId('vehicle-band').value;
    const settings = preferences.get();
    return vehicles.flatMap((vehicle) => {
      const keywords = normaliseSearch([vehicle.brand, vehicle.model,
        vehicle.variant, vehicle.years].filter(Boolean).join(' '));
      if (query && !keywords.includes(query)) return [];
      if (year && !api.matchesYear(vehicle, year)) return [];
      if (make && vehicle.brand !== make) return [];
      if (bodyFilter && vehicle.body !== bodyFilter) return [];
      if (technology && vehicle.technology !== technology) return [];
      if (fuel && vehicle.fuel !== fuel) return [];
      const assessment = api.describeVehicle(vehicle, settings, reference);
      if (band === 'unrated' && assessment.co2eKg100 !== null) return [];
      if (band && band !== 'unrated' && assessment.band !== band) return [];
      return [{ vehicle, assessment }];
    });
  };
  const rankedRows = (rows) => {
    const sort = byId('vehicle-sort').value;
    const requiresPrice = sort === 'cost' || sort === 'balanced';
    const incomplete = rows.some((row) =>
      row.assessment.co2eKg100 !== null && row.assessment.energyCost100 === null);
    byId('vehicle-sort-warning').textContent = requiresPrice && incomplete
      ? 'Some comparable model variants have no energy price for the selected currency. ' +
        'Those variants are excluded from the cost-based recommendation, not assigned zero cost.'
      : '';
    return api.rankVariants(rows, sort, requiresPrice);
  };
  const costOrDash = (value) => value === null
    ? 'Cost unavailable' : common.renderCurrency(value, preferences.get());
  const energyLabel = (assessment) => {
    if (assessment.status === 'data-deficient') return 'No reliable distance-only rate';
    if (assessment.fuelL100 > 0) return `${common.fixed(assessment.fuelL100, 2)} L/100 km`;
    return `${common.fixed(assessment.gridKwh100, 2)} kWh/100 km (estimated)`;
  };
  const bandChip = (assessment) => common.node('span',
    `vehicle-band-pill vehicle-band-${assessment.band || 'none'}`,
    assessment.band ? `Category ${assessment.band}` : 'Not rated');

  const addComparison = (vehicleId) => {
    if (selectedIds.has(vehicleId)) selectedIds.delete(vehicleId);
    else if (selectedIds.size >= 3) {
      byId('vehicle-sort-warning').textContent =
        'You can compare three derivatives at a time. Remove a selection first.';
      return;
    } else selectedIds.add(vehicleId);
    renderComparison();
    renderFamilies();
  };
  const renderComparison = () => {
    const container = byId('vehicle-comparison-rows');
    common.empty(container);
    const settings = preferences.get();
    for (const id of selectedIds) {
      const vehicle = vehicles.find((item) => item.id === id);
      if (!vehicle) continue;
      const assessment = api.describeVehicle(vehicle, settings, reference);
      const card = common.node('article', 'vehicle-compare-card');
      card.appendChild(common.node('strong', '', `${vehicle.brand} ${vehicle.model}`));
      card.appendChild(common.node('p', '', vehicle.variant || 'Unspecified variant'));
      card.appendChild(common.node('p', 'vehicle-hint', `Engine power as reported: ${vehicle.powerReported ?? 'not supplied'} (unit not specified)`));
      card.appendChild(common.node('p', '', `Production: ${vehicle.years}`));
      card.appendChild(common.node('p', '', energyLabel(assessment)));
      card.appendChild(common.node('p', '', assessment.co2eKg100 === null
        ? 'Data deficient' : `${common.fixed(assessment.co2eKg100 * 10, 1)} g CO₂e/km`));
      card.appendChild(common.node('p', '',
        `Energy cost / 100 km: ${costOrDash(assessment.energyCost100)}`));
      card.appendChild(bandChip(assessment));
      container.appendChild(card);
    }
    if (!selectedIds.size) {
      container.appendChild(common.node('p', 'vehicle-hint',
        'Expand owned-fleet model families and choose up to three variants to compare here.'));
    }
  };
  const familiesFor = (rows) => {
    const grouped = new Map();
    for (const row of rows) {
      const key = api.modelFamilyKey(row.vehicle);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    return [...grouped.values()].sort((left, right) => {
      const a = `${left[0].vehicle.brand} ${left[0].vehicle.model}`;
      const b = `${right[0].vehicle.brand} ${right[0].vehicle.model}`;
      return a.localeCompare(b);
    });
  };
  const renderShortlist = (rows) => {
    const container = byId('vehicle-purchase-rows');
    common.empty(container);
    const method = byId('vehicle-sort').value;
    const grouped = new Map();
    for (const row of rows) {
      const kind = row.vehicle.body;
      if (!grouped.has(kind)) grouped.set(kind, []);
      grouped.get(kind).push(row);
    }
    let numberOfModels = 0;
    for (const body of ['Pick-up', 'MPV', 'Motorcycle']) {
      if (!grouped.has(body)) continue;
      const shortlist = api.shortlistFamilies(grouped.get(body), method, 10);
      if (!shortlist.length) continue;
      const section = common.node('section', 'vehicle-recommendation-group');
      const heading = common.node('div', 'vehicle-recommendation-group-title');
      heading.appendChild(common.bodyIcon(body));
      heading.appendChild(common.node('h3', '', `${body} · owned-fleet replacement candidates`));
      section.appendChild(heading);
      const grid = common.node('div', 'vehicle-purchase-rows');
      for (let index = 0; index < shortlist.length; index++) {
        const entry = shortlist[index];
        const assessment = entry.assessment;
        const vehicle = entry.vehicle;
        const card = common.node('article', 'vehicle-shortlist-card');
        const top = common.node('div', 'vehicle-shortlist-title');
        top.appendChild(common.node('span', 'vehicle-shortlist-rank',
          String(index + 1).padStart(2, '0')));
        top.appendChild(common.node('strong', '', `${vehicle.brand} ${vehicle.model}`));
        card.appendChild(top);
        card.appendChild(bandChip(assessment));
        card.appendChild(common.node('p', '', vehicle.variant || 'Variant not supplied'));
      card.appendChild(common.node('p', 'vehicle-hint', `Engine power as reported: ${vehicle.powerReported ?? 'not supplied'} (unit not specified)`));
        card.appendChild(common.node('p', 'vehicle-hint', `Recorded model year: ${vehicle.years}`));
        card.appendChild(common.node('p', '', `${common.fixed(assessment.co2eKg100 * 10, 1)} g CO₂e/km`));
        card.appendChild(common.node('p', '', energyLabel(assessment)));
        card.appendChild(common.node('p', '', `${costOrDash(assessment.energyCost100)} / 100 km`));
        const jump = common.node('a', 'vehicle-small-button', 'Estimate this model');
        jump.href = `./vehicles.html?model=${encodeURIComponent(vehicle.id)}`;
        card.appendChild(jump);
        grid.appendChild(card);
        numberOfModels++;
      }
      section.appendChild(grid);
      container.appendChild(section);
    }
    if (!numberOfModels) container.appendChild(common.node('p', 'vehicle-note',
      'No owned models satisfy the current filters and any selected price requirements.'));
    byId('vehicle-purchase-summary').textContent = numberOfModels
      ? `${numberOfModels} already-owned model families shown within their own vehicle classes. ` +
        'A motorcycle never competes with a pick-up for a like-for-like purchasing recommendation. ' +
        'Fuel use and carbon alone do not establish suitability, reliability or total ownership cost.'
      : 'A data-deficient model cannot be recommended as a low-emission replacement.';
  };
  const renderFamilies = () => {
    const rows = filteredRows();
    const families = familiesFor(rows);
    const container = byId('vehicle-family-grid');
    common.empty(container);
    const sorted = rankedRows(rows);
    const rankedId = new Map(sorted.map((row, index) => [row.vehicle.id, index]));
    for (const variants of families.slice(0, shownFamilies)) {
      const vehicle = variants[0].vehicle;
      const best = [...variants].sort((a, b) =>
        (rankedId.get(a.vehicle.id) ?? Infinity) - (rankedId.get(b.vehicle.id) ?? Infinity))[0];
      const card = common.node('article', 'vehicle-family-card');
      const top = common.node('div', 'vehicle-family-head');
      top.appendChild(common.bodyIcon(vehicle.body));
      const heading = common.node('div');
      heading.appendChild(common.node('h3', '', `${vehicle.brand} ${vehicle.model}`));
      heading.appendChild(common.node('p', 'vehicle-hint',
        `${variants.length} matching derivative${variants.length === 1 ? '' : 's'} · ${vehicle.body}`));
      const localAssets = common.readPrivateFleet().filter((asset) =>
        variants.some((row) => row.vehicle.id === asset.modelId));
      if (localAssets.length) {
        heading.appendChild(common.node('p', 'vehicle-hint',
          `${localAssets.length} owned asset${localAssets.length === 1 ? '' : 's'} in your private browser register`));
        const insurance = localAssets.map((asset) => asset.annualInsuranceZar)
          .filter((value) => value !== null && Number.isFinite(Number(value)) && Number(value) > 0);
        if (insurance.length) {
          const average = insurance.reduce((sum, value) => sum + Number(value), 0) / insurance.length;
          heading.appendChild(common.node('p', 'vehicle-hint',
            `Annual insurance (local private data): ZAR ${common.fixed(average, 2)} mean across ${insurance.length} asset(s); excluded from emissions.`));
        }
      }
      top.appendChild(heading);
      card.appendChild(top);
      if (best && best.assessment.co2eKg100 !== null) {
        const badge = bandChip(best.assessment);
        card.appendChild(badge);
        card.appendChild(common.node('p', 'vehicle-family-primary',
          `${common.fixed(best.assessment.co2eKg100 * 10, 1)} g CO₂e/km from its best matching derivative`));
      } else card.appendChild(common.node('p', 'vehicle-family-primary',
        'Data deficient — no qualifying distance-only emissions estimate'));
      const expandable = common.node('details', 'vehicle-family-detail');
      const familyKey = api.modelFamilyKey(vehicle);
      expandable.open = openFamilies.has(familyKey);
      expandable.addEventListener('toggle', () => {
        if (expandable.open) openFamilies.add(familyKey);
        else openFamilies.delete(familyKey);
      });
      const summary = common.node('summary', '', 'View model years and variants');
      expandable.appendChild(summary);
      const list = common.node('div', 'vehicle-family-variants');
      const sortedVariants = [...variants].sort((a, b) =>
        a.vehicle.years.localeCompare(b.vehicle.years) ||
        (a.vehicle.variant || '').localeCompare(b.vehicle.variant || ''));
      for (const row of sortedVariants) {
        const item = common.node('div', 'vehicle-variant-row');
        const info = common.node('div');
        info.appendChild(common.node('strong', '', row.vehicle.variant || 'Unspecified variant'));
        info.appendChild(common.node('p', 'vehicle-hint',
          `${row.vehicle.years} · ${row.vehicle.technology} · ${row.vehicle.fuel}`));
        info.appendChild(common.node('p', 'vehicle-hint',
          `Engine power as supplied: ${row.vehicle.powerReported ?? 'not supplied'} (unit not specified; excluded from emissions)`));
        info.appendChild(common.node('p', '', energyLabel(row.assessment)));
        info.appendChild(common.node('p', '', row.assessment.co2eKg100 === null
          ? 'Not rated · data deficient'
          : `${common.fixed(row.assessment.co2eKg100 * 10, 1)} g CO₂e/km · ` +
            `${costOrDash(row.assessment.energyCost100)} / 100 km`));
        item.appendChild(info);
        const actions = common.node('div', 'vehicle-variant-actions');
        actions.appendChild(bandChip(row.assessment));
        const choose = common.node('button', 'vehicle-small-button',
          selectedIds.has(row.vehicle.id) ? 'Remove' : 'Compare');
        choose.type = 'button';
        choose.addEventListener('click', () => addComparison(row.vehicle.id));
        actions.appendChild(choose);
        const calculate = common.node('a', 'vehicle-small-button', 'Calculate journey');
        calculate.href = `./vehicles.html?model=${encodeURIComponent(row.vehicle.id)}`;
        actions.appendChild(calculate);
        item.appendChild(actions);
        list.appendChild(item);
      }
      expandable.appendChild(list);
      card.appendChild(expandable);
      container.appendChild(card);
    }
    byId('vehicle-more').hidden = families.length <= shownFamilies;
    byId('vehicle-showing').textContent =
      `${Math.min(shownFamilies, families.length)} of ${families.length} model families shown.`;
    byId('vehicle-filter-status').textContent =
      `${families.length} matching model families. Grouped derivatives remain available inside each card.`;
    if (!families.length) container.appendChild(common.node('p', 'vehicle-note',
      'No model families match these filters. Change the year, category or body type.'));
  };
  const render = () => {
    const rows = filteredRows();
    rankedRows(rows);
    renderShortlist(rows);
    renderFamilies();
    renderComparison();
  };

  preferences = common.controls(() => { if (preferences) render(); });
  for (const id of ['vehicle-search','vehicle-brand','vehicle-year','vehicle-band',
    'vehicle-technology','vehicle-fuel','vehicle-sort']) {
    for (const eventName of ['input', 'change']) {
      byId(id).addEventListener(eventName, () => {
        shownFamilies = 18;
        render();
      });
    }
  }
  byId('vehicle-more').addEventListener('click', () => {
    shownFamilies += 18;
    renderFamilies();
  });
  byId('vehicle-compare-clear').addEventListener('click', () => {
    selectedIds.clear();
    renderComparison();
    renderFamilies();
  });
  const registeredAssets = common.readPrivateFleet();
  byId('vehicle-fleet-guide-status').textContent = registeredAssets.length
    ? `${registeredAssets.length} private owned assets available in this browser; “owned asset” counts are not public website data. Insurance figures, when present, are annual financial costs and never CO₂ inputs.`
    : 'Showing only the 8 published fleet-model specifications. To see asset counts and optional insurance, import your private fleet CSV on the Vehicles page; no identifying records are published.';
  render();
  status.textContent = 'Fleet Guide ready. Only models present in the supplied owned-fleet register are shown.';
})().catch((error) => {
  const target = document.getElementById('vehicle-status');
  if (target) {
    target.classList.add('is-error');
    target.textContent = 'Vehicle Guide could not start: ' + error.message;
  }
  console.error('Wild Impact Vehicle Guide:', error);
});
