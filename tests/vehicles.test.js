'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../scripts/vehicle-calculations.js');
const catalogue = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../data/vehicle-reference.json'), 'utf8'));
const vehicles = catalogue.vehicles;
const preferences = {
  country: 'ZA', currency: 'ZAR', location: 'South Africa',
  gridFactor: 0.960, gridFactorYear: '2024',
  chargingEfficiency: 0.90, petrolPrice: 25,
  dieselPrice: 23, electricityPrice: 3,
};
const close = (actual, expected, tolerance = 0.0000001) => {
  assert(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);
};

assert.equal(vehicles.length, 366);
assert.equal(new Set(vehicles.map((vehicle) => vehicle.id)).size, 366);
assert.equal(engine.factors.petrol.co2, 2.06107);
assert.equal(engine.factors.petrol.co2e, 2.075);
assert.equal(engine.factors.diesel.co2e, 2.58354);
assert.equal(catalogue.grid.nationalGeneration['2024'], 0.960);

const petrol = vehicles.find((vehicle) => vehicle.fuel === 'Petrol' &&
  vehicle.fuelL100 === 6.4 && vehicle.technology === 'Combustion Engine');
const diesel = vehicles.find((vehicle) => vehicle.fuel === 'Diesel' &&
  vehicle.fuelL100 > 0);
const electric = vehicles.find((vehicle) => vehicle.brand === 'Abarth' &&
  vehicle.model === '500e');
const plugIn = vehicles.find((vehicle) => vehicle.technology === 'Plug-in Hybrid');
assert(petrol && diesel && electric && plugIn);

const petrolTrip = engine.calculateTrip(petrol, 100, preferences);
close(petrolTrip.fuelLitres, 6.4);
close(petrolTrip.fuelCo2Kg, 6.4 * 2.06107);
close(petrolTrip.fuelCo2eKg, 6.4 * 2.075);
close(petrolTrip.operationalCo2eKg, 13.28);
close(petrolTrip.energyCostLocal, 160);
assert(petrolTrip.operationalCo2eKg > petrolTrip.fuelCo2Kg);

const dieselTrip = engine.calculateTrip(diesel, 200, preferences);
close(dieselTrip.fuelLitres, diesel.fuelL100 * 2);
close(dieselTrip.fuelCo2eKg, dieselTrip.fuelLitres * 2.58354);
assert.equal(dieselTrip.currency, 'ZAR');

const electricTrip = engine.calculateTrip(electric, 100, preferences);
assert(electricTrip.gridKwh > 0);
assert(electricTrip.operationalCo2eKg > 0);
close(electricTrip.operationalCo2eKg, electricTrip.gridKwh * 0.96);
assert.equal(electricTrip.fuelLitres, 0);
assert.equal(electricTrip.dataStatus.startsWith('screening'), true);

const customGridMissing = engine.describeVehicle(electric,
  { ...preferences, country: 'KE', gridFactor: null });
assert.equal(customGridMissing.status, 'data-deficient');
assert.throws(() => engine.calculateTrip(electric, 100,
  { ...preferences, gridFactor: null }), /Data deficient/);
assert.equal(engine.describeVehicle(plugIn, preferences).status, 'data-deficient');
assert.throws(() => engine.calculateTrip(plugIn, 200, preferences), /Data deficient/);
assert.throws(() => engine.calculateTrip(petrol, -50, preferences), /positive distance/);

const available = vehicles.map((vehicle) => ({
  vehicle,
  assessment: engine.describeVehicle(vehicle, preferences),
}));
assert(available.some((row) => row.assessment.band === 'A'));
assert(available.some((row) => row.assessment.band === 'E'));
assert(available.some((row) => row.assessment.band === null));
const recommendation = engine.shortlistFamilies(available, 'emissions', 10);
assert.equal(recommendation.length, 10);
assert.equal(new Set(recommendation.map((row) =>
  engine.modelFamilyKey(row.vehicle))).size, 10);
const costRecommendation = engine.shortlistFamilies(available, 'cost', 10);
assert.equal(costRecommendation.length, 10);
assert(costRecommendation.every((row) => row.assessment.energyCost100 !== null));

const yearVehicle = vehicles.find((vehicle) => vehicle.years === '2016–2019');
assert(yearVehicle);
assert(engine.matchesYear(yearVehicle, 2018));
assert(!engine.matchesYear(yearVehicle, 2024));
assert(engine.matchesYear(yearVehicle, ''));
const recentVehicle = vehicles.find((vehicle) => vehicle.years === '2024–Present');
assert(recentVehicle);
assert(engine.matchesYear(recentVehicle, 2026));

console.log('PASS: average-blend factors, distance-only CO₂/CO₂e, BEV, PHEV deficiency, currencies, model-year matching, ten unique model families.');
