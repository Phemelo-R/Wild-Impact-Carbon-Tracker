'use strict';

/* Script-level integration smoke checks in an in-memory DOM-like environment.
 * Full browser visual checks are still recommended after deployment.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'data/vehicle-reference.json'), 'utf8'));

class FakeElement {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.className = '';
    this.innerText = '';
    this.hidden = false;
    this.open = false;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.viewBox = { baseVal: { width: 620, height: 275 } };
    this.classList = { add: () => {}, remove: () => {}, contains: () => false };
  }
  append(...children) { this.children.push(...children); return this; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] || null; }
  addEventListener(event, callback) { (this.listeners[event] ??= []).push(callback); }
  dispatchEvent(event) {
    for (const callback of this.listeners[event.type] || []) {
      callback({ ...event, target: event.target || this, preventDefault() {} });
    }
  }
  closest() { return { querySelector: () => new FakeElement('span') }; }
  querySelectorAll(tagName) {
    const found = [];
    const walk = (element) => {
      for (const child of element.children || []) {
        if (child.tagName?.toLowerCase() === tagName.toLowerCase()) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  reset() { this.value = ''; }
  click() { this.dispatchEvent({ type: 'click' }); }
}
class FakeOption extends FakeElement {
  constructor(text, value) { super('option'); this.textContent = text; this.value = value; }
}

const runPage = async (htmlFile, scriptName) => {
  const html = fs.readFileSync(path.join(root, htmlFile), 'utf8');
  const elements = new Map();
  for (const match of html.matchAll(/<([a-z0-9-]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    elements.set(match[2], new FakeElement(match[1], match[2]));
  }
  elements.get('vehicle-grid-factor').value = '0.96';
  elements.get('vehicle-grid-year').value = '2024';
  elements.get('vehicle-charge-efficiency').value = '0.90';
  elements.get('vehicle-custom-currency').value = 'USD';
  elements.get('vehicle-sort') && (elements.get('vehicle-sort').value = 'emissions');
  const store = new Map();
  const context = {
    document: {
      getElementById: (id) => {
        assert(elements.has(id), 'Missing HTML element ' + id);
        return elements.get(id);
      },
      createElement: (name) => new FakeElement(name),
      createElementNS: (_, name) => new FakeElement(name),
    },
    localStorage: {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, value),
    },
    window: { location: { search: '' }, confirm: () => true },
    Option: FakeOption,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console,
    Intl,
    Date,
    Map,
    Set,
    Number,
    Math,
    crypto: { randomUUID: () => 'test-trip-1' },
    fetch: async () => ({ ok: true, json: async () => catalogue }),
  };
  context.globalThis = context;
  vm.createContext(context);
  for (const script of ['scripts/vehicle-calculations.js',
    'scripts/vehicle-common.js', `scripts/${scriptName}`]) {
    vm.runInContext(fs.readFileSync(path.join(root, script), 'utf8'), context,
      { filename: script });
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(elements.get('vehicle-status').textContent, /ready/i,
    `Controller did not start in ${htmlFile}`);
  return { elements, store, context };
};

(async () => {
  const accounting = await runPage('pages/vehicles.html', 'vehicles.js');
  const accountingElements = accounting.elements;
  assert.equal(accountingElements.get('vehicle-country').value, 'ZA');
  assert.equal(accountingElements.get('vehicle-grid-factor').value, '0.960');
  accountingElements.get('vehicle-model-search').value = 'Abarth 124 Spider';
  accountingElements.get('vehicle-model-search').dispatchEvent({ type: 'input' });
  assert(accountingElements.get('vehicle-model-results').children.length > 0);
  const first = accountingElements.get('vehicle-model-results').children[0];
  first.dispatchEvent({ type: 'click' });
  accountingElements.get('vehicle-trip-km').value = '150';
  accountingElements.get('vehicle-trip-km').dispatchEvent({ type: 'input' });
  assert(accountingElements.get('vehicle-trip-preview').children.length >= 3);
  accountingElements.get('vehicle-driver').value = 'Example driver';
  accountingElements.get('vehicle-registration').value = 'TEST-123';
  accountingElements.get('vehicle-landscape').value = 'Lubombo';
  accountingElements.get('vehicle-trip-date').value = '2026-11-11';
  accountingElements.get('vehicle-form').dispatchEvent({ type: 'submit' });
  const records = JSON.parse(accounting.store.get('wild-impact-carbon-tracker-v1'));
  assert.equal(records.entries.length, 1);
  assert.equal(records.entries[0].driverName, 'Example driver');
  assert.equal(records.entries[0].registrationNumber, 'TEST-123');
  assert.equal(records.entries[0].distanceKm, 150);
  assert.equal(records.entries[0].fuelFactorProfile, '2026-average-biofuel-blend');
  accountingElements.get('vehicle-country').value = 'KE';
  accountingElements.get('vehicle-country').dispatchEvent({ type: 'change' });
  assert.equal(accountingElements.get('vehicle-grid-factor').value, '');
  assert.match(accountingElements.get('vehicle-currency-label').textContent, /KES/);
  assert.equal(accountingElements.get('vehicle-petrol-price').value, '');

  const guide = await runPage('pages/vehicle-guide.html', 'vehicle-guide.js');
  const elements = guide.elements;
  assert.equal(elements.get('vehicle-purchase-rows').children.length, 10);
  assert.equal(elements.get('vehicle-family-grid').children.length, 18);
  assert.equal(elements.get('vehicle-body-picker').children.length, 9);
  elements.get('vehicle-year').value = '2016';
  elements.get('vehicle-year').dispatchEvent({ type: 'change' });
  assert(elements.get('vehicle-family-grid').children.length > 0);
  elements.get('vehicle-band').value = 'A';
  elements.get('vehicle-band').dispatchEvent({ type: 'change' });
  assert.match(elements.get('vehicle-filter-status').textContent, /matching model families/);

  console.log('PASS: vehicle accounting DOM, search, save, shared backup, countries/currencies, top-ten and family filters.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
