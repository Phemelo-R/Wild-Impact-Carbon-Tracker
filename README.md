<div align="center">
  <a href="https://phemelo-r.github.io/Wild-Impact-Carbon-Tracker/">
    <img src="assets/wild-impact-logo.png" alt="Wild Impact logo" width="212">
  </a>
  <h1>Wild Impact Carbon Tracker</h1>
  <p><strong>Landscape Conservation | Operational Emissions Monitoring</strong></p>
  <p>Measuring transport emissions to inform responsible conservation operations.</p>
  <p><a href="https://phemelo-r.github.io/Wild-Impact-Carbon-Tracker/"><strong>Access the Carbon Tracker</strong></a></p>
  <p>Pilot implementation &middot; Browser-based application</p>
</div>

---

## About the project

The Wild Impact Carbon Tracker is a transport emissions monitoring and decision-support tool developed for Wild Impact's Landscape Conservation programme. It provides a consistent framework for recording, estimating and reviewing greenhouse gas emissions associated with organisational travel and field operations across its African landscapes and seascapes.

The project originated from an assessment of electric motorcycles used by rangers in the Maasai Mara, Kenya, to quantify emissions avoided through the replacement of petrol-powered public transport motorcycles (boda-bodas). It has since expanded to include aviation, marine transport and road vehicles.

The tracker supports operational planning, identification of emission-intensive activities, longitudinal monitoring and more informed transport decisions. It is a management tool rather than a verified organisational greenhouse gas inventory or a complete lifecycle assessment.

## Application modules

