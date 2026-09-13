"""Supplemental LOCAL-MAREL-001 checks against the established read-only catalog."""
import argparse
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from app import store
from app.settings import settings

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--db', type=Path, required=True)
args = parser.parse_args()
EXPECTED_DB = args.db.resolve()
assert settings.db_path.resolve() == EXPECTED_DB and EXPECTED_DB.is_file() and EXPECTED_DB.stat().st_size > 0
@contextmanager
def readonly():
    connection = sqlite3.connect(EXPECTED_DB.as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA query_only=ON')
    try:
        yield connection
    finally:
        connection.close()
store.get_connection = readonly
pairs = {
    'caricature 3d': '3d-caricature-style-nano-banana',
    'journey paper': 'paper_journey_postcards',
    'cloud luma': 'luma_cloud_beacon_poster',
    'travel vintage': 'vintage_travel_scrapbook',
    'scrapbook wanderlust': 'vintage_scrapbook_travel_poster',
    'ink navy': 'navy_ink_profession_field_guide',
    'fashion cinematic': 'cinematic_fashion_dossier',
    'technical cinematic': 'cinematic_technical_storyboard_sheet',
}
for query, expected in pairs.items():
    page = store.list_presets_page(q=query, limit=100)
    keys = [item['key'] for item in page['items']]
    assert expected in keys, (query, expected, keys)
    assert page == store.list_presets_page(q='  ' + '  '.join(reversed(query.split())) + '  ', limit=100)
    print('PASS', query, expected, page['total'])
assert store.list_presets_page(q='portrait caricature')['total'] >= 2
print('PASS portrait caricature')
with readonly() as connection:
    rows = [dict(row) for row in connection.execute('SELECT * FROM media_presets')]
active = [row for row in rows if row['status'] != 'archived']
for character in ['%', '_', '\\']:
    expected = {row['preset_id'] for row in active if any(character in str(row[col] or '') for col in ('key', 'label', 'description'))}
    found = []
    offset = 0
    while True:
        page = store.list_presets_page(q=character, limit=37, offset=offset)
        found.extend(item['preset_id'] for item in page['items'])
        assert page['total'] == len(expected)
        if page['next_offset'] is None:
            break
        offset = page['next_offset']
    assert set(found) == expected and len(found) == len(set(found)), character
    print('PASS literal', repr(character), len(found))
for status in ['active', 'archived', 'all']:
    for query in ['', 'travel', 'portrait caricature']:
        full = []
        offset = 0
        while True:
            page = store.list_presets_page(q=query, status=status, limit=17, offset=offset)
            full.extend(page['items'])
            if page['next_offset'] is None:
                break
            offset = page['next_offset']
        assert len(full) == page['total'] == len({item['preset_id'] for item in full})
        assert [item['preset_id'] for item in full[:100]] == [item['preset_id'] for item in store.list_presets_page(q=query, status=status, limit=100)['items']]
        if status != 'all':
            assert all((item['status'] == 'archived') == (status == 'archived') for item in full)
        if not query:
            expected = [row for row in rows if status == 'all' or (row['status'] == 'archived') == (status == 'archived')]
            assert len(full) == len(expected)
    print('PASS status/pagination', status)
for category in {str(row['category'] or 'general').lower() for row in active}:
    page = store.list_presets_page(q='portrait', category=category)
    assert all(str(item['category'] or 'general').lower() == category for item in page['items'])
    expected = [row for row in active if str(row['category'] or 'general').lower() == category and any('portrait' in str(row[col] or '').lower() for col in ('key', 'label', 'description'))]
    assert page['total'] == len(expected)
print('PASS category filters and totals')
for key in pairs.values():
    page = store.list_presets_page(q=key)
    assert page['items'][0]['key'] == key
    label = next(row['label'] for row in active if row['key'] == key)
    page = store.list_presets_page(q=label)
    assert ' '.join(page['items'][0]['label'].lower().split()) == ' '.join(label.lower().split())
print('PASS exact key/label ranking')
