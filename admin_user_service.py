"""Database operations used by the admin user-management panel.

This module deliberately contains no Flask-specific behavior. Routes are expected
to translate ``AdminUserServiceError`` into an admin-facing flash message while
``AdminUserValidationError`` represents invalid form input.
"""

from __future__ import annotations

from typing import Any

from psycopg2.extras import RealDictCursor

from database import get_connection


MAX_SEARCH_LENGTH = 200
MAX_WARNING_LENGTH = 2_000
MAX_WARNING_ACTOR_LENGTH = 255
DEFAULT_USER_LIMIT = 100
MAX_USER_LIMIT = 500


class AdminUserServiceError(RuntimeError):
    """Raised when an admin-user database operation cannot be completed."""


class AdminUserValidationError(ValueError):
    """Raised when admin-provided moderation data is invalid."""


def _positive_user_id(user_id: Any) -> int:
    if isinstance(user_id, bool):
        raise AdminUserValidationError("A valid user ID is required.")

    try:
        parsed_user_id = int(user_id)
    except (TypeError, ValueError) as exc:
        raise AdminUserValidationError("A valid user ID is required.") from exc

    if parsed_user_id <= 0:
        raise AdminUserValidationError("A valid user ID is required.")
    return parsed_user_id


def _validated_limit(limit: Any, maximum: int = MAX_USER_LIMIT) -> int:
    if isinstance(limit, bool):
        raise AdminUserValidationError("The result limit must be a number.")

    try:
        parsed_limit = int(limit)
    except (TypeError, ValueError) as exc:
        raise AdminUserValidationError("The result limit must be a number.") from exc

    if not 1 <= parsed_limit <= maximum:
        raise AdminUserValidationError(
            f"The result limit must be between 1 and {maximum}."
        )
    return parsed_limit


def _open_connection():
    connection = get_connection()
    if connection is None:
        raise AdminUserServiceError("The user database is currently unavailable.")
    return connection


def _escape_like(value: str) -> str:
    """Treat %, _ and backslash as text in an ILIKE search."""

    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def create_admin_user_schema() -> bool:
    """Add moderation fields and the warnings table if they do not exist.

    Call this after the base ``users`` table has been created. The statements are
    safe to run more than once and do not overwrite existing moderation data.
    """

    connection = _open_connection()
    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            """
            ALTER TABLE users
                ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;

            CREATE TABLE IF NOT EXISTS user_warnings (
                id BIGSERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                message VARCHAR(2000) NOT NULL CHECK (char_length(trim(message)) > 0),
                created_by VARCHAR(255) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                acknowledged_at TIMESTAMPTZ
            );

            CREATE INDEX IF NOT EXISTS idx_user_warnings_user_created
                ON user_warnings (user_id, created_at DESC);
            """
        )
        connection.commit()
        return True
    except Exception as exc:
        connection.rollback()
        raise AdminUserServiceError(
            "Could not initialize the admin user-management schema."
        ) from exc
    finally:
        if cursor is not None:
            cursor.close()
        connection.close()


def search_users(search_term: str | None = None, limit: int = DEFAULT_USER_LIMIT) -> list[dict]:
    """Return users matching an email, either name, URN, or CRN.

    The search is case-insensitive and wildcard characters are treated literally.
    An empty search returns the most recently registered users.
    """

    term = str(search_term or "").strip()
    if len(term) > MAX_SEARCH_LENGTH:
        raise AdminUserValidationError(
            f"Search text cannot exceed {MAX_SEARCH_LENGTH} characters."
        )
    parsed_limit = _validated_limit(limit)

    parameters: list[Any] = []
    where_clause = ""
    if term:
        pattern = f"%{_escape_like(term)}%"
        where_clause = """
            WHERE u.email ILIKE %s ESCAPE '\\'
               OR COALESCE(u.google_name, u.name, '') ILIKE %s ESCAPE '\\'
               OR COALESCE(u.preferred_name, '') ILIKE %s ESCAPE '\\'
               OR COALESCE(u.urn, '') ILIKE %s ESCAPE '\\'
               OR COALESCE(u.crn, '') ILIKE %s ESCAPE '\\'
        """
        parameters.extend([pattern] * 5)
    parameters.append(parsed_limit)

    connection = _open_connection()
    cursor = None
    try:
        cursor = connection.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            f"""
            SELECT
                u.id,
                u.email,
                COALESCE(NULLIF(trim(u.google_name), ''), NULLIF(trim(u.name), ''))
                    AS google_name,
                NULLIF(trim(u.preferred_name), '') AS preferred_name,
                u.department,
                u.urn,
                u.crn,
                u.semester_no,
                u.created_at,
                COALESCE(u.is_banned, FALSE) AS is_banned,
                u.banned_at,
                COUNT(w.id)::INTEGER AS warning_count,
                MAX(w.created_at) AS latest_warning_at
            FROM users AS u
            LEFT JOIN user_warnings AS w ON w.user_id = u.id
            {where_clause}
            GROUP BY u.id
            ORDER BY COALESCE(u.is_banned, FALSE) DESC, u.created_at DESC, u.id DESC
            LIMIT %s
            """,
            parameters,
        )
        return [dict(row) for row in cursor.fetchall()]
    except Exception as exc:
        raise AdminUserServiceError("Could not load the user database.") from exc
    finally:
        if cursor is not None:
            cursor.close()
        connection.close()


