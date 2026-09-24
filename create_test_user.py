from database import get_connection, create_tables
from werkzeug.security import generate_password_hash

def force_password():
    create_tables()
    conn = get_connection()
    cur = conn.cursor()
    
    crn = "2415262"
    password = "admin"
    hashed_pw = generate_password_hash(password)
    
    cur.execute("UPDATE users SET password_hash = %s WHERE crn = %s", (hashed_pw, crn))
    
    if cur.rowcount == 0:
        email = "sehajpreet@bookshelf.dev"
        cur.execute("""
            INSERT INTO users (email, name, preferred_name, urn, crn, password_hash, profile_completed)
            VALUES (%s, 'Sehajpreet Singh', 'Sehajpreet', '2435163', %s, %s, TRUE)
        """, (email, crn, hashed_pw))
        
    conn.commit()
    cur.close()
    conn.close()
    print("FORCE OVERRIDE SUCCESSFUL! Password 'admin' is now locked to CRN '2415262'.")

if __name__ == "__main__":
    force_password()