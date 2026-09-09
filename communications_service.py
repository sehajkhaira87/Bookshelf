"""Official announcements and private, persistent student notifications."""
from contextlib import contextmanager
from datetime import timezone
from urllib.parse import urlsplit
from uuid import UUID

from psycopg2.extras import RealDictCursor
from database import get_connection


@contextmanager
def transaction():
    conn = get_connection()
    if conn is None:
        raise RuntimeError('Communications are temporarily unavailable.')
    try:
        with conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            yield cur
    finally:
        conn.close()


def create_schema():
    with transaction() as cur:
        cur.execute('''
            CREATE TABLE IF NOT EXISTS official_announcement (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                title VARCHAR(160) NOT NULL DEFAULT '',
                body VARCHAR(2000) NOT NULL DEFAULT '',
                link_url VARCHAR(2000) NOT NULL DEFAULT '',
                active BOOLEAN NOT NULL DEFAULT FALSE,
                revision BIGINT NOT NULL DEFAULT 0,
                updated_by VARCHAR(255),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO official_announcement (id) VALUES (1) ON CONFLICT DO NOTHING;
            CREATE TABLE IF NOT EXISTS student_notifications (
                id BIGSERIAL PRIMARY KEY,
                title VARCHAR(160) NOT NULL,
                body VARCHAR(2000) NOT NULL,
                link_url VARCHAR(2000) NOT NULL DEFAULT '',
                audience VARCHAR(20) NOT NULL CHECK (audience IN ('all', 'selected')),
                created_by VARCHAR(255) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                request_key UUID NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS student_notification_recipients (
                notification_id BIGINT NOT NULL REFERENCES student_notifications(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                read_at TIMESTAMPTZ,
                PRIMARY KEY (notification_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_notification_inbox
                ON student_notification_recipients (user_id, notification_id DESC);
            CREATE INDEX IF NOT EXISTS idx_notification_unread
                ON student_notification_recipients (user_id) WHERE read_at IS NULL;
        ''')


def valid_link(value):
    value = str(value or '').strip()
    if not value:
        return ''
    if len(value) > 2000 or any(ord(c) < 32 for c in value) or '\\' in value:
        raise ValueError('Enter a valid website link.')
    parts = urlsplit(value)
    if value.startswith('/') and not value.startswith('//'):
        return value
    if parts.scheme in ('https', 'http') and parts.hostname and not parts.username and not parts.password:
        return value
    raise ValueError('Links must start with https://, http://, or a single /.')


def content(title, body, link_url):
    title, body = str(title or '').strip(), str(body or '').strip()
    if not 1 <= len(title) <= 160 or not 1 <= len(body) <= 2000 or '\x00' in title + body:
        raise ValueError('Enter a title (up to 160 characters) and a message (up to 2,000 characters).')
    return title, body, valid_link(link_url)


def announcement(include_hidden=False):
    with transaction() as cur:
        cur.execute('SELECT title, body, link_url, active, revision FROM official_announcement WHERE id = 1')
        row = cur.fetchone()
        return dict(row) if row and (include_hidden or row['active']) else None


def save_announcement(title, body, link_url, actor, revision):
    title, body, link_url = content(title, body, link_url)
    with transaction() as cur:
        cur.execute('''UPDATE official_announcement SET title=%s, body=%s, link_url=%s,
            active=TRUE, updated_by=%s, updated_at=CURRENT_TIMESTAMP, revision=revision+1
            WHERE id=1 AND revision=%s RETURNING id''', (title, body, link_url, actor, int(revision)))
        if not cur.fetchone():
            raise ValueError('The announcement changed. Reload this page before saving.')


def remove_announcement(actor, revision):
    with transaction() as cur:
        cur.execute('''UPDATE official_announcement SET active=FALSE, revision=revision+1,
            updated_by=%s, updated_at=CURRENT_TIMESTAMP WHERE id=1 AND revision=%s RETURNING id''',
            (actor, int(revision)))
        if not cur.fetchone():
            raise ValueError('The announcement changed. Reload this page before removing it.')