def set_user_banned(user_id: Any, is_banned: bool) -> bool:
    """Set a user's ban state, returning ``False`` when the user does not exist."""

    parsed_user_id = _positive_user_id(user_id)
    if not isinstance(is_banned, bool):
        raise AdminUserValidationError("The ban state must be true or false.")

    connection = _open_connection()
    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            """
            UPDATE users
            SET is_banned = %s,
                banned_at = CASE WHEN %s THEN CURRENT_TIMESTAMP ELSE NULL END
            WHERE id = %s
            RETURNING id
            """,
            (is_banned, is_banned, parsed_user_id),
        )
        updated = cursor.fetchone() is not None
        connection.commit()
        return updated
    except Exception as exc:
        connection.rollback()
        raise AdminUserServiceError("Could not update the user's ban status.") from exc
    finally:
        if cursor is not None:
            cursor.close()
        connection.close()


def ban_user(user_id: Any) -> bool:
    """Ban a user, returning ``False`` when the user does not exist."""

    return set_user_banned(user_id, True)


def unban_user(user_id: Any) -> bool:
    """Remove a user ban, returning ``False`` when the user does not exist."""

    return set_user_banned(user_id, False)


def create_warning(user_id: Any, message: str, created_by: str = "admin") -> int | None:
    """Create a warning and return its ID, or ``None`` for an unknown user."""

    parsed_user_id = _positive_user_id(user_id)
    clean_message = str(message or "").strip()
    clean_actor = str(created_by or "").strip()

    if not clean_message:
        raise AdminUserValidationError("Warning text is required.")
    if len(clean_message) > MAX_WARNING_LENGTH:
        raise AdminUserValidationError(
            f"Warning text cannot exceed {MAX_WARNING_LENGTH} characters."
        )
    if not clean_actor:
        raise AdminUserValidationError("The warning author is required.")
    if len(clean_actor) > MAX_WARNING_ACTOR_LENGTH:
        raise AdminUserValidationError(
            f"The warning author cannot exceed {MAX_WARNING_ACTOR_LENGTH} characters."
        )

    connection = _open_connection()
    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            """
            INSERT INTO user_warnings (user_id, message, created_by)
            SELECT id, %s, %s
            FROM users
            WHERE id = %s
            RETURNING id
            """,
            (clean_message, clean_actor, parsed_user_id),
        )
        row = cursor.fetchone()
        connection.commit()
        return int(row[0]) if row else None
    except Exception as exc:
        connection.rollback()
        raise AdminUserServiceError("Could not send the warning.") from exc
    finally:
        if cursor is not None:
            cursor.close()
        connection.close()


def list_warnings(user_id: Any, limit: int = 50) -> list[dict]:
    """Return a user's warnings, newest first."""

    parsed_user_id = _positive_user_id(user_id)
    parsed_limit = _validated_limit(limit, maximum=200)

    connection = _open_connection()
    cursor = None
    try:
        cursor = connection.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            """
            SELECT id, user_id, message, created_by, created_at, acknowledged_at
            FROM user_warnings
            WHERE user_id = %s
            ORDER BY created_at DESC, id DESC
            LIMIT %s
            """,
            (parsed_user_id, parsed_limit),
        )
        return [dict(row) for row in cursor.fetchall()]
    except Exception as exc:
        raise AdminUserServiceError("Could not load the user's warnings.") from exc
    finally:
        if cursor is not None:
            cursor.close()
        connection.close()


def list_warnings_for_users(
    user_ids: list[int] | tuple[int, ...], limit_per_user: int = 20
) -> dict[int, list[dict]]:
    """Load recent warning histories for several users in one database query."""

    parsed_ids = list(dict.fromkeys(_positive_user_id(user_id) for user_id in user_ids))
    if not parsed_ids:
        return {}
    if len(parsed_ids) > MAX_USER_LIMIT:
        raise AdminUserValidationError(
            f"Warning history can be loaded for at most {MAX_USER_LIMIT} users."
        )
    parsed_limit = _validated_limit(limit_per_user, maximum=100)

    connection = _open_connection()
    cursor = None
    try:
        cursor = connection.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            """
            SELECT id, user_id, message, created_by, created_at, acknowledged_at
            FROM (
                SELECT
                    id, user_id, message, created_by, created_at, acknowledged_at,
                    ROW_NUMBER() OVER (
                        PARTITION BY user_id ORDER BY created_at DESC, id DESC
                    ) AS warning_rank
                FROM user_warnings
                WHERE user_id = ANY(%s)
            ) AS ranked_warnings
            WHERE warning_rank <= %s
            ORDER BY user_id, created_at DESC, id DESC
            """,
            (parsed_ids, parsed_limit),
        )
        warnings_by_user = {user_id: [] for user_id in parsed_ids}
        for row in cursor.fetchall():
            warning = dict(row)
            warnings_by_user.setdefault(int(warning["user_id"]), []).append(warning)
        return warnings_by_user
    except Exception as exc:
        raise AdminUserServiceError("Could not load warning histories.") from exc
    finally:
        if cursor is not None:
            cursor.close()
        connection.close()


def delete_warning(user_id: Any, warning_id: Any) -> bool:
    """Delete one warning belonging to a user, returning False if it is absent."""

    parsed_user_id = _positive_user_id(user_id)
    parsed_warning_id = _positive_user_id(warning_id)

    connection = _open_connection()
    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            """
            DELETE FROM user_warnings
            WHERE id = %s AND user_id = %s
            RETURNING id
            """,
            (parsed_warning_id, parsed_user_id),
        )
        deleted = cursor.fetchone() is not None
        connection.commit()
        return deleted
    except Exception as exc:
        connection.rollback()
        raise AdminUserServiceError("Could not remove the warning.") from exc
    finally:
        if cursor is not None:
            cursor.close()
        connection.close()
