'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const documents = [
  ['pages/vehicles.html', 'scripts/vehicles.js'],
  ['pages/vehicle-guide.html', 'scripts/vehicle-guide.js'],
];
for (const [page, script] of documents) {
  const html = fs.readFileSync(path.join(repo, page), 'utf8');
  const javaScript = fs.readFileSync(path.join(repo, script), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  assert.equal(ids.size, [...html.matchAll(/\bid="([^"]+)"/g)].length,
    `Duplicate HTML id in ${page}`);
  const references = [...javaScript.matchAll(/\bbyId\('([^']+)'\)/g)].map((match) => match[1]);
  for (const id of references) assert(ids.has(id), `Missing ${id} in ${page}`);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /vehicle-common\.js/);
  assert.match(html, /vehicle-calculations\.js/);
  assert.match(html, /site\.css/);
  assert.doesNotMatch(html, /href="\.\.\/styles\/vehicles\.css"/);
  assert.doesNotMatch(javaScript, /eval\s*\(|\.innerHTML\s*=/);
}
const calculatorHtml = fs.readFileSync(path.join(repo, 'pages/vehicles.html'), 'utf8');
const guideHtml = fs.readFileSync(path.join(repo, 'pages/vehicle-guide.html'), 'utf8');
assert.match(calculatorHtml, /Understanding Vehicle emissions/);
assert.match(calculatorHtml, /class="learn-dropdown"/);
assert.match(calculatorHtml, /vehicle-model-search/);
assert.match(calculatorHtml, /vehicle-year-search/);
assert.match(calculatorHtml, /vehicle-driver/);
assert.match(calculatorHtml, /vehicle-registration/);
assert.match(calculatorHtml, /vehicle-monthly-figure/);
assert.match(calculatorHtml, /vehicle-source-figure/);
assert.match(calculatorHtml, /vehicle-scatter-figure/);
assert.doesNotMatch(calculatorHtml, /vehicle-actual-litres|vehicle-actual-kwh/);
assert.match(guideHtml, /vehicle-body-picker/);
assert.match(guideHtml, /vehicle-family-grid/);
assert.match(guideHtml, /vehicle-band/);
assert.match(guideHtml, /vehicle-purchase-rows/);
assert.doesNotMatch(guideHtml, /vehicle-min-power|vehicle-max-power|vehicle-quality/);
for (const pathName of ['scripts/vehicle-common.js', 'scripts/vehicle-calculations.js',
  'scripts/vehicles.js', 'scripts/vehicle-guide.js']) {
  assert(fs.existsSync(path.join(repo, pathName)));
}
console.log('PASS: layout, settings, data-quality guard, charts, vehicle library, body icon controls, scripts and DOM IDs.');
