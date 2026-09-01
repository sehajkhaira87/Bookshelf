import logging
import os
import re

import psycopg2
from dotenv import load_dotenv

from db_agent import create_resources_table


load_dotenv()

logger = logging.getLogger(__name__)

# Fetch AWS RDS connection details from environment variables.
hostname = os.getenv("DB_HOST")
port = os.getenv("DB_PORT")
username = os.getenv("DB_USER")
password = os.getenv("DB_PASSWORD")
database = os.getenv("DB_NAME")

ALLOWED_DEPARTMENTS = frozenset({"CSE", "IT", "ECE", "EE", "ME", "CE"})
STUDENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9/-]{2,49}$")

USER_SELECT_COLUMNS = """
    id, email, name, google_name, preferred_name, department, urn, crn,
    semester_no, profile_completed, is_banned, banned_at, created_at, updated_at
"""
USER_RESULT_COLUMNS = (
    "id", "email", "name", "google_name", "preferred_name", "department",
    "urn", "crn", "semester_no", "profile_completed", "is_banned",
    "banned_at", "created_at", "updated_at",
)


def get_connection():
    """Return a new connection to the configured PostgreSQL database."""
    try:
        return psycopg2.connect(
            host=hostname,
            port=port,
            user=username,
            password=password,
            dbname=database,
        )
    except Exception:
        logger.exception("Could not connect to the database")
        return None


def check_connection():
    """Verify the database connection and return whether it is available."""
    conn = get_connection()
    if not conn:
        logger.error("Database connection check failed")
        return False

    conn.close()
    logger.info("Database connection check succeeded")
    return True


def create_tables():
    """Create and migration-safely extend the application's tables."""
    conn = get_connection()
    if not conn:
        return False

    cur = None
    try:
        cur = conn.cursor()
        # Keep the legacy `name` column during migration. It historically stored
        # the Google profile name, while preferred_name is the student-entered
        # display name used after onboarding.
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                name VARCHAR(255),
                google_name VARCHAR(255),
                preferred_name VARCHAR(255),
                department VARCHAR(100),
                urn VARCHAR(50),
                crn VARCHAR(50),
                semester_no INTEGER,
                profile_completed BOOLEAN NOT NULL DEFAULT FALSE,
                is_banned BOOLEAN NOT NULL DEFAULT FALSE,
                banned_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );

            ALTER TABLE users ADD COLUMN IF NOT EXISTS google_name VARCHAR(255);
            ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_name VARCHAR(255);
            ALTER TABLE users ADD COLUMN IF NOT EXISTS crn VARCHAR(50);
            ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN NOT NULL DEFAULT FALSE;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

            UPDATE users
               SET google_name = COALESCE(NULLIF(google_name, ''), NULLIF(name, ''), split_part(email, '@', 1)),
                   profile_completed = COALESCE(profile_completed, FALSE),
                   is_banned = COALESCE(is_banned, FALSE),
                   updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
             WHERE google_name IS NULL
                OR google_name = ''
                OR profile_completed IS NULL
                OR is_banned IS NULL
                OR updated_at IS NULL;

            CREATE INDEX IF NOT EXISTS idx_users_preferred_name_lower
                ON users (LOWER(preferred_name));
            CREATE INDEX IF NOT EXISTS idx_users_google_name_lower
                ON users (LOWER(google_name));
            """
        )
        conn.commit()
        logger.info("User table created or migrated successfully")
    except Exception:
        conn.rollback()
        logger.exception("Could not create or migrate the users table")
        return False
    finally:
        if cur:
            cur.close()
        conn.close()

    # db_agent owns the resources schema and manages its own connection.
    create_resources_table()
    return True


def _normalize_email(email):
    normalized = str(email or "").strip().casefold()
    if not normalized or len(normalized) > 255 or "@" not in normalized:
        raise ValueError("A valid email address is required.")
    return normalized


def _normalize_name(value, field_label, maximum=255):
    normalized = " ".join(str(value or "").split())
    if len(normalized) < 2 or len(normalized) > maximum:
        raise ValueError(f"{field_label} must be between 2 and {maximum} characters.")
    if any(character.isdigit() or ord(character) < 32 for character in normalized):
        raise ValueError(f"{field_label} contains invalid characters.")
    return normalized


def _normalize_google_name(value, email):
    normalized = " ".join(str(value or "").split()) or email.split("@", 1)[0]
    if len(normalized) > 255 or any(ord(character) < 32 for character in normalized):
        normalized = email.split("@", 1)[0][:255]
    return normalized


def _normalize_student_id(value, field_label):
    normalized = str(value or "").strip().upper()
    if not STUDENT_ID_PATTERN.fullmatch(normalized):
        raise ValueError(
            f"{field_label} must be 3-50 letters or numbers (hyphens and slashes are allowed)."
        )
    return normalized


def _user_from_row(row):
    """Convert a known users SELECT/RETURNING tuple into a template-safe dict."""
    if not row:
        return None

    user = dict(zip(USER_RESULT_COLUMNS, row))
    user["profile_completed"] = bool(user.get("profile_completed"))
    user["is_banned"] = bool(user.get("is_banned"))
    user["display_name"] = (
        user.get("preferred_name")
        or user.get("google_name")
        or user.get("name")
        or user["email"].split("@", 1)[0]
    )
    return user


def add_or_update_user(email, name, department=None, urn=None, semester_no=None, crn=None):
    """Upsert the Google identity without erasing an existing student profile.

    Optional academic arguments are retained for compatibility with older callers,
    but OAuth calls that omit them leave all previously submitted details intact.
    """
    try:
        normalized_email = _normalize_email(email)
        google_name = _normalize_google_name(name, normalized_email)
    except ValueError as error:
        logger.warning("Rejected invalid OAuth user data: %s", error)
        return False

    conn = get_connection()
    if not conn:
        return False

    cur = None
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO users (
                email, name, google_name, department, urn, crn, semester_no
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (email) DO UPDATE
            SET name = EXCLUDED.name,
                google_name = EXCLUDED.google_name,
                department = COALESCE(EXCLUDED.department, users.department),
                urn = COALESCE(EXCLUDED.urn, users.urn),
                crn = COALESCE(EXCLUDED.crn, users.crn),
                semester_no = COALESCE(EXCLUDED.semester_no, users.semester_no),
                updated_at = CURRENT_TIMESTAMP;
            """,
            (
                normalized_email, google_name, google_name, department, urn,
                crn, semester_no,
            ),
        )
        conn.commit()
        logger.info("Upserted Google identity for %s", normalized_email)
        return True
    except Exception:
        conn.rollback()
        logger.exception("Could not upsert Google identity for %s", normalized_email)
        return False
    finally:
        if cur:
            cur.close()
        conn.close()


