import os
from flask import Flask, render_template, request, redirect, url_for
from database import check_connection, create_tables

app = Flask(__name__)

# Verify database connection and initialize tables on startup
check_connection()
create_tables()

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/login')
def login():
    return render_template('login.html')

@app.route('/dashboard')
def dashboard():
    return render_template('dashboard.html', user={'name': 'Sehajpreet'})

@app.route('/admin') 
def admin_panel():
    return render_template('admin.html')

@app.route('/admin-verify', methods=['POST'])
def admin_verify():
    entered_password = request.form.get('master_key')

    # our highly secure password
    secret_password = "bookshelf" 

    if entered_password == secret_password:
        return redirect(url_for('admin_dashboard'))
    else:
        return redirect(url_for('admin_panel'))

@app.route('/admin-dashboard')
def admin_dashboard():
    # This tells Python to load your new front-end file!
    return render_template('admin-dashboard.html')

if __name__ == '__main__':
    app.run(debug=True, port=8000)