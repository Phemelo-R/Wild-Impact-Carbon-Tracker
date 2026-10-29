'use strict';
// 2026 UK DESNZ petrol (100% mineral petrol), direct combustion, per litre.
// The DESNZ breakdown is published in kg CO₂-equivalent per litre for each gas.
// CH₄ and N₂O are divided by the UK 2026 AR5 GWP100 values to display their physical kg masses.
// Rounded breakdown values are constrained to the published 2.35372 kg CO₂e/L total.
const WILD_IMPACT_BOAT_FACTORS = Object.freeze({
  year: 2026,
  fuel: 'Petrol (100% mineral petrol)',
  co2: 2.33955,
  ch4Co2e: 0.00820,
  n2oCo2e: 0.00597,
  co2e: 2.35372,
  ch4Gwp: 28,
  n2oGwp: 265,
  source: 'https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026',
});
const calculateWildImpactBoat = (petrolLitres) => {
  const litres = Number(petrolLitres);
  if (!Number.isFinite(litres) || litres <= 0) throw new Error('Enter a positive, recorded petrol quantity in litres. No fuel estimates are used.');
  return {
    petrolLitres: litres,
    co2Kg: litres * WILD_IMPACT_BOAT_FACTORS.co2,
    ch4Kg: litres * WILD_IMPACT_BOAT_FACTORS.ch4Co2e / WILD_IMPACT_BOAT_FACTORS.ch4Gwp,
    n2oKg: litres * WILD_IMPACT_BOAT_FACTORS.n2oCo2e / WILD_IMPACT_BOAT_FACTORS.n2oGwp,
    co2eKg: litres * WILD_IMPACT_BOAT_FACTORS.co2e,
    factorYear: WILD_IMPACT_BOAT_FACTORS.year,
  };
};
if (typeof globalThis !== 'undefined') globalThis.WildImpactBoat = Object.freeze({
  factors: WILD_IMPACT_BOAT_FACTORS,
  calculate: calculateWildImpactBoat,
});
if (typeof module !== 'undefined' && module.exports) module.exports = { factors: WILD_IMPACT_BOAT_FACTORS, calculate: calculateWildImpactBoat };
