'use strict';

/* Wild Impact | distance-only road-vehicle accounting.
 * The public catalogue is an unverified research dataset, not an odometer or fuel log.
 * CO2 and CO2e must not be interchanged. Electricity results are reported as CO2e.
 */
(function (root, buildModule) {
  const calculator = buildModule();
  root.WildImpactVehicle = calculator;
  if (typeof module !== 'undefined' && module.exports) module.exports = calculator;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const bandLimits = [120, 160, 200, 250];
  const fuelTechnology = new Set(['Combustion Engine', 'Mild Hybrid', 'Full Hybrid']);
  const validNumber = (value) => value !== null && value !== undefined && value !== '' &&
    Number.isFinite(Number(value));
  const positive = (value) => validNumber(value) && Number(value) > 0;
  const fuelFactors = Object.freeze({
    petrol: Object.freeze({ co2: 2.06107, co2e: 2.075 }),
    diesel: Object.freeze({ co2: 2.55035, co2e: 2.58354 }),
  });
  const fuelFactorSource = 'UK DESNZ 2026, average biofuel blend; direct combustion only';

  const category = (gramsCo2eKm) => {
    if (!Number.isFinite(gramsCo2eKm)) return null;
    const index = bandLimits.findIndex((limit) => gramsCo2eKm <= limit);
    return 'ABCDE'[index < 0 ? 4 : index];
  };
  const modelFamilyKey = (vehicle) => {
    return [vehicle.brand, vehicle.model].map((value) =>
      String(value || '').trim().toLocaleLowerCase('en-GB')).join('::');
  };
  const yearRange = (vehicle) => {
    const range = String(vehicle.years || '');
    const years = [...range.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
    return {
      from: years[0] ?? null,
      to: /present|current|ongoing/i.test(range) ? Infinity : (years[1] ?? years[0] ?? null),
    };
  };
  const matchesYear = (vehicle, year) => {
    if (!validNumber(year)) return true;
    const integerYear = Number(year);
    if (!Number.isInteger(integerYear)) return false;
    const years = yearRange(vehicle);
    return years.from !== null && integerYear >= years.from && integerYear <= years.to;
  };

  const profile = (vehicle, preferences) => {
    const assessment = {
      status: 'data-deficient',
      rationale: 'Insufficient specification data for a defensible distance-only estimate.',
      fuelL100: null,
      gridKwh100: null,
      fuelCo2Kg100: null,
      fuelCo2eKg100: null,
      gridCo2eKg100: null,
      co2eKg100: null,
      energyCost100: null,
      band: null,
      caveats: [...(vehicle.warnings || [])],
    };
    const fuel = String(vehicle.fuel || '').toLowerCase();
    const technology = String(vehicle.technology || '');
    const consumption = Number(vehicle.fuelL100);
    const efficiency = Number(preferences.chargingEfficiency);
    const gridFactor = Number(preferences.gridFactor);

    if (fuelTechnology.has(technology)) {
      if (!positive(consumption) || !['petrol', 'diesel'].includes(fuel)) {
        assessment.rationale = 'No usable combined fuel consumption and supported petrol/diesel classification.';
        return assessment;
      }
      const factor = fuelFactors[fuel];
      assessment.status = 'fleet-specification-estimate';
      assessment.rationale = 'Fleet-reported L/100 km × distance; actual driving conditions may differ.';
      assessment.fuelL100 = consumption;
      assessment.gridKwh100 = 0;
      assessment.fuelCo2Kg100 = consumption * factor.co2;
      assessment.fuelCo2eKg100 = consumption * factor.co2e;
      assessment.gridCo2eKg100 = 0;
      assessment.co2eKg100 = assessment.fuelCo2eKg100;
      const price = fuel === 'diesel' ? preferences.dieselPrice : preferences.petrolPrice;
      if (positive(price)) assessment.energyCost100 = consumption * Number(price);
    } else if (technology === 'Battery Electric') {
      const capacity = positive(vehicle.batteryUsableKwh) ? Number(vehicle.batteryUsableKwh)
        : positive(vehicle.batteryGrossKwh) ? Number(vehicle.batteryGrossKwh) : null;
      if (capacity === null || !positive(vehicle.electricRangeKm)) {
        assessment.rationale = 'Battery capacity or claimed electric range is missing.';
        return assessment;
      }
      if (!(efficiency > 0 && efficiency <= 1)) {
        assessment.rationale = 'Charging-efficiency assumption is not valid.';
        return assessment;
      }
      if (!positive(preferences.gridFactor)) {
        assessment.rationale = 'The selected country/location has no documented grid emission factor.';
        return assessment;
      }
      const gridKwh100 = 100 * capacity / Number(vehicle.electricRangeKm) / efficiency;
      if (gridKwh100 < 5 || gridKwh100 > 85) {
        assessment.rationale = 'Battery/range values imply an implausible energy demand; verify specifications.';
        return assessment;
      }
      assessment.status = positive(vehicle.batteryUsableKwh) ? 'screening-usable' : 'screening-gross';
      assessment.rationale = 'Battery capacity ÷ stated range ÷ assumed charging efficiency: provisional estimate.';
      assessment.fuelL100 = 0;
      assessment.gridKwh100 = gridKwh100;
      assessment.fuelCo2Kg100 = 0;
      assessment.fuelCo2eKg100 = 0;
      assessment.gridCo2eKg100 = gridKwh100 * gridFactor;
      assessment.co2eKg100 = assessment.gridCo2eKg100;
      if (positive(preferences.electricityPrice)) {
        assessment.energyCost100 = gridKwh100 * Number(preferences.electricityPrice);
      }
      assessment.caveats.push('No recorded charging electricity: estimate is battery/range-derived.');
      if (!positive(vehicle.batteryUsableKwh)) {
        assessment.caveats.push('Gross rather than usable battery capacity was supplied.');
      }
    } else if (technology === 'Plug-in Hybrid') {
      assessment.rationale = 'Plug-in hybrid: the distance alone does not reveal the petrol/electric driving split.';
      assessment.caveats.push('Combined-cycle PHEV fuel consumption cannot be added to electric charging estimates.');
      return assessment;
    } else {
      assessment.rationale = 'Unsupported powertrain.';
      return assessment;
    }
    assessment.band = category(assessment.co2eKg100 * 10);
    return assessment;
  };

  const calculateDistance = (vehicle, kilometres, preferences) => {
    const distance = Number(kilometres);
    if (!positive(kilometres)) throw new Error('Enter a positive distance travelled in kilometres.');
    if (!vehicle) throw new Error('Select a vehicle and model variant.');
    const assessment = profile(vehicle, preferences);
    if (assessment.co2eKg100 === null) {
      throw new Error('Data deficient: ' + assessment.rationale);
    }
    const ratio = distance / 100;
    return {
      distanceKm: distance,
      fuelLitres: assessment.fuelL100 * ratio,
      gridKwh: assessment.gridKwh100 * ratio,
      fuelCo2Kg: assessment.fuelCo2Kg100 * ratio,
      fuelCo2eKg: assessment.fuelCo2eKg100 * ratio,
      gridCo2eKg: assessment.gridCo2eKg100 * ratio,
      operationalCo2eKg: assessment.co2eKg100 * ratio,
      gramsCo2ePerKm: assessment.co2eKg100 * 10,
      band: assessment.band,
      energyCostLocal: assessment.energyCost100 === null ? null : assessment.energyCost100 * ratio,
      method: assessment.rationale,
      fuelFactorProfile: '2026-average-biofuel-blend',
      fuelFactorYear: 2026,
      gridFactor: Number(preferences.gridFactor),
      gridFactorYear: String(preferences.gridFactorYear || 'custom'),
      currency: String(preferences.currency || 'ZAR'),
      country: String(preferences.country || 'ZA'),
      location: String(preferences.location || ''),
      chargingEfficiency: Number(preferences.chargingEfficiency),
      dataStatus: assessment.status,
    };
  };

  const rankVariants = (rows, sort = 'emissions', requireAllPrices = false) => {
    const eligible = rows.filter((row) => {
      return row.assessment.co2eKg100 !== null &&
        (!requireAllPrices || row.assessment.energyCost100 !== null);
    });
    const costOrder = [...eligible].sort((a, b) => a.assessment.energyCost100 - b.assessment.energyCost100);
    const emissionOrder = [...eligible].sort((a, b) => a.assessment.co2eKg100 - b.assessment.co2eKg100);
    const costRanks = new Map(costOrder.map((row, index) => [row.vehicle.id, index]));
    const emissionRanks = new Map(emissionOrder.map((row, index) => [row.vehicle.id, index]));
    return [...eligible].sort((left, right) => {
      const a = left.assessment;
      const b = right.assessment;
      if (sort === 'cost') return a.energyCost100 - b.energyCost100 || a.co2eKg100 - b.co2eKg100;
      if (sort === 'balanced') {
        const aScore = emissionRanks.get(left.vehicle.id) + costRanks.get(left.vehicle.id);
        const bScore = emissionRanks.get(right.vehicle.id) + costRanks.get(right.vehicle.id);
        return aScore - bScore || a.co2eKg100 - b.co2eKg100;
      }
      return a.co2eKg100 - b.co2eKg100;
    });
  };
  const shortlistFamilies = (rows, sort = 'emissions', count = 10) => {
    const ranked = rankVariants(rows, sort, sort === 'cost' || sort === 'balanced');
    const families = new Set();
    const result = [];
    for (const row of ranked) {
      const family = modelFamilyKey(row.vehicle);
      if (families.has(family)) continue;
      families.add(family);
      result.push(row);
      if (result.length >= count) break;
    }
    return result;
  };

  return Object.freeze({
    factors: fuelFactors,
    fuelFactorSource,
    getTier: category,
    modelFamilyKey,
    yearRange,
    matchesYear,
    describeVehicle: profile,
    calculateTrip: calculateDistance,
    rankVariants,
    shortlistFamilies,
  });
});
