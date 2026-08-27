import os
from flask import Flask, render_template, redirect, url_for, session, request
from database import check_connection, create_tables, add_or_update_user
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = "super_secret_bookshelf_dev_key"

# Verify database connection and initialize tables on startup
check_connection()
create_tables()

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/login')
def login():
    return render_template('login.html')

# ==========================================
# DUMMY LOGIN FOR FRONTEND TESTING
# Your backend friend can add the real OAuth back here later!
# ==========================================
@app.route('/auth/google')
def auth_google():
    # Instantly log in as a test user to bypass the wall
    session['user'] = {'email': 'test@developer.com', 'name': 'Frontend Tester'}
    add_or_update_user('test@developer.com', 'Frontend Tester')
    return redirect(url_for('dashboard'))

@app.route('/dashboard')
def dashboard():
    user = session.get('user')
    if not user:
        return redirect(url_for('login'))
    return render_template('dashboard.html', user=user)

@app.route('/logout')
def logout():
    session.pop('user', None)
    return redirect(url_for('home'))

@app.route('/admin') 
def admin_panel():
    return render_template('admin.html')

@app.route('/admin-verify', methods=['POST'])
def admin_verify():
    entered_password = request.form.get('master_key')
    secret_password = "bookshelf" 

    if entered_password == secret_password:
        session['is_admin'] = True 
        return redirect(url_for('admin_dashboard'))
    else:
        return redirect(url_for('admin_panel'))

@app.route('/admin-dashboard')
def admin_dashboard():
    if not session.get('is_admin'):
        return redirect(url_for('admin_panel'))
    return render_template('admin-dashboard.html')

@app.route('/pyqs')
def pyqs():
    return render_template('pyqs.html')

@app.route('/contribute')
def contribute():
    return render_template('contribute.html')

if __name__ == '__main__':
    app.run(debug=True, port=8000)