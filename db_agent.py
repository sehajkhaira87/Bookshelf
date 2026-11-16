"""
AGENT 2 — Database Agent
Handles all resource metadata operations in PostgreSQL:
create table, add/get/update/delete resources.
"""

import psycopg2 as p
from dotenv import load_dotenv
import os
from psycopg2.extras import RealDictCursor

load_dotenv()

hostname = os.getenv("DB_HOST")
port = os.getenv("DB_PORT")
username = os.getenv("DB_USER")
password = os.getenv("DB_PASSWORD")
database = os.getenv("DB_NAME")


def get_connection():
    """Returns a new connection to the database."""
    try:
        conn = p.connect(
            host=hostname,
            port=port,
            user=username,
            password=password,
            dbname=database,
            connect_timeout=5,
        )
        return conn
    except Exception as e:
        print(f"[DBAgent] Error connecting to database: {e}")
        return None


def get_resource_catalogue(category, branch=None, semester=None, search='', page=1):
    """Read a fresh, paginated student catalogue from verified uploads."""
    if category not in {'notes', 'assignment', 'book', 'mst'}:
        raise ValueError('Invalid resource category.')
    where = ['category = %s', 'status = %s', 'removed_at IS NULL']
    params = [category, 'verified']
    if branch:
        where.append('branch = %s')
        params.append(branch)
    if semester:
        where.append('semester = %s')
        params.append(int(semester))
    if search:
        term = '%' + search.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        where.append('(title ILIKE %s OR subject_name ILIKE %s)')
        params.extend([term, term])
    clause = ' WHERE ' + ' AND '.join(where)
    conn = get_connection()
    if conn is None:
        raise RuntimeError('The resource library is unavailable.')
    try:
        with conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute('SELECT COUNT(*) AS total FROM resources' + clause, params)
            total = cur.fetchone()['total']
            cur.execute('''SELECT id, title, category, branch, semester, subject_name,
                blob_url, file_name, file_size, created_at, uploaded_by,
                (SELECT COALESCE(NULLIF(BTRIM(u.preferred_name), ''),
                                 NULLIF(BTRIM(u.google_name), ''),
                                 NULLIF(BTRIM(u.name), ''))
                 FROM users u
                 WHERE LOWER(BTRIM(u.email)) = LOWER(BTRIM(resources.uploaded_by))
                 ORDER BY u.id LIMIT 1) AS contributor_name,
                (SELECT u.contributor_badge FROM users u
                 WHERE LOWER(BTRIM(u.email)) = LOWER(BTRIM(resources.uploaded_by))
                   AND u.is_banned=FALSE
                 ORDER BY u.id LIMIT 1) AS contributor_badge
                FROM resources''' + clause +
                ' ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET %s',
                [*params, (page - 1) * 50])
            return [dict(row) for row in cur.fetchall()], total
    finally:
        conn.close()


