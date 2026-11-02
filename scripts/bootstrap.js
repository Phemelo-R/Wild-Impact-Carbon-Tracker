'use strict';

/*
  The original calculator works with all module controls in one DOM.
  Each page mounts the two inactive forms, then starts the shared engine.
  This keeps historical records, exports and calculation behaviour compatible.
*/
(async () => {
  const modules = {
    flight: 'flights.html',
    ebike: 'e-bikes.html',
    boat: 'boats.html',
  };
  const activeModule = document.body.dataset.mode;
  const inactiveContainer = document.getElementById('inactive-modules');

  if (!modules[activeModule] || !inactiveContainer) {
    throw new Error('Unknown module page.');
  }

  const inactivePages = Object.entries(modules).filter(([module]) => {
    return module !== activeModule;
  });

  const mountedSections = await Promise.all(inactivePages.map(async ([module, file]) => {
    const response = await fetch('./' + file, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Could not load module file ' + file);
    }

    const markup = new DOMParser().parseFromString(
      await response.text(),
      'text/html'
    );
    const sectionId = {
      flight: 'flight-view',
      ebike: 'ebike-view',
      boat: 'boat-view',
    }[module];
    const section = markup.getElementById(sectionId);
    if (!section) {
      throw new Error('Missing module section in ' + file);
    }
    return section;
  }));

  for (const section of mountedSections) {
    section.hidden = true;
    inactiveContainer.appendChild(document.importNode(section, true));
  }

  const script = document.createElement('script');
  script.src = '../scripts/carbon-tracker.js';
  script.onerror = () => {
    document.getElementById('app-status').textContent =
      'The shared calculator script could not be loaded.';
  };
  document.body.appendChild(script);
})().catch((error) => {
  const status = document.getElementById('app-status');
  status.classList.add('error');
  status.textContent =
    'The tracker could not start: ' + error.message +
    '. Run through GitHub Pages or a local web server.';
  console.error('Wild Impact startup error:', error);
});
