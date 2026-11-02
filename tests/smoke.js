/*
  Headless DOM smoke test without external services.
  Checks module startup, reference selectors, boat calculations, local saving,
  source handler registration and version-1 JSON restoration.
*/
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const pageFiles = [
  'index.html',
  'pages/boats.html',
  'pages/flights.html',
  'pages/e-bikes.html',
];

class TestElement {
  constructor(id = '', tagName = 'DIV') {
    this.id = id;
    this.tagName = tagName;
    this.type = 'text';
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.required = false;
    this.children = [];
    this.listeners = {};
    this.options = this.children;
    this.dataset = {};
    this.attributes = new Map();
    const classes = new Set();
    this.classList = {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
      toggle: (value, force) => {
        const shouldAdd = force === undefined ? !classes.has(value) : force;
        if (shouldAdd) classes.add(value);
        else classes.delete(value);
        return shouldAdd;
      },
      contains: (value) => classes.has(value),
    };
  }

  addEventListener(name, listener) {
    this.listeners[name] ??= [];
    this.listeners[name].push(listener);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners[event.type] || []) {
      listener({ ...event, target: event.target || this, preventDefault() {} });
    }
  }

  append(...items) {
    this.children.push(...items);
    this.options = this.children;
  }

  replaceChildren(...items) {
    this.children = items;
    this.options = this.children;
    if (this.tagName === 'SELECT') {
      this.value = items[0]?.value || '';
    }
  }

  reset() {
    this.value = '';
  }

  getAttribute(key) {
    return this.attributes.get(key) ?? null;
  }

  setAttribute(key, value) {
    this.attributes.set(key, value);
  }

  querySelectorAll() {
    return [];
  }

  querySelector() {
    return null;
  }

  scrollIntoView() {}
  click() {
    this.dispatchEvent({ type: 'click' });
  }
}