def get_user_by_email(email):
    """Return one user profile, or None when it is absent/unavailable."""
    try:
        normalized_email = _normalize_email(email)
    except ValueError:
        return None

    conn = get_connection()
    if not conn:
        return None

    cur = None
    try:
        cur = conn.cursor()
        cur.execute(
            f"SELECT {USER_SELECT_COLUMNS} FROM users WHERE email = %s LIMIT 1;",
            (normalized_email,),
        )
        return _user_from_row(cur.fetchone())
    except Exception:
        logger.exception("Could not load user profile for %s", normalized_email)
        return None
    finally:
        if cur:
            cur.close()
        conn.close()


def update_user_profile(email, preferred_name, department, urn, crn, semester_no):
    """Validate and persist a student's required onboarding details.

    Returns the updated user dict, None when no such account exists, and raises
    ValueError for user-correctable validation errors.
    """
    normalized_email = _normalize_email(email)
    normalized_name = _normalize_name(preferred_name, "Full name")
    normalized_department = str(department or "").strip().upper()
    if normalized_department not in ALLOWED_DEPARTMENTS:
        raise ValueError("Please select a valid department.")

    normalized_urn = _normalize_student_id(urn, "URN")
    normalized_crn = _normalize_student_id(crn, "CRN")
    try:
        normalized_semester = int(semester_no)
    except (TypeError, ValueError) as error:
        raise ValueError("Semester must be a number from 1 to 8.") from error
    if normalized_semester not in range(1, 9):
        raise ValueError("Semester must be a number from 1 to 8.")

    conn = get_connection()
    if not conn:
        return None

    cur = None
    try:
        cur = conn.cursor()
        cur.execute(
            f"""
            UPDATE users
               SET preferred_name = %s,
                   department = %s,
                   urn = %s,
                   crn = %s,
                   semester_no = %s,
                   profile_completed = TRUE,
                   updated_at = CURRENT_TIMESTAMP
             WHERE email = %s
             RETURNING {USER_SELECT_COLUMNS};
            """,
            (
                normalized_name, normalized_department, normalized_urn,
                normalized_crn, normalized_semester, normalized_email,
            ),
        )
        updated_user = _user_from_row(cur.fetchone())
        if not updated_user:
            conn.rollback()
            return None
        conn.commit()
        logger.info("Completed student profile for %s", normalized_email)
        return updated_user
    except Exception:
        conn.rollback()
        logger.exception("Could not update user profile for %s", normalized_email)
        return None
    finally:
        if cur:
            cur.close()
        conn.close()
