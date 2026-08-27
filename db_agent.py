"""
AGENT 2 — Database Agent
Handles all resource metadata operations in PostgreSQL:
create table, add/get/update/delete resources.
"""

import psycopg2 as p
from dotenv import load_dotenv
import os

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
            dbname=database
        )
        return conn
    except Exception as e:
        print(f"[DBAgent] Error connecting to database: {e}")
        return None


def create_resources_table():
    """Creates the resources table if it does not exist."""
    conn = get_connection()
    if not conn:
        return

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
            uploaded_by VARCHAR(100) DEFAULT 'admin',
            subject_name VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """

        cur.execute(create_table_query)
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

        query = "SELECT id, title, category, branch, semester, blob_url, file_name, file_size, status, uploaded_by, subject_name, created_at FROM resources WHERE 1=1"
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
            "SELECT id, title, category, branch, semester, blob_url, file_name, file_size, status, uploaded_by, subject_name, created_at FROM resources WHERE id = %s",
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
            "UPDATE resources SET status = %s WHERE id = %s",
            (new_status, resource_id)
        )
        conn.commit()
        print(f"[DBAgent] Resource {resource_id} status updated to '{new_status}'.")
        return True

    except Exception as e:
        print(f"[DBAgent] Error updating status: {e}")
        return False
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def delete_resource(resource_id):
    """
    Deletes a resource record from the database.

    Returns:
        The blob_url of the deleted resource (for cleanup), or None on failure.
    """
    conn = get_connection()
    if not conn:
        return None

    try:
        cur = conn.cursor()

        # First get the blob_url so we can delete from Azure too
        cur.execute("SELECT blob_url FROM resources WHERE id = %s", (resource_id,))
        row = cur.fetchone()
        if not row:
            print(f"[DBAgent] Resource {resource_id} not found.")
            return None

        blob_url = row[0]

        # Delete the record
        cur.execute("DELETE FROM resources WHERE id = %s", (resource_id,))
        conn.commit()
        print(f"[DBAgent] Resource {resource_id} deleted from database.")
        return blob_url

    except Exception as e:
        print(f"[DBAgent] Error deleting resource: {e}")
        return None
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

        cur.execute("SELECT COUNT(*) FROM resources")
        total = cur.fetchone()[0]

        cur.execute("SELECT category, COUNT(*) FROM resources GROUP BY category")
        by_category = dict(cur.fetchall())

        cur.execute("SELECT status, COUNT(*) FROM resources GROUP BY status")
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