def find_students(term, admin_emails):
    term = str(term or '').strip()[:200]
    pattern = '%' + term.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
    with transaction() as cur:
        cur.execute('''SELECT id, email, COALESCE(NULLIF(preferred_name, ''), google_name, name, 'Student') AS name,
            department, semester_no FROM users WHERE is_banned=FALSE
            AND NOT (LOWER(email)=ANY(%s))
            AND (email ILIKE %s OR preferred_name ILIKE %s OR google_name ILIKE %s
                 OR name ILIKE %s OR urn ILIKE %s OR crn ILIKE %s)
            ORDER BY id DESC LIMIT 50''', (list(admin_emails), *([pattern] * 6)))
        return [dict(row) for row in cur.fetchall()]


def send_notification(title, body, link_url, audience, recipients, actor, request_key, admin_emails):
    title, body, link_url = content(title, body, link_url)
    key = str(UUID(str(request_key)))
    if audience not in ('all', 'selected'):
        raise ValueError('Choose all students or selected students.')
    try:
        ids = sorted({int(value) for value in recipients}) if audience == 'selected' else []
    except (TypeError, ValueError):
        raise ValueError('Select valid students.') from None
    if audience == 'selected' and (not ids or ids[0] <= 0 or ids[-1] > 2147483647 or len(ids) > 500):
        raise ValueError('Select between 1 and 500 students.')
    with transaction() as cur:
        # A repeated form submission returns the original send; it cannot send twice.
        cur.execute('''INSERT INTO student_notifications (title, body, link_url, audience, created_by, request_key)
            VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (request_key) DO NOTHING RETURNING id''',
            (title, body, link_url, audience, actor, key))
        inserted = cur.fetchone()
        if not inserted:
            cur.execute('''SELECT COUNT(*) AS total FROM student_notification_recipients r
                JOIN student_notifications n ON n.id=r.notification_id WHERE n.request_key=%s''', (key,))
            return cur.fetchone()['total']
        notification_id = inserted['id']
        clause = ' AND id=ANY(%s)' if audience == 'selected' else ''
        cur.execute('''INSERT INTO student_notification_recipients (notification_id, user_id)
            SELECT %s, id FROM users WHERE is_banned=FALSE AND NOT (LOWER(email)=ANY(%s))''' + clause,
            (notification_id, list(admin_emails), ids) if ids else (notification_id, list(admin_emails)))
        count = cur.rowcount
        if not count or (audience == 'selected' and count != len(ids)):
            raise ValueError('One or more recipients are unavailable. Refresh your selection and try again.')
        return count


def history():
    with transaction() as cur:
        cur.execute('''SELECT n.id, n.title, n.body, n.audience, n.created_at,
            COUNT(r.user_id) AS recipients, COUNT(r.read_at) AS read_count
            FROM student_notifications n LEFT JOIN student_notification_recipients r ON r.notification_id=n.id
            GROUP BY n.id ORDER BY n.id DESC LIMIT 50''')
        rows = [dict(row) for row in cur.fetchall()]
        for row in rows:
            row['created_at'] = row['created_at'].astimezone(timezone.utc)
        return rows


def inbox(user_id, before=None):
    with transaction() as cur:
        cur.execute('''SELECT COUNT(*) AS total FROM student_notification_recipients
            WHERE user_id=%s AND read_at IS NULL''', (user_id,))
        unread = cur.fetchone()['total']
        cur.execute('''SELECT n.id, n.title, n.body, n.link_url, n.created_at, r.read_at
            FROM student_notifications n JOIN student_notification_recipients r ON r.notification_id=n.id
            WHERE r.user_id=%s''' + (' AND n.id < %s' if before else '') + ' ORDER BY n.id DESC LIMIT 21',
            (user_id, before) if before else (user_id,))
        rows = [dict(row) for row in cur.fetchall()]
        return {'items': rows[:20], 'unread_count': unread,
                'next_before': rows[19]['id'] if len(rows) > 20 else None}


def mark_read(user_id, notification_id=None, through=None):
    with transaction() as cur:
        if notification_id is not None:
            cur.execute('''UPDATE student_notification_recipients SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP)
                WHERE user_id=%s AND notification_id=%s RETURNING notification_id''', (user_id, notification_id))
            return bool(cur.fetchone())
        cur.execute('''UPDATE student_notification_recipients SET read_at=CURRENT_TIMESTAMP
            WHERE user_id=%s AND notification_id<=%s AND read_at IS NULL''', (user_id, through))
        return True
