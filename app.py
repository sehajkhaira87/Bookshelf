import os
my-design-updates
from flask import Flask, render_template, request, redirect, url_for
from database import check_connection, create_tables
from flask import Flask, render_template, redirect, url_for, session
from authlib.integrations.flask_client import OAuth
from database import check_connection, create_tables, add_or_update_user
from dotenv import load_dotenv

load_dotenv()
 main

app = Flask(__name__)
app.secret_key = os.getenv("flash_secret")

# Google OAuth setup
oauth = OAuth(app)
google = oauth.register(
    name='google',
    client_id=os.getenv("google_Client_ID"),
    client_secret=os.getenv("google_Client_Secret"),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'},
)

# Verify database connection and initialize tables on startup
check_connection()
create_tables()

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/login')
def login():
    return render_template('login.html')

@app.route('/login/google')
def login_google():
    """Redirects user to Google's consent screen."""
    redirect_uri = url_for('authorize', _external=True)
    return google.authorize_redirect(redirect_uri)

@app.route('/authorize')
def authorize():
    """Callback from Google — fetches profile, saves to DB, sets session."""
    token = google.authorize_access_token()
    user_info = token.get('userinfo')

    email = user_info.get('email')
    name = user_info.get('name')

    # Save user to database
    add_or_update_user(email=email, name=name)

    # Store in session
    session['user'] = {
        'email': email,
        'name': name,
        'picture': user_info.get('picture'),
    }

    return redirect(url_for('dashboard'))

@app.route('/dashboard')
def dashboard():
    user = session.get('user')
    if not user:
        return redirect(url_for('login'))
    return render_template('dashboard.html', user=user)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('home'))

 my-design-updates
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

if __name__ == "__main__":
    app.run(debug=True, port=8000)
 main