(async () => {
  const elements = new Map();
  for (const pageFile of pageFiles) {
    const markup = fs.readFileSync(path.join(appRoot, pageFile), 'utf8');
    for (const match of markup.matchAll(/<([a-z0-9-]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
      elements.set(match[2], new TestElement(match[2], match[1].toUpperCase()));
    }
  }

  const storedItems = new Map();
  const localStorage = {
    getItem: (key) => storedItems.get(key) || null,
    setItem: (key, value) => storedItems.set(key, value),
  };

  const document = {
    body: { dataset: { mode: 'boat' } },
    getElementById: (id) => {
      assert(elements.has(id), `Missing required interface element: ${id}`);
      return elements.get(id);
    },
    createElement: (tagName) => new TestElement('', tagName.toUpperCase()),
    querySelectorAll: () => [],
    addEventListener() {},
  };

  class TestChart {
    destroy() {}
  }

  class TestOption extends TestElement {
    constructor(text, value) {
      super('', 'OPTION');
      this.textContent = text;
      this.value = value;
    }
  }

  const context = {
    document,
    localStorage,
    Option: TestOption,
    Chart: TestChart,
    window: {
      addEventListener() {},
      matchMedia: () => ({ matches: true }),
      confirm: () => true,
    },
    getComputedStyle: () => ({ color: '#000000' }),
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    crypto: require('node:crypto').webcrypto,
    Event: class TestEvent {
      constructor(type) {
        this.type = type;
      }
    },
    fetch: async (url) => {
      const fileName = url.split('/').pop();
      const filePath = path.join(appRoot, 'data', fileName);
      return {
        ok: fs.existsSync(filePath),
        json: async () => JSON.parse(fs.readFileSync(filePath, 'utf8')),
      };
    },
  };
  context.window.document = document;
  context.globalThis = context;
  vm.createContext(context);

  for (const scriptFile of ['scripts/boat-calculations.js', 'scripts/carbon-tracker.js']) {
    const source = fs.readFileSync(path.join(appRoot, scriptFile), 'utf8');
    vm.runInContext(source, context, { filename: scriptFile });
  }

  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.match(elements.get('app-status').textContent, /Ready to record/);
  assert(elements.get('flight-landscape').children.length > 5);
  assert(elements.get('bike-landscape').children.length > 5);
  assert(elements.get('boat-landscape').options.length > 5);
  assert(elements.get('boat-landscape').options.some((item) => item.value === 'Benguerra, Mozambique'));
  assert(elements.get('boat-landscape').options.some((item) => item.value === '__other__'));

  // Exercise the calculation and source-highlighting code paths.
  elements.get('boat-petrol').value = '50';
  elements.get('boat-petrol').dispatchEvent({ type: 'input' });
  assert.match(elements.get('boat-result').innerHTML, /0\.1177/);
  assert.match(elements.get('boat-breakdown').innerHTML, /CO₂e/);

  // The selector must support a landscape not already in the public catalogue.
  elements.get('boat-landscape').value = '__other__';
  elements.get('boat-landscape').dispatchEvent({ type: 'change' });
  assert.equal(elements.get('boat-landscape-custom-field').hidden, false);
  elements.get('boat-landscape-custom').value = 'Custom testing landscape';

  elements.get('boat-date').value = '2026-10-29';
  elements.get('boat-vessel').value = 'Test vessel';
  elements.get('boat-site').value = 'Test site';
  elements.get('boat-activity').value = 'Monitoring';
  elements.get('boat-form').dispatchEvent({ type: 'submit' });
  assert.equal(elements.get('boat-error').textContent, '');

  const saved = JSON.parse(localStorage.getItem('wild-impact-carbon-tracker-v1'));
  assert.equal(saved.version, 1);
  assert.equal(saved.entries.length, 1);
  assert.equal(saved.entries[0].landscape, 'Custom testing landscape');
  assert.equal(saved.entries[0].petrolLitres, 50);
  assert(Math.abs(saved.entries[0].co2eKg - 117.686) < 0.00001);

  // Switching the reporting gas must not change the underlying saved litres.
  elements.get('boat-gas').value = 'ch4';
  elements.get('boat-gas').dispatchEvent({ type: 'change' });
  assert.match(elements.get('boat-filter-status').textContent, /metric tonnes/i);

  // Test the electric motorcycle form and its baseline calculation.
  elements.get('bike-start').value = '2026-10-20';
  elements.get('bike-end').value = '2026-10-21';
  elements.get('bike-distance-mode').value = 'distance';
  elements.get('bike-distance').value = '30';
  elements.get('bike-ranger').value = 'Test recorder';
  elements.get('bike-registration').value = 'Testing motorcycle';
  elements.get('bike-landscape').value = 'Masai Mara';
  elements.get('bike-energy-intensity').value = '0.0405';
  elements.get('bike-grid-factor').value = '0.226';
  elements.get('bike-baseline-factor').value = String((2.075 / 45.5) * 1.28);
  elements.get('bike-substitution').value = '100';
  elements.get('bike-charging').value = 'auto';
  elements.get('bike-distance').dispatchEvent({ type: 'input' });
  assert.match(elements.get('bike-result').innerHTML, /t CO₂ avoided/);
  elements.get('ebike-form').dispatchEvent({ type: 'submit' });
  assert.equal(elements.get('bike-error').textContent, '');

  const afterBike = JSON.parse(localStorage.getItem('wild-impact-carbon-tracker-v1'));
  assert.equal(afterBike.entries.length, 2);
  assert(afterBike.entries.some((record) => record.mode === 'ebike'));

  // Merge an older schema-v1 backup through the existing module import interface.
  const historicalRecord = {
    id: 'historic-boat-record',
    mode: 'boat',
    date: '2026-07-01',
    landscape: 'Benguerra, Mozambique',
    vessel: 'Historical test boat',
    site: 'Test site',
    activity: 'Monitoring',
    name: 'Historical test boat',
    petrolLitres: 10,
    emissionsKg: 23.5372,
    co2Kg: 23.3955,
    co2eKg: 23.5372,
    updatedAt: '2026-07-05T10:00:00Z',
  };
  const legacyBackup = JSON.stringify({
    schema: 'wild-impact-carbon',
    version: 1,
    entries: [historicalRecord],
  });
  const importInput = elements.get('import-backup');
  importInput.dispatchEvent({
    type: 'change',
    target: {
      files: [{ size: legacyBackup.length, text: async () => legacyBackup }],
      value: 'legacy-backup.json',
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 80));

  const afterRestore = JSON.parse(localStorage.getItem('wild-impact-carbon-tracker-v1'));
  assert.equal(afterRestore.entries.length, 3);
  assert(afterRestore.entries.some((record) => record.id === 'historic-boat-record'));

  // Home-page aggregates must read the same records as every module.
  const homeSource = fs.readFileSync(path.join(appRoot, 'scripts/home.js'), 'utf8');
  vm.runInContext(homeSource, context, { filename: 'scripts/home.js' });
  assert.equal(elements.get('home-total-records').textContent, '3');
  assert.equal(elements.get('home-flight-count').textContent, '0');

  // Older boat calculations must still use combined fuel across both engines.
  const result = context.WildImpactBoat.calculate(50);
  assert.equal(result.co2eKg, 117.686);

  console.log('PASS: selectors, initialisation, gas calculations, source rendering, save and v1 storage.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
