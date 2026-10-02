"""Shared department catalogue for dashboard, profiles, and resource forms."""
import re
import warnings
from io import BytesIO
from contextlib import contextmanager
from unicodedata import category

from psycopg2.extras import RealDictCursor
from PIL import Image, ImageOps, UnidentifiedImageError
from database import get_connection


ICONS = {
    'computer': ('Computer', 'images/cse-icon.svg'),
    'chip': ('Technology', 'images/it-icon.svg'),
    'electronics': ('Electronics', 'images/electronics.svg'),
    'electrical': ('Electrical', 'images/electrical.svg'),
    'mechanical': ('Mechanical', 'images/me-icon.svg'),
    'civil': ('Civil', 'images/civil.svg'),
    'books': ('Books', 'images/books-icon.svg'),
}
DEFAULT_DEPARTMENTS = tuple(
    {'code': code, 'name': name, 'icon': icon, 'icon_path': ICONS[icon][1]}
    for code, name, icon in (
        ('CSE', 'Computer Science', 'computer'),
        ('IT', 'Information Technology', 'chip'),
        ('ECE', 'Electronics & Communication', 'electronics'),
        ('EE', 'Electrical Engineering', 'electrical'),
        ('ME', 'Mechanical Engineering', 'mechanical'),
        ('CE', 'Civil Engineering', 'civil'),
    )
)
CODE_PATTERN = re.compile(r'^[A-Z][A-Z0-9]{1,11}$')
MAX_ICON_BYTES = 2 * 1024 * 1024
MAX_ICON_DIMENSION = 2048
ICON_OUTPUT_DIMENSION = 256


class DepartmentUnavailable(RuntimeError):
    pass


@contextmanager
def _transaction():
    connection = get_connection()
    if connection is None:
        raise DepartmentUnavailable('Departments are temporarily unavailable.')
    try:
        with connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
            yield cursor
    except ValueError:
        raise
    except Exception as exc:
        raise DepartmentUnavailable('Departments are temporarily unavailable.') from exc
    finally:
        connection.close()


def validate_department(values):
    code, name, icon = (values.get(key, '') for key in ('code', 'name', 'icon'))
    if not isinstance(code, str) or not CODE_PATTERN.fullmatch(code.strip().upper()):
        raise ValueError('Use a department code of 2–12 letters or numbers, starting with a letter.')
    if not isinstance(name, str) or not 2 <= len(name.strip()) <= 80:
        raise ValueError('Department name must contain 2–80 characters.')
    if any(category(character) in {'Cc', 'Cs'} for character in name):
        raise ValueError('Department name must be a single line of text.')
    if not isinstance(icon, str) or icon not in ICONS:
        raise ValueError('Choose one of the department icons.')
    return {'code': code.strip().upper(), 'name': name.strip(), 'icon': icon}


def create_schema():
    with _transaction() as cursor:
        cursor.execute('''CREATE TABLE IF NOT EXISTS site_departments (
            code VARCHAR(12) PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9]{1,11}$'),
            name VARCHAR(80) NOT NULL CHECK (char_length(btrim(name)) >= 2),
            icon VARCHAR(20) NOT NULL,
            created_by VARCHAR(255),
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        ALTER TABLE site_departments ADD COLUMN IF NOT EXISTS icon_png BYTEA;
        ''')
        for item in DEFAULT_DEPARTMENTS:
            cursor.execute('''INSERT INTO site_departments (code, name, icon)
                VALUES (%s, %s, %s) ON CONFLICT (code) DO NOTHING''',
                (item['code'], item['name'], item['icon']))


def list_departments():
    with _transaction() as cursor:
        cursor.execute('''SELECT code, name, icon, (icon_png IS NOT NULL) AS has_custom_icon
            FROM site_departments ORDER BY created_at, code''')
        rows = cursor.fetchall()
    # Retain the familiar order of the original departments; new ones follow.
    order = {item['code']: index for index, item in enumerate(DEFAULT_DEPARTMENTS)}
    try:
        result = []
        for row in rows:
            item = validate_department(dict(row))
            item['icon_path'] = ICONS[item['icon']][1]
            item['has_custom_icon'] = bool(row.get('has_custom_icon'))
            result.append(item)
        return sorted(result, key=lambda item: order.get(item['code'], len(order)))
    except (ValueError, TypeError) as exc:
        raise DepartmentUnavailable('Saved departments could not be loaded.') from exc


def prepare_icon(file):
    """Decode bounded raster uploads and return a small, metadata-free PNG."""
    content = file.stream.read(MAX_ICON_BYTES + 1)
    if not content:
        raise ValueError('Choose a PNG, JPG, or WebP image for the department icon.')
    if len(content) > MAX_ICON_BYTES:
        raise ValueError('The department icon must be 2 MB or smaller.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                if image.format not in {'PNG', 'JPEG', 'WEBP'}:
                    raise ValueError('Use a PNG, JPG, or WebP image for the department icon.')
                if max(image.size) > MAX_ICON_DIMENSION:
                    raise ValueError('The department icon must be no larger than 2048 × 2048 pixels.')
                if getattr(image, 'n_frames', 1) != 1:
                    raise ValueError('Use a still image for the department icon.')
                image.verify()
            with Image.open(BytesIO(content)) as image:
                image.load()
                pixels = ImageOps.exif_transpose(image).convert('RGBA')
                pixels.thumbnail((ICON_OUTPUT_DIMENSION, ICON_OUTPUT_DIMENSION), Image.Resampling.LANCZOS)
                clean = Image.new('RGBA', pixels.size)
                clean.paste(pixels)
                result = BytesIO()
                clean.save(result, format='PNG')
                return result.getvalue()
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as exc:
        raise ValueError('This icon could not be read. Choose a valid PNG, JPG, or WebP image.') from exc


def get_department_icon(code):
    normalized = str(code or '').strip().upper()
    if not CODE_PATTERN.fullmatch(normalized):
        return None
    with _transaction() as cursor:
        cursor.execute('SELECT icon_png FROM site_departments WHERE code=%s', (normalized,))
        row = cursor.fetchone()
    return bytes(row['icon_png']) if row and row['icon_png'] is not None else None


def add_department(values, actor, icon_file=None):
    item = validate_department(values)
    actor = str(actor or '').strip()
    if not actor or len(actor) > 255:
        raise ValueError('An authenticated editor is required.')
    icon_png = prepare_icon(icon_file) if icon_file is not None else None
    with _transaction() as cursor:
        cursor.execute('''INSERT INTO site_departments (code, name, icon, created_by, icon_png)
            VALUES (%s, %s, %s, %s, %s) ON CONFLICT (code) DO NOTHING RETURNING code''',
            (item['code'], item['name'], item['icon'], actor, icon_png))
        if not cursor.fetchone():
            raise ValueError('This department code already exists. Choose a different code.')
    return item


def is_valid_department(code):
    normalized = str(code or '').strip().upper()
    if not CODE_PATTERN.fullmatch(normalized):
        return False
    return any(item['code'] == normalized for item in list_departments())
