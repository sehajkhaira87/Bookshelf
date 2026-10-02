"""Student-only reads for the delegated user-management workspace."""

from psycopg2.extras import RealDictCursor

from admin_user_service import AdminUserServiceError, AdminUserValidationError
from database import get_connection


PAGE_SIZE = 25
RESOURCE_CATEGORIES = ('notes', 'assignment', 'book')


def normalize_email(value):
    return str(value or '').strip().casefold()


def is_manageable_student(user, admin_emails, actor_email):
    """Fail closed for unknown roles and identities, even on crafted requests."""
    if not user:
        return False
    # An explicit canonical array always wins over a stale legacy scalar.
    # Unknown/malformed role data must never make an account manageable.
    if 'roles' in user:
        roles = user['roles']
        if not isinstance(roles, (list, tuple)) or roles:
            return False
    elif user.get('role') != 'student':
        return False
    email = normalize_email(user.get('email'))
    protected = {normalize_email(value) for value in admin_emails}
    protected.update({'admin', normalize_email(actor_email)})
    return bool(email and email not in protected)


def _scope(admin_emails, actor_email):
    protected = sorted({normalize_email(value) for value in admin_emails} |
                       {'admin', normalize_email(actor_email)})
    return "cardinality(u.roles) = 0 AND LOWER(BTRIM(u.email)) <> ALL(%s)", [protected]


def _search(value):
    term = str(value or '').strip()
    if len(term) > 200:
        raise AdminUserValidationError('Search text cannot exceed 200 characters.')
    return '%' + term.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'


def _query(sql, params):
    connection = get_connection()
    if connection is None:
        raise AdminUserServiceError('Student management is temporarily unavailable.')
    try:
        with connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(sql, params)
            return [dict(row) for row in cursor.fetchall()]
    except Exception as exc:
        raise AdminUserServiceError('Student management is temporarily unavailable.') from exc
    finally:
        connection.close()


def _page(value):
    try:
        page = int(value)
    except (TypeError, ValueError) as exc:
        raise AdminUserValidationError('Choose a valid page.') from exc
    if not 1 <= page <= 100000:
        raise AdminUserValidationError('Choose a valid page.')
    return page


def list_students(search, page, admin_emails, actor_email):
    clause, params = _scope(admin_emails, actor_email)
    pattern, page = _search(search), _page(page)
    rows = _query(f"""
        SELECT u.id, u.email, u.role, u.roles, u.name, u.google_name, u.preferred_name,
               u.department, u.urn, u.crn, u.semester_no, u.is_banned,
               u.contributor_badge,
               (SELECT COUNT(*) FROM user_warnings w WHERE w.user_id = u.id) AS warning_count
        FROM users u
        WHERE {clause}
          AND (u.email ILIKE %s OR COALESCE(u.preferred_name, '') ILIKE %s
               OR COALESCE(u.google_name, u.name, '') ILIKE %s
               OR COALESCE(u.urn, '') ILIKE %s OR COALESCE(u.crn, '') ILIKE %s)
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT %s OFFSET %s
        """, [*params, *([pattern] * 5), PAGE_SIZE + 1, (page - 1) * PAGE_SIZE])
    return rows[:PAGE_SIZE], len(rows) > PAGE_SIZE


def get_student(user_id, admin_emails, actor_email):
    clause, params = _scope(admin_emails, actor_email)
    rows = _query(f"""SELECT u.id, u.email, u.role, u.roles, u.is_banned
        FROM users u WHERE {clause} AND u.id = %s""", [*params, user_id])
    return rows[0] if rows else None


def list_student_resources(search, status, page, admin_emails, actor_email):
    clause, params = _scope(admin_emails, actor_email)
    pattern, page = _search(search), _page(page)
    if status not in ('', 'verified', 'unverified'):
        raise AdminUserValidationError('Choose a valid resource status.')
    params.extend([list(RESOURCE_CATEGORIES), pattern, pattern, pattern])
    status_clause = ''
    if status:
        status_clause = 'AND r.status = %s'
        params.append(status)
    rows = _query(f"""
        SELECT r.id, r.title, r.category, r.branch, r.semester, r.blob_url,
               r.status, r.uploaded_by, r.subject_name, r.file_name,
               COALESCE(NULLIF(BTRIM(u.preferred_name), ''),
                        NULLIF(BTRIM(u.google_name), ''), u.name) AS contributor_name
        FROM resources r
        JOIN users u ON LOWER(BTRIM(u.email)) = LOWER(BTRIM(r.uploaded_by))
        WHERE {clause} AND r.category = ANY(%s)
          AND (r.title ILIKE %s OR COALESCE(r.subject_name, '') ILIKE %s
               OR r.uploaded_by ILIKE %s) {status_clause}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT %s OFFSET %s
        """, [*params, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE])
    return rows[:PAGE_SIZE], len(rows) > PAGE_SIZE
