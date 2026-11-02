"""Static GitHub Pages and privacy preflight. Standard-library only."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit
import re

repository = Path(__file__).resolve().parents[1]
allowed_reference_files = {
    'aircraft-reference.json', 'airline-reference.json', 'airport-reference.json',
    'flight-configurations.json', 'icao-legacy-fuel-curves.json',
    'icao-v13-fuel-curves.json', 'landscape-reference.json',
}

class PageInspector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []
        self.ids = []

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if attributes.get('id'):
            self.ids.append(attributes['id'])
        if tag in ('a', 'img', 'link', 'script'):
            reference = attributes.get('href') or attributes.get('src')
            if reference and not reference.startswith(('http:', 'https:', 'data:', '#', 'mailto:')):
                self.references.append(reference)

problems = []
for page in [repository / 'index.html', *sorted((repository / 'pages').glob('*.html'))]:
    inspector = PageInspector()
    inspector.feed(page.read_text(encoding='utf-8'))
    repeated = {item for item in inspector.ids if inspector.ids.count(item) > 1}
    if repeated:
        problems.append(f'{page.relative_to(repository)}: repeated IDs {sorted(repeated)}')
    for reference in inspector.references:
        target = (page.parent / urlsplit(reference).path).resolve()
        if not target.is_file():
            problems.append(f'{page.relative_to(repository)}: missing local reference {reference}')

for file in repository.rglob('*'):
    if not file.is_file():
        continue
    relative = file.relative_to(repository)
    if file.suffix.lower() in {'.xlsx', '.xls', '.xlsm', '.csv', '.tsv', '.db', '.sqlite', '.zip', '.pem', '.key'}:
        problems.append(f'Possible confidential/source file: {relative}')
    if file.parent == repository / 'data' and file.name not in allowed_reference_files:
        problems.append(f'Unexpected public data file: {relative}')
    if file.suffix.lower() in {'.html', '.js', '.css', '.md', '.json'}:
        contents = file.read_text(encoding='utf-8', errors='replace')
        if re.search(r'(?i)\b(?:api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*["\']?[A-Za-z0-9_\-]{20,}', contents):
            problems.append(f'Potential embedded credential: {relative}')

if problems:
    print('\n'.join('WARN: ' + message for message in problems))
    raise SystemExit(1)
print('PASS: Page references, duplicate IDs and common publication hazards checked.')
print('This static scan is not a substitute for review of Git history or browser-data security.')