| Module | Purpose | Calculation approach |
| :--- | :--- | :--- |
| [E-bikes](https://phemelo-r.github.io/Wild-Impact-Carbon-Tracker/pages/e-bikes.html) | Monitor electric motorcycle journeys, charging emissions and emissions avoided relative to displaced boda-boda journeys. | Recorded or estimated electricity use, charging source, electricity emission factor and petrol-motorcycle baseline. |
| [Flights](https://phemelo-r.github.io/Wild-Impact-Carbon-Tracker/pages/flights.html) | Record domestic and international air travel by route, operator, aircraft, cabin and passenger count. | ICAO-based fuel estimation and passenger allocation; documented manual estimates for unsupported aircraft. |
| [Boats](https://phemelo-r.github.io/Wild-Impact-Carbon-Tracker/pages/boats.html) | Monitor petrol consumption and direct emissions from marine operations. | Recorded whole-vessel petrol consumption multiplied by UK DESNZ 2026 mineral-petrol factors. |
| [Vehicles](https://phemelo-r.github.io/Wild-Impact-Carbon-Tracker/pages/vehicles.html) | Record road journeys and estimate operational emissions for vehicle models used by Wild Impact. | Distance travelled and fleet-reported fuel consumption; provisional electricity-based estimates for supported electric vehicles. |
| [Fleet Guide](https://phemelo-r.github.io/Wild-Impact-Carbon-Tracker/pages/vehicle-guide.html) | Compare existing fleet model variants and inform future vehicle selection or replacement. | Per-kilometre emissions, internal A–E bands and estimated energy costs using user-entered local prices. |

The home page provides navigation, selected local-record statistics and shared backup controls. The Fleet Guide is a comparison tool, not a separate source of operational journey records.

## Repository structure

This repository contains the entire static web application: interface, calculation logic, public reference datasets, visual assets and automated checks. No server-side application or database is required.

```text
Wild-Impact-Carbon-Tracker/
├── index.html                 # Home page and backup controls
├── README.md                  # Project documentation
├── gitignore                  # Intended Git ignore rules
├── pages/                     # Individual application pages
│   ├── flights.html
│   ├── e-bikes.html
│   ├── boats.html
│   ├── vehicles.html
│   └── vehicle-guide.html
├── scripts/                   # Calculation engines and application behaviour
│   ├── bootstrap.js
│   ├── carbon-tracker.js
│   ├── boat-calculations.js
│   ├── vehicle-calculations.js
│   ├── vehicle-common.js
│   ├── vehicles.js
│   ├── vehicle-guide.js
│   ├── home.js
│   └── site.js
├── data/                      # Public reference catalogues (JSON)
│   ├── airport-reference.json
│   ├── aircraft-reference.json
│   ├── airline-reference.json
│   ├── flight-configurations.json
│   ├── icao-legacy-fuel-curves.json
│   ├── icao-v13-fuel-curves.json
│   ├── landscape-reference.json
│   └── vehicle-reference.json
├── styles/
│   └── site.css               # Visual design and responsive layouts
├── assets/                    # Branding, photographs and illustrations
│   ├── wild-impact-logo.png
│   ├── wild-impact-mark.png
│   ├── wild-impact-landscapes-africa.png
│   ├── module-flights.jpg
│   ├── module-ebikes.jpg
│   ├── module-boats.jpg
│   ├── module-vehicles.jpg
│   └── body-types/             # Vehicle body-type illustrations/icons
├── tests/                     # Automated JavaScript checks
└── tools/
    └── check_project.py       # Static reference and publication-safety checks
```

## Maintenance guide — where to make changes

### Website design and content

| To change… | File or directory |
| :--- | :--- |
| Home page text, navigation and module cards | [`index.html`](index.html) |
| Module text, input fields, buttons and page layout | [`pages/`](pages/) — edit the relevant HTML page |
| Colours, typography, spacing, charts' surrounding layout and responsive design | [`styles/site.css`](styles/site.css) |
| Logo, landscape map, transport photographs and vehicle illustrations | [`assets/`](assets/) |
| Mobile navigation and shared site interactions | [`scripts/site.js`](scripts/site.js) |
| Home page statistics and backup controls | [`scripts/home.js`](scripts/home.js) |

### Calculations and application behaviour

| File | Responsibility |
| :--- | :--- |
| [`scripts/carbon-tracker.js`](scripts/carbon-tracker.js) | Shared Flights, E-bikes and Boats controller: flight distance, fuel-curve interpolation, passenger allocation, motorcycle calculations, journey handling, charts, Excel exports and JSON backups. Also contains the Benguerra boat-log import and landscape selector logic. |
| [`scripts/boat-calculations.js`](scripts/boat-calculations.js) | Boat petrol emission factors, gas-specific calculations and CO₂e totals. |
| [`scripts/vehicle-calculations.js`](scripts/vehicle-calculations.js) | Road-vehicle fuel factors, distance-based equations, electric energy estimation, data-deficiency rules, internal emissions bands and fleet ranking logic. |
| [`scripts/vehicle-common.js`](scripts/vehicle-common.js) | Shared vehicle settings, country and currency profiles, grid factor defaults, catalogue loading, private fleet CSV parsing and local record management. |
| [`scripts/vehicles.js`](scripts/vehicles.js) | Vehicle journey form, preview, validation, asset selection, saved records, charts and CSV export. |
| [`scripts/vehicle-guide.js`](scripts/vehicle-guide.js) | Fleet Guide search, filters, model comparisons, rankings and rebuy shortlist presentation. |
| [`scripts/bootstrap.js`](scripts/bootstrap.js) | Initialises the shared Flights, E-bikes and Boats engine by loading the inactive module sections into the page. |

> **Developer note:** Flights, E-bikes and Boats depend on a shared controller and specific HTML element IDs. When changing an input, section ID or event handler, check all three pages and the shared script. The vehicle pages use a separate calculation engine and common utilities. Avoid renaming storage keys or record fields without planning backwards compatibility for existing backups.

### Reference datasets

| Dataset | Contents and maintenance |
| :--- | :--- |
| [`airport-reference.json`](data/airport-reference.json) | Airport codes, coordinates, countries and ICAO geographic regions for route calculations and airport search. |
| [`aircraft-reference.json`](data/aircraft-reference.json) | Aircraft models, ICAO aircraft codes and reference seating information. |
| [`airline-reference.json`](data/airline-reference.json) | Airline/operator catalogue and associated aircraft information. |
| [`flight-configurations.json`](data/flight-configurations.json) | Operator-specific seating configurations, cabin allocation weights and supporting sources. |
| [`icao-legacy-fuel-curves.json`](data/icao-legacy-fuel-curves.json) | Legacy ICAO aircraft fuel curves and stage distances. |
| [`icao-v13-fuel-curves.json`](data/icao-v13-fuel-curves.json) | Additional ICAO v13 fuel-curve reference data. The shared engine combines the two curve catalogues. |
| [`landscape-reference.json`](data/landscape-reference.json) | Landscape, seascape and office names used by the shared transport modules. |
| [`vehicle-reference.json`](data/vehicle-reference.json) | Public model-level specifications for the owned pilot fleet, including model year, variant, fuel type, reported fuel economy and available energy specifications. |

All listed datasets are stored in `data/`. The current vehicle catalogue contains **eight model/variant records**, sourced from the Wild Impact fleet dataset dated 24 November 2026. It is not a comprehensive South African vehicle market database or a register of individually identifiable assets.

When updating a reference dataset, retain the JSON schema, stable identifiers, units, provenance and data-quality warnings. Cross-check linked records (for example, aircraft codes, operator names and fuel curves) before publishing. Use `null` for unavailable specifications where supported; do not substitute invented values or zero for missing data.

## Emissions methodology and reporting boundaries

The modules address different accounting questions. Their outputs must be interpreted according to their respective system boundaries, units and assumptions.

| Module | Reporting basis | Interpretation |
| :--- | :--- | :--- |
| Flights | Passenger-allocated CO₂ from aviation fuel | Modelled flight emissions, not measured aircraft fuel use or a full assessment of aviation's climate effects. |
| E-bikes | Electricity-related emissions and a counterfactual petrol-motorcycle baseline | Avoided emissions are calculated as baseline emissions less charging emissions. The project assumptions and gas basis must be reviewed before combining results with other modules. |
| Boats | Direct combustion of recorded mineral petrol | CO₂, CH₄ and N₂O masses and aggregated CO₂e are available; upstream fuel emissions are excluded. |
| Vehicles | Direct petrol/diesel combustion or electricity-related CO₂e | Fuel estimates use reported L/100 km, not measured consumption. Electric estimates depend on usable or gross battery capacity, stated range, charging efficiency and the selected grid factor. Plug-in hybrids are treated as data deficient for distance-only accounting. |

The application uses ICAO-based flight methods, UK Department for Energy Security and Net Zero (DESNZ) greenhouse gas conversion factors, and project-specific energy and transport assumptions. The source files and individual module pages contain further methodological information.

- **ICAO Carbon Emissions Calculator methodology** — aviation fuel curves and passenger/cargo allocation references (legacy v9 and v13.1 allocation rules are retained in the implementation).
- [UK DESNZ 2026 greenhouse gas conversion factors](https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026) — fuel factors referenced in the implementation. The boat calculator uses mineral petrol; the vehicle calculator uses average-biofuel-blend factors. These are distinct factor profiles.
- **Electric motorcycle project:** default energy intensity, electricity factor and baseline values are in [`pages/e-bikes.html`](pages/e-bikes.html), with calculation and validation rules in [`scripts/carbon-tracker.js`](scripts/carbon-tracker.js). Review both files when changing defaults.
- **Road-vehicle electricity:** the South African default is the 2024 national generation factor of 0.960 kg CO₂e/kWh, used as a historical proxy. Other locations require a documented local factor. Grid defaults and charging assumptions are managed in [`scripts/vehicle-common.js`](scripts/vehicle-common.js).

The A–E vehicle bands are internal comparative categories, not official environmental ratings. Cost comparisons use user-entered local energy prices and do not represent total ownership costs.

CO₂ and CO₂e are not interchangeable. Do not sum results from different modules into an organisational total without reconciling gas metrics, operational boundaries, baseline treatment and reporting periods. Changes to factors should be recorded with their source, year, unit and rationale, and their effect on historical results reviewed before release.

## Data storage, backups and confidentiality

The application is hosted as a static public website on GitHub Pages. Operational records are held in browser `localStorage`, not in the public repository. There is no central database, automatic cross-device synchronisation, or application-level authentication.

| Local storage key | Purpose |
| :--- | :--- |
| `wild-impact-carbon-tracker-v1` | Shared flight, e-bike, boat and vehicle journey records. |
| `wild-impact-vehicle-settings-v2` | Vehicle energy, location and price preferences. |
| `wild-impact-private-fleet-v1` | Individually identifiable fleet assets imported locally. |

Use the home page's JSON backup and restore controls to transfer shared journey records between authorised browsers or devices. The version-1 backup merges records by ID; the newer version of an existing record takes precedence. Flights, E-bikes and Boats also provide Excel exports; Vehicles provides a journey CSV export. The private fleet catalogue and vehicle preferences are stored separately from the shared journey backup and may need to be restored or re-entered independently.

**Data governance requirements:**

- Keep original fleet CSV files, registration numbers, staff names, flight tickets, boat logs, journey backups and other identifiable operational information out of GitHub.
- Only reviewed, non-identifying reference data and approved assets belong in the public repository.
- Use organisationally approved devices and secure storage locations for backups. Browser storage is not an encrypted organisational database; clearing browser data may delete records.
- Treat exports as confidential where they include personal or operational information. The public website itself is not an access-controlled environment.

## Running the application

### Access the hosted version

The application is available at [phemelo-r.github.io/Wild-Impact-Carbon-Tracker](https://phemelo-r.github.io/Wild-Impact-Carbon-Tracker/).

### Run a local development copy

Clone the repository and start a local HTTP server from its root directory:

```bash
git clone https://github.com/Phemelo-R/Wild-Impact-Carbon-Tracker.git
cd Wild-Impact-Carbon-Tracker
python -m http.server 8000
```

Open [http://localhost:8000/](http://localhost:8000/) in a browser. Use `python3` if that is the command available on your system.

Do not open the HTML files directly using `file://`; the application fetches JSON files and inactive module markup over HTTP. A local development server has a different browser storage origin from the hosted application, so records are not automatically shared between them.

### Technology

The application uses HTML, CSS, vanilla JavaScript and locally bundled JSON reference data. Chart.js 4.4.6 and SheetJS (XLSX) 0.18.5 are loaded via a public CDN by the shared transport pages. Internet access is needed for those dependencies unless they are hosted locally. Node.js and Python are used for development checks; there is no package installation or compilation step for the website itself.

## Testing and deployment

Run the existing checks from the repository root before publishing changes:

```bash
node tests/smoke.js
node tests/page-smoke.test.js
node tests/runtime.test.js
node tests/vehicles.test.js
python tools/check_project.py
```

| Check | Coverage |
| :--- | :--- |
| `tests/smoke.js` | Shared module startup, selectors, gas calculations, local saving and version-1 record storage. |
| `tests/page-smoke.test.js` | Vehicle page structure, element IDs, required scripts and interface checks. |
| `tests/runtime.test.js` | Vehicle controller integration using a simulated DOM. |
| `tests/vehicles.test.js` | Vehicle calculation logic and catalogue expectations. |
| `tools/check_project.py` | Broken local references, duplicate IDs and common publication/privacy hazards. |

### Current maintenance notes

The supplied pilot snapshot was checked against the commands above. The shared-module smoke test and vehicle page smoke test passed. The vehicle unit test still expects the 366-variant catalogue; the runtime test searches for an Abarth model absent from the new eight-variant fleet and fails at the journey-preview assertion. The Python preflight flags `vehicle-reference.json` because its public-data allowlist has not been updated.

### Publishing changes

1. Back up any local operational records before testing changes.
2. Make changes on a development branch and use synthetic, non-identifying records for testing.
3. Run the automated checks and manually verify all module pages, input validation, exports, backup restoration and mobile layouts.
4. Review the changed files for sensitive data and document methodological changes in the commit or pull request.
5. Merge approved changes into the branch configured for GitHub Pages. Confirm that the published site loads and that reference files remain accessible.

## Project status and limitations

The tracker is a pilot implementation under development. Modelled estimates depend on the quality of activity records, catalogue specifications and selected emission factors. Fuel consumption in real operating conditions can differ from reported vehicle specifications. Aircraft layouts and route allocations may also be estimates. Results should support management and internal reporting decisions, subject to data validation and methodological review; they should not be presented as independently audited emissions figures.

The repository snapshot does not include a software licence. Public visibility does not by itself grant permission to reuse the source code, organisational branding or visual assets. Licensing and external reuse should be agreed with the relevant rights holders before a licence is added.

## Development and contact

Developed for Wild Impact's Landscape Conservation programme by **[Phemelo-R](https://github.com/Phemelo-R)** with some help from **Anthropic (Claude)** and **ChatGPT (OpenAI)**.

For technical queries, maintenance requests or suggestions, contact the project developer or use the repository's [Issues](https://github.com/Phemelo-R/Wild-Impact-Carbon-Tracker/issues) page. Do not include confidential operational or personal information in public issues or pull requests.

---

<div align="center">
  <img src="assets/wild-impact-mark.png" alt="Wild Impact mark" width="48">
  <p><strong>Wild Impact | Landscape Conservation</strong></p>
  <p>Operational monitoring in support of responsible conservation.</p>
</div>
