"""Shared PYQ catalogue in the application's existing PostgreSQL database."""
import hashlib
from datetime import date

from psycopg2.extras import RealDictCursor
from database import get_connection


def query(sql, parameters=(), one=False):
    conn = get_connection()
    if conn is None:
        raise RuntimeError("The PYQ database is unavailable.")
    try:
        with conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql, parameters)
                if cur.description:
                    return cur.fetchone() if one else cur.fetchall()
    finally:
        conn.close()


def create_pyq_schema():
    query("""
        CREATE TABLE IF NOT EXISTS pyqs (
            id BIGSERIAL PRIMARY KEY,
            subject_code VARCHAR(100) NOT NULL,
            subject_name VARCHAR(255) NOT NULL,
            year INTEGER NOT NULL CHECK (year BETWEEN 1900 AND 9999),
            blob_url TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            file_size BIGINT NOT NULL CHECK (file_size > 0),
            file_hash CHAR(64) NOT NULL UNIQUE,
            uploaded_by VARCHAR(255) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_pyqs_year_id ON pyqs(year DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_pyqs_subject_code ON pyqs(subject_code);
        ALTER TABLE pyqs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
    """)


def validate_metadata(subject_code, subject_name, year):
    code = str(subject_code or '').strip()
    name = str(subject_name or '').strip()
    try:
        year = int(year)
    except (ValueError, TypeError):
        raise ValueError("Enter a valid exam year.")
    if not 1900 <= year <= date.today().year + 1:
        raise ValueError("Enter a valid exam year.")
    if not code or len(code) > 100 or not name or len(name) > 255:
        raise ValueError("Subject code and subject name are required (maximum 100 and 255 characters).")
    return code, name, year


def fingerprint(stream):
    stream.seek(0)
    digest = hashlib.sha256()
    size = 0
    header = stream.read(1024)
    if b'%PDF-' not in header:
        raise ValueError("Only PDF files are accepted.")
    stream.seek(0)
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        size += len(chunk)
        if size > 50 * 1024 * 1024:
            raise ValueError("PDFs must be 50 MB or smaller.")
        digest.update(chunk)
    stream.seek(0)
    return digest.hexdigest(), size


def import_pdf(stream, filename, subject_code, subject_name, year, actor):
    from storage_agent import upload_file, delete_file
    code, name, year = validate_metadata(subject_code, subject_name, year)
    if not filename.lower().endswith('.pdf'):
        raise ValueError("Only PDF files are accepted.")
    digest, size = fingerprint(stream)
    existing = query('SELECT id FROM pyqs WHERE file_hash = %s', (digest,), one=True)
    if existing:
        return existing['id'], False
    result = upload_file(stream, filename, 'pyq')
    if not result or not result.get('blob_url'):
        raise RuntimeError("The PDF could not be uploaded to Azure.")
    url = result['blob_url']
    try:
        row = query("""INSERT INTO pyqs
            (subject_code, subject_name, year, blob_url, original_filename,
             file_size, file_hash, uploaded_by)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (file_hash) DO NOTHING RETURNING id""",
            (code, name, year, url, filename, size, digest, actor), one=True)
    except Exception:
        if not delete_file(url):
            raise RuntimeError("Database save failed; Azure cleanup also failed for " + url)
        raise
    if row:
        return row['id'], True
    if not delete_file(url):
        raise RuntimeError("Duplicate detected; Azure cleanup failed for " + url)
    return None, False


def list_pyqs(search='', year=None, page=1):
    conditions, params = [], []
    if search:
        pattern = '%' + search.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        conditions.append('(subject_code ILIKE %s OR subject_name ILIKE %s)')
        params.extend([pattern, pattern])
    if year:
        conditions.append('year = %s')
        params.append(year)
    where = ' WHERE ' + ' AND '.join(conditions) if conditions else ''
    total = query('SELECT COUNT(*) AS total FROM pyqs' + where, params, one=True)['total']
    rows = query('SELECT *, subject_code || \' - \' || subject_name AS title FROM pyqs' +
                 where + ' ORDER BY year DESC, id DESC LIMIT 50 OFFSET %s',
                 [*params, (page - 1) * 50])
    return rows, total


def get_pyq_summary():
    """Read the shared archive, including papers saved by the independent uploader."""
    rows = query('SELECT year, COUNT(*) AS total FROM pyqs GROUP BY year ORDER BY year DESC')
    years = [row['year'] for row in rows]
    return {'total': sum(row['total'] for row in rows), 'years': years,
            'oldest_year': min(years) if years else None,
            'newest_year': max(years) if years else None}


def rename_pyq(paper_id, subject_name, expected_name):
    """Rename one paper without changing its file, code, year or import identity."""
    name = ' '.join(str(subject_name or '').split())
    if not name or len(name) > 255 or any(ord(character) < 32 for character in name):
        raise ValueError('Enter a subject name between 1 and 255 characters.')
    row = query('''UPDATE pyqs SET subject_name=%s, updated_at=CURRENT_TIMESTAMP
        WHERE id=%s AND subject_name=%s RETURNING id''',
        (name, paper_id, expected_name), one=True)
    return bool(row)
