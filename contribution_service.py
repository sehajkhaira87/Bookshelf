"""Private contribution history and moderation of removal requests."""

from psycopg2.extras import RealDictCursor

from db_agent import get_connection
from storage_agent import delete_file


PAGE_SIZE = 25
MAX_REASON_LENGTH = 1000
REMOVAL_REASONS = {
    'wrong-file': 'I uploaded the wrong file',
    'duplicate': 'This is a duplicate upload',
    'new-version': 'I have a newer version',
    'outdated': 'The material is incorrect or outdated',
    'personal-info': 'The file contains personal information',
    'other': 'Other',
}
MAX_REASON_DETAILS_LENGTH = MAX_REASON_LENGTH - max(map(len, REMOVAL_REASONS.values())) - 1
PENDING_REMOVAL = ('removed_at IS NULL AND removal_requested_at IS NOT NULL '
                   'AND removal_declined_at IS NULL')


class ContributionUnavailable(RuntimeError):
    """The database or file storage could not complete the operation."""


def _query(sql, params, *, rows=False):
    connection = get_connection()
    if connection is None:
        raise ContributionUnavailable('The contribution database is unavailable.')
    try:
        with connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall() if rows else cursor.rowcount == 1
    finally:
        connection.close()


def list_contributions(email, page):
    rows = _query('''
        WITH history AS (
            SELECT id, title, category, branch, semester, subject_name, status, created_at,
                   removed_at, removal_requested_at, removal_reason, removal_declined_at
            FROM resources
            WHERE LOWER(BTRIM(uploaded_by)) = %s
        )
        SELECT totals.total, entries.*
        FROM (SELECT COUNT(*) AS total FROM history) totals
        LEFT JOIN (
            SELECT * FROM history
            ORDER BY created_at ASC NULLS LAST, id ASC
            LIMIT %s OFFSET %s
        ) entries ON TRUE
        ORDER BY entries.created_at ASC NULLS LAST, entries.id ASC
    ''', (email, PAGE_SIZE, (page - 1) * PAGE_SIZE), rows=True)
    # The count row is retained even when there are no entries on this page.
    return [row for row in rows if row['id'] is not None], rows[0]['total']


def request_removal(resource_id, email, reason, *, reason_option=None):
    reason = reason.strip()
    if reason_option is not None:
        label = REMOVAL_REASONS.get(reason_option)
        if label is None:
            raise ValueError('Choose a reason for removal.')
        if reason_option == 'other' and not reason:
            raise ValueError('Explain why you want this contribution removed.')
        if len(reason) > MAX_REASON_DETAILS_LENGTH or '\x00' in reason:
            raise ValueError(f'Keep the details within {MAX_REASON_DETAILS_LENGTH} characters.')
        reason = f'{label}\n{reason}' if reason else label
    if not 1 <= len(reason) <= MAX_REASON_LENGTH or '\x00' in reason:
        raise ValueError('Enter a reason of up to 1,000 characters.')
    # An atomic write checks ownership and prevents a duplicate pending request.
    return _query('''
        UPDATE resources
        SET removal_requested_at = CURRENT_TIMESTAMP, removal_reason = %s,
            removal_declined_at = NULL
        WHERE id = %s AND LOWER(BTRIM(uploaded_by)) = %s AND removed_at IS NULL
          AND (removal_requested_at IS NULL OR removal_declined_at IS NOT NULL)
    ''', (reason, resource_id, email))


def list_removal_requests(page):
    rows = _query(f'''
        SELECT id, title, category, status, uploaded_by, removal_requested_at, removal_reason
        FROM resources WHERE {PENDING_REMOVAL}
        ORDER BY removal_requested_at ASC, id ASC
        LIMIT %s OFFSET %s
    ''', (PAGE_SIZE + 1, (page - 1) * PAGE_SIZE), rows=True)
    return rows[:PAGE_SIZE], len(rows) > PAGE_SIZE


def decline_removal(resource_id, requested_at):
    return _query(f'''
        UPDATE resources SET removal_declined_at = CURRENT_TIMESTAMP
        WHERE id = %s AND {PENDING_REMOVAL} AND removal_requested_at = %s
    ''', (resource_id, requested_at))


def remove_resource(resource_id, *, requested_at=None):
    """Remove the file and retain the last verification state in history."""
    connection = get_connection()
    if connection is None:
        raise ContributionUnavailable('The contribution database is unavailable.')
    clause = 'removed_at IS NULL'
    params = (resource_id,)
    if requested_at is not None:
        clause = PENDING_REMOVAL + ' AND removal_requested_at = %s'
        params += (requested_at,)
    try:
        with connection, connection.cursor() as cursor:
            # Serialize deletion with decisions and verification for this row.
            cursor.execute(f'SELECT blob_url FROM resources WHERE id = %s AND {clause} FOR UPDATE',
                           params)
            resource = cursor.fetchone()
            if resource is None:
                return False
            if not delete_file(resource[0]):
                raise ContributionUnavailable('The contribution file could not be removed.')
            cursor.execute('UPDATE resources SET removed_at = CURRENT_TIMESTAMP WHERE id = %s',
                           (resource_id,))
            return True
    finally:
        connection.close()
