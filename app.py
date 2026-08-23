import os
from flask import Flask, render_template, redirect, url_for, session, request
from authlib.integrations.flask_client import OAuth
from database import check_connection, create_tables, add_or_update_user
from werkzeug.middleware.proxy_fix import ProxyFix
from dotenv import load_dotenv
load_dotenv()

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
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

@app.route('/auth/google')
def auth_google():
    redirect_uri = url_for('callback', _external=True)
    return google.authorize_redirect(redirect_uri)

@app.route('/callback')
def callback():
    token = google.authorize_access_token()
    user_info = token.get('userinfo')
    if user_info:
        email = user_info.get('email')
        name = user_info.get('name')
        session['user'] = {'email': email, 'name': name}
        add_or_update_user(email, name)
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

if __name__ == '__main__':
    app.run(debug=True, port=8000)