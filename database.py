#import os
#import psycopg
#from flask import g
#from dotenv import load_dotenv

#load_dotenv()
#conn = psycopg.connect{
#    host= os.getenv('DB_HOST')
#}

import os
try:
    import psycopg2 as psycopg
except ImportError:
    import psycopg

from flask import g
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Database credentials
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_password") or os.getenv("DB_PASSWORD")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "test")

def get_db_connection():
    """Establishes and returns a database connection."""
    conn = psycopg.connect(
        user=DB_USER,
        password=DB_PASSWORD,
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME
    )
    return conn

def get_db():
    """Returns the database connection stored in Flask's g object for the current request context."""
    if 'db' not in g:
        g.db = get_db_connection()
    return g.db

def close_db(e=None):
    """Closes the database connection stored in Flask's g object."""
    db = g.pop('db', None)
    if db is not None:
        db.close()

def check_connection():
    """Verifies database connection on application startup."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT version();")
        db_version = cur.fetchone()
        print(f" Successfully connected to the database. Version: {db_version[0]}")
        cur.close()
        conn.close()
        return True
    except Exception as e:
        print(f" Database connection failed: {e}")
        return False