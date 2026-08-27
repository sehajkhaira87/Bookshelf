import os
import psycopg2
from dotenv import load_dotenv
import os
from db_agent import create_resources_table

load_dotenv()

# Fetch AWS RDS credentials
hostname = os.getenv("DB_HOST")
port = os.getenv("DB_PORT")
username = os.getenv("DB_USER")
password = os.getenv("DB_PASSWORD")
database = os.getenv("DB_NAME")

def get_connection():
    """Returns a new connection to the AWS Postgres database."""
    #try:
        #conn = psycopg2.connect(
            #host=hostname,
           # port=port,
            #user=username,
            #password=password,
            #dbname=database
       # )
        #return conn
    #except Exception as e:
        #print("Error while connecting to database:", e)
    return None

def check_connection():
    """Verifies the database connection."""
    conn = get_connection()
    if conn:
        print("Successfully connected to the AWS RDS database!")
        conn.close()
    else:
        print("Failed to connect to the database.")

def create_tables():
    """Creates the necessary tables if they do not exist."""
    conn = get_connection()
    if not conn:
        return
    
    try:
        cur = conn.cursor()
        
        create_user_table_query = """
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            name VARCHAR(255),
            department VARCHAR(100),
            urn VARCHAR(50),
            semester_no INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        
        cur.execute(create_user_table_query)
        conn.commit()
        print("Tables created successfully (or already exist).")

        # Also create the resources table via db_agent
        create_resources_table()
        
    except Exception as e:
        print("Error creating tables:", e)
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

def add_or_update_user(email, name, department=None, urn=None, semester_no=None):
    """
    Inserts a new user or updates an existing one based on their email.
    """
    conn = get_connection()
    if not conn:
        return False
        
    try:
        cur = conn.cursor()
        
        insert_query = """
        INSERT INTO users (email, name, department, urn, semester_no) 
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (email) DO UPDATE 
        SET name = EXCLUDED.name,
            department = EXCLUDED.department,
            urn = EXCLUDED.urn,
            semester_no = EXCLUDED.semester_no;
        """
        
        cur.execute(insert_query, (email, name, department, urn, semester_no))
        conn.commit()
        print(f"User {email} added/updated successfully.")
        return True
        
    except Exception as e:
        print("Error inserting/updating user:", e)
        return False
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()