def create_resources_table():
    """Create the resource catalogue and migrate contribution history fields."""
    conn = get_connection()
    if not conn:
        return

    cur = None
    try:
        cur = conn.cursor()

        create_table_query = """
        CREATE TABLE IF NOT EXISTS resources (
            id SERIAL PRIMARY KEY,
            title VARCHAR(500) NOT NULL,
            category VARCHAR(50) NOT NULL,
            branch VARCHAR(50) NOT NULL,
            semester INTEGER NOT NULL,
            blob_url TEXT NOT NULL,
            file_name VARCHAR(500),
            file_size BIGINT,
            status VARCHAR(20) DEFAULT 'verified',
            uploaded_by VARCHAR(255) DEFAULT 'admin',
            subject_name VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """

        cur.execute(create_table_query)
        cur.execute("""
            DO $$ BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema() AND table_name = 'resources'
                      AND column_name = 'uploaded_by' AND character_maximum_length < 255
                ) THEN
                    ALTER TABLE resources ALTER COLUMN uploaded_by TYPE VARCHAR(255);
                END IF;
            END $$;
            ALTER TABLE resources
                ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS removal_requested_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS removal_reason VARCHAR(1000),
                ADD COLUMN IF NOT EXISTS removal_declined_at TIMESTAMPTZ;
            CREATE INDEX IF NOT EXISTS idx_resources_contribution_history
                ON resources (LOWER(BTRIM(uploaded_by)), created_at, id);
            CREATE INDEX IF NOT EXISTS idx_resources_pending_removal
                ON resources (removal_requested_at, id)
                WHERE removed_at IS NULL AND removal_declined_at IS NULL
                  AND removal_requested_at IS NOT NULL;
        """)
        conn.commit()
        print("[DBAgent] Resources table created successfully (or already exists).")

    except Exception as e:
        print(f"[DBAgent] Error creating resources table: {e}")
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def add_resource(title, category, branch, semester, blob_url,
                 file_name=None, file_size=None, status="verified",
                 uploaded_by="admin", subject_name=None):
    """
    Inserts a new resource record into the database.

    Returns:
        The new resource ID on success, None on failure.
    """
    conn = get_connection()
    if not conn:
        return None

    try:
        cur = conn.cursor()

        insert_query = """
        INSERT INTO resources 
            (title, category, branch, semester, blob_url, 
             file_name, file_size, status, uploaded_by, subject_name)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id;
        """

        cur.execute(insert_query, (
            title, category, branch, int(semester), blob_url,
            file_name, file_size, status, uploaded_by, subject_name
        ))

        resource_id = cur.fetchone()[0]
        conn.commit()
        print(f"[DBAgent] Resource '{title}' added with ID {resource_id}.")
        return resource_id

    except Exception as e:
        print(f"[DBAgent] Error adding resource: {e}")
        return None
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def get_resources(category=None, branch=None, semester=None, status=None):
    """
    Fetches resources with optional filters.

    Returns:
        List of resource dicts, or empty list on failure.
    """
    conn = get_connection()
    if not conn:
        return []

    try:
        cur = conn.cursor()

        query = "SELECT id, title, category, branch, semester, blob_url, file_name, file_size, status, uploaded_by, subject_name, created_at FROM resources WHERE removed_at IS NULL"
        params = []

        if category:
            query += " AND category = %s"
            params.append(category)
        if branch:
            query += " AND branch = %s"
            params.append(branch)
        if semester:
            query += " AND semester = %s"
            params.append(int(semester))
        if status:
            query += " AND status = %s"
            params.append(status)

        query += " ORDER BY created_at DESC"

        cur.execute(query, params)
        rows = cur.fetchall()

        resources = []
        for row in rows:
            resources.append({
                "id": row[0],
                "title": row[1],
                "category": row[2],
                "branch": row[3],
                "semester": row[4],
                "blob_url": row[5],
                "file_name": row[6],
                "file_size": row[7],
                "status": row[8],
                "uploaded_by": row[9],
                "subject_name": row[10],
                "created_at": str(row[11]) if row[11] else None,
            })

        return resources

    except Exception as e:
        print(f"[DBAgent] Error fetching resources: {e}")
        return []
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def get_resource_by_id(resource_id):
    """
    Fetches a single resource by its ID.

    Returns:
        Resource dict or None.
    """
    conn = get_connection()
    if not conn:
        return None

    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, title, category, branch, semester, blob_url, file_name, file_size, status, uploaded_by, subject_name, created_at FROM resources WHERE id = %s AND removed_at IS NULL",
            (resource_id,)
        )
        row = cur.fetchone()

        if not row:
            return None

        return {
            "id": row[0],
            "title": row[1],
            "category": row[2],
            "branch": row[3],
            "semester": row[4],
            "blob_url": row[5],
            "file_name": row[6],
            "file_size": row[7],
            "status": row[8],
            "uploaded_by": row[9],
            "subject_name": row[10],
            "created_at": str(row[11]) if row[11] else None,
        }

    except Exception as e:
        print(f"[DBAgent] Error fetching resource {resource_id}: {e}")
        return None
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def update_resource_status(resource_id, new_status):
    """
    Updates the status of a resource ('verified' or 'unverified').

    Returns:
        True on success, False on failure.
    """
    if new_status not in ("verified", "unverified"):
        print(f"[DBAgent] Invalid status: {new_status}")
        return False

    conn = get_connection()
    if not conn:
        return False

    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE resources SET status = %s WHERE id = %s AND removed_at IS NULL",
            (new_status, resource_id)
        )
        changed = cur.rowcount == 1
        conn.commit()
        print(f"[DBAgent] Resource {resource_id} status updated to '{new_status}'.")
        return changed

    except Exception as e:
        print(f"[DBAgent] Error updating status: {e}")
        return False
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def get_resource_stats():
    """
    Returns aggregate stats for the admin dashboard.

    Returns:
        Dict with total counts by category and status.
    """
    conn = get_connection()
    if not conn:
        return {}

    try:
        cur = conn.cursor()

        cur.execute("SELECT COUNT(*) FROM resources WHERE removed_at IS NULL")
        total = cur.fetchone()[0]

        cur.execute("SELECT category, COUNT(*) FROM resources WHERE removed_at IS NULL GROUP BY category")
        by_category = dict(cur.fetchall())

        cur.execute("SELECT status, COUNT(*) FROM resources WHERE removed_at IS NULL GROUP BY status")
        by_status = dict(cur.fetchall())

        return {
            "total": total,
            "by_category": by_category,
            "by_status": by_status,
        }

    except Exception as e:
        print(f"[DBAgent] Error fetching stats: {e}")
        return {}
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()
