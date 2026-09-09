"""Approximate signed-in student presence from visible website pages."""
from communications_service import transaction


def record_activity(user_id, admin_emails):
    with transaction() as cur:
        cur.execute('''UPDATE users SET last_seen_at=CURRENT_TIMESTAMP
            WHERE id=%s AND is_banned=FALSE AND NOT (LOWER(email)=ANY(%s))
              AND (last_seen_at IS NULL OR last_seen_at < CURRENT_TIMESTAMP - INTERVAL '30 seconds')''',
            (user_id, list(admin_emails)))


def active_students(admin_emails):
    with transaction() as cur:
        eligible = ''' FROM users WHERE is_banned=FALSE AND NOT (LOWER(email)=ANY(%s))
            AND last_seen_at >= CURRENT_TIMESTAMP - INTERVAL '5 minutes' '''
        cur.execute('SELECT COUNT(*) AS total' + eligible, (list(admin_emails),))
        total = cur.fetchone()['total']
        cur.execute('''SELECT id, email, COALESCE(NULLIF(preferred_name, ''), NULLIF(google_name, ''), name, 'Student') AS name,
            department, semester_no, last_seen_at''' + eligible + 'ORDER BY last_seen_at DESC, id DESC LIMIT 50',
            (list(admin_emails),))
        items = [dict(row) for row in cur.fetchall()]
        for item in items:
            item['last_seen_at'] = item['last_seen_at'].isoformat()
        return {'total': total, 'items': items, 'window_minutes': 5}
