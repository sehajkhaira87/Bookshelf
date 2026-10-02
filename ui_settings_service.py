"""Persist a bounded set of dashboard appearance options."""
from contextlib import contextmanager
from unicodedata import category

from psycopg2.extras import RealDictCursor

from database import get_connection


PALETTES = {
    'classic': {'label': 'Bookshelf gold', 'accent': '#9a7b32', 'highlight': '#f2c14e', 'tint': '#fffcf5'},
    'forest': {'label': 'Forest green', 'accent': '#34634a', 'highlight': '#95c8a7', 'tint': '#f0f7f1'},
    'ocean': {'label': 'Ocean blue', 'accent': '#326b89', 'highlight': '#8fc8e5', 'tint': '#eef6fb'},
    'plum': {'label': 'Soft plum', 'accent': '#765181', 'highlight': '#cbb0da', 'tint': '#f8f1fb'},
}
SHAPES = {'rounded': {'card_radius': 24, 'small_radius': 12},
          'soft': {'card_radius': 16, 'small_radius': 10},
          'square': {'card_radius': 4, 'small_radius': 4}}
DENSITIES = {'comfortable': {'card_gap': 24, 'card_padding': 24},
             'compact': {'card_gap': 16, 'card_padding': 18}}
SETTING_FIELDS = ('dashboard_title', 'dashboard_subtitle', 'banner_text', 'palette', 'card_shape', 'density', 'snowfall_enabled')
DEFAULT_VALUES = {
    'dashboard_title': '',
    'dashboard_subtitle': 'Select your department to continue.',
    'banner_text': '',
    'palette': 'classic',
    'card_shape': 'rounded',
    'density': 'comfortable',
    'snowfall_enabled': False,
}


class AppearanceUnavailable(RuntimeError):
    """The saved appearance could not be read or written."""


class AppearanceConflict(ValueError):
    """Another editor saved after the displayed version was loaded."""


def _with_tokens(values, revision=0, updated_at=None):
    return {**values, **PALETTES[values['palette']], **SHAPES[values['card_shape']],
            **DENSITIES[values['density']], 'revision': revision, 'updated_at': updated_at}


DEFAULT_SETTINGS = _with_tokens(DEFAULT_VALUES)


def validate_settings(values):
    """Return only recognized values; no user input becomes CSS or HTML."""
    result = {}
    for field, label, limit, required in (
        ('dashboard_title', 'Dashboard title', 100, False),
        ('dashboard_subtitle', 'Dashboard subtitle', 180, True),
        ('banner_text', 'Welcome banner', 300, False),
    ):
        value = values.get(field, '')
        if not isinstance(value, str):
            raise ValueError(f'{label} must be plain text.')
        value = value.strip()
        if (required and not value) or len(value) > limit:
            raise ValueError(f'{label} must contain {"1 to " if required else "at most "}{limit} characters.')
        if any(category(character) in {'Cc', 'Cs'} for character in value):
            raise ValueError(f'{label} must be a single line of text.')
        result[field] = value
    for field, choices, label in (('palette', PALETTES, 'accent palette'),
                                   ('card_shape', SHAPES, 'card shape'),
                                   ('density', DENSITIES, 'spacing')):
        value = values.get(field)
        if not isinstance(value, str) or value not in choices:
            raise ValueError(f'Choose a valid {label}.')
        result[field] = value
    snowfall = values.get('snowfall_enabled', False)
    if isinstance(snowfall, bool):
        result['snowfall_enabled'] = snowfall
    elif isinstance(snowfall, str) and snowfall in ('on', 'off'):
        result['snowfall_enabled'] = snowfall == 'on'
    else:
        raise ValueError('Choose whether snowfall is on or off.')
    return result


def _revision(value):
    if not isinstance(value, (str, int)) or isinstance(value, bool):
        raise ValueError('Reload the editor before saving.')
    value = str(value)
    if not value.isascii() or not value.isdecimal() or len(value) > 19:
        raise ValueError('Reload the editor before saving.')
    parsed = int(value)
    if parsed >= 9223372036854775807:
        raise ValueError('Reload the editor before saving.')
    return parsed


@contextmanager
def _transaction():
    conn = get_connection()
    if conn is None:
        raise AppearanceUnavailable('Appearance settings are temporarily unavailable.')
    try:
        with conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            yield cur
    except ValueError:
        raise
    except Exception as exc:
        raise AppearanceUnavailable('Appearance settings are temporarily unavailable.') from exc
    finally:
        conn.close()


def create_schema():
    with _transaction() as cur:
        cur.execute('''
            CREATE TABLE IF NOT EXISTS site_appearance (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                dashboard_title VARCHAR(100) NOT NULL DEFAULT '',
                dashboard_subtitle VARCHAR(180) NOT NULL DEFAULT 'Select your department to continue.',
                banner_text VARCHAR(300) NOT NULL DEFAULT '',
                palette VARCHAR(20) NOT NULL DEFAULT 'classic'
                    CHECK (palette IN ('classic', 'forest', 'ocean', 'plum')),
                card_shape VARCHAR(20) NOT NULL DEFAULT 'rounded'
                    CHECK (card_shape IN ('rounded', 'soft', 'square')),
                density VARCHAR(20) NOT NULL DEFAULT 'comfortable'
                    CHECK (density IN ('comfortable', 'compact')),
                revision BIGINT NOT NULL DEFAULT 0,
                updated_by VARCHAR(255),
                updated_at TIMESTAMPTZ
            );
            ALTER TABLE site_appearance ADD COLUMN IF NOT EXISTS snowfall_enabled BOOLEAN NOT NULL DEFAULT FALSE;
            INSERT INTO site_appearance (id) VALUES (1) ON CONFLICT DO NOTHING;
        ''')


def get_settings():
    with _transaction() as cur:
        cur.execute('''SELECT dashboard_title, dashboard_subtitle, banner_text, palette,
            card_shape, density, snowfall_enabled, revision, updated_at FROM site_appearance WHERE id = 1''')
        row = cur.fetchone()
    if not row:
        return dict(DEFAULT_SETTINGS)
    try:
        return _with_tokens(validate_settings(row), _revision(row['revision']), row.get('updated_at'))
    except (ValueError, KeyError, TypeError) as exc:
        raise AppearanceUnavailable('Saved appearance settings could not be loaded.') from exc


def save_settings(values, actor, revision):
    values, revision = validate_settings(values), _revision(revision)
    actor = str(actor or '').strip()
    if not actor or len(actor) > 255:
        raise ValueError('An authenticated editor is required.')
    with _transaction() as cur:
        cur.execute('''UPDATE site_appearance SET dashboard_title=%s, dashboard_subtitle=%s,
            banner_text=%s, palette=%s, card_shape=%s, density=%s, snowfall_enabled=%s, updated_by=%s,
            updated_at=CURRENT_TIMESTAMP, revision=revision+1
            WHERE id=1 AND revision=%s RETURNING revision''',
            tuple(values[field] for field in SETTING_FIELDS) + (actor, revision))
        if not cur.fetchone():
            raise AppearanceConflict('The appearance changed while you were editing. Reload the editor and try again.')


def reset_settings(actor, revision):
    save_settings(DEFAULT_VALUES, actor, revision)
