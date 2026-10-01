"""Administrator-only role assignment and audit persistence."""
from database import get_connection
from role_access import normalize_email


ROLE_ORDER = ('notification_head', 'user_manager', 'ui_editor')


class RoleServiceError(RuntimeError):
    pass


def _connection():
    connection = get_connection()
    if connection is None:
        raise RoleServiceError('Role assignments are temporarily unavailable.')
    return connection


def create_schema():
    connection = _connection()
    try:
        with connection, connection.cursor() as cursor:
            cursor.execute('''CREATE TABLE IF NOT EXISTS user_role_changes (
                id BIGSERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                previous_role VARCHAR(32) NOT NULL,
                new_role VARCHAR(32) NOT NULL,
                changed_by VARCHAR(255) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            ALTER TABLE user_role_changes ADD COLUMN IF NOT EXISTS previous_roles TEXT[];
            ALTER TABLE user_role_changes ADD COLUMN IF NOT EXISTS new_roles TEXT[];
            UPDATE user_role_changes SET previous_roles = CASE
                WHEN previous_role IN ('notification_head', 'user_manager', 'ui_editor')
                    THEN ARRAY[previous_role]::TEXT[] ELSE ARRAY[]::TEXT[] END
                WHERE previous_roles IS NULL;
            UPDATE user_role_changes SET new_roles = CASE
                WHEN new_role IN ('notification_head', 'user_manager', 'ui_editor')
                    THEN ARRAY[new_role]::TEXT[] ELSE ARRAY[]::TEXT[] END
                WHERE new_roles IS NULL;
            ALTER TABLE user_role_changes ALTER COLUMN previous_roles SET DEFAULT ARRAY[]::TEXT[];
            ALTER TABLE user_role_changes ALTER COLUMN previous_roles SET NOT NULL;
            ALTER TABLE user_role_changes ALTER COLUMN new_roles SET DEFAULT ARRAY[]::TEXT[];
            ALTER TABLE user_role_changes ALTER COLUMN new_roles SET NOT NULL;
            ''')
    except Exception as exc:
        raise RoleServiceError('Could not initialize role assignments.') from exc
    finally:
        connection.close()


def _selected_roles(roles):
    if not isinstance(roles, (list, tuple)) or any(
            not isinstance(role, str) or role not in ROLE_ORDER for role in roles):
        raise ValueError('Choose only the available staff roles, or clear all roles for a student account.')
    return [role for role in ROLE_ORDER if role in roles]


def assign_roles(user_id, roles, actor_email, admin_emails):
    """Replace the complete role set atomically; an empty set revokes staff access."""
    selected = _selected_roles(roles)
    if isinstance(user_id, (bool, float)):
        raise ValueError('A valid user ID is required.')
    try:
        user_id = int(user_id)
    except (TypeError, ValueError) as exc:
        raise ValueError('A valid user ID is required.') from exc
    if not 0 < user_id <= 2147483647:
        raise ValueError('A valid user ID is required.')
    admins = {normalize_email(email) for email in admin_emails}
    actor_email = normalize_email(actor_email)
    if not actor_email or actor_email not in admins:
        raise ValueError('Only an administrator can assign roles.')
    connection = _connection()
    try:
        with connection, connection.cursor() as cursor:
            cursor.execute('SELECT email, role, roles, is_banned FROM users WHERE id=%s FOR UPDATE', (user_id,))
            row = cursor.fetchone()
            if not row:
                return False
            email, previous, previous_roles, banned = row
            _selected_roles(previous_roles)
            previous_roles = list(previous_roles)
            if normalize_email(email) in admins:
                raise ValueError('Administrator access is managed by the administrator allowlist.')
            if banned and selected:
                raise ValueError('Restore this account before assigning a staff role.')
            primary = selected[0] if selected else 'student'
            if previous_roles == selected and previous == primary:
                return True
            cursor.execute('UPDATE users SET roles=%s, role=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s',
                           (selected, primary, user_id))
            if previous_roles != selected:
                cursor.execute('''INSERT INTO user_role_changes
                    (user_id, previous_role, new_role, changed_by, previous_roles, new_roles)
                    VALUES (%s, %s, %s, %s, %s, %s)''',
                    (user_id, previous, primary, actor_email, previous_roles, selected))
        return True
    except ValueError:
        raise
    except Exception as exc:
        raise RoleServiceError('The roles could not be saved. Please try again.') from exc
    finally:
        connection.close()


def assign_role(user_id, role, actor_email, admin_emails):
    """Compatibility entry point for callers assigning one role at a time."""
    return assign_roles(user_id, [] if role == 'student' else [role], actor_email, admin_emails)
