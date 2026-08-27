import os
from flask import Flask, render_template, redirect, url_for, session, request, flash, jsonify
from authlib.integrations.flask_client import OAuth
from database import check_connection, create_tables, add_or_update_user
from storage_agent import upload_file, delete_file
from db_agent import (
    add_resource, get_resources, get_resource_by_id,
    update_resource_status, delete_resource, get_resource_stats
)
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

# ─────────────────────────────────────────────
# PUBLIC ROUTES
# ─────────────────────────────────────────────

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
    session.pop('is_admin', None)
    return redirect(url_for('home'))

# ─────────────────────────────────────────────
# ADMIN ROUTES
# ─────────────────────────────────────────────

@app.route('/admin') 
def admin_panel():
    return render_template('admin.html')

@app.route('/admin-verify', methods=['POST'])
def admin_verify():
    entered_password = request.form.get('master_key')

    # our highly secure password
    secret_password = "bookshelf" 

    if entered_password == secret_password:
        session['is_admin'] = True
        return redirect(url_for('admin_dashboard'))
    else:
        flash("Invalid master key.", "error")
        return redirect(url_for('admin_panel'))

@app.route('/admin-dashboard')
def admin_dashboard():
    if not session.get('is_admin'):
        return redirect(url_for('admin_panel'))
    
    # Fetch all resources and stats for the dashboard
    resources = get_resources()
    stats = get_resource_stats()
    return render_template('admin-dashboard.html', resources=resources, stats=stats)


# ─────────────────────────────────────────────
# UPLOAD ROUTE (Agent 1 + Agent 2 working together)
# ─────────────────────────────────────────────

@app.route('/upload', methods=['POST'])
def upload():
    """
    Receives the admin upload form.
    1. Agent 1 (storage_agent) uploads the file to Azure Blob Storage.
    2. Agent 2 (db_agent) saves the metadata + blob_url to PostgreSQL.
    """
    if not session.get('is_admin'):
        return redirect(url_for('admin_panel'))

    # Extract form data
    category = request.form.get('category')
    branch = request.form.get('branch')
    semester = request.form.get('semester')
    title = request.form.get('title')
    subject_name = request.form.get('subject_name', '').strip() or None
    file = request.files.get('file_upload')

    if not all([category, branch, semester, title, file]):
        flash("All required fields must be filled.", "error")
        return redirect(url_for('admin_dashboard'))

    if file.filename == '':
        flash("No file selected.", "error")
        return redirect(url_for('admin_dashboard'))

    # ── AGENT 1: Upload to Azure Blob Storage ──
    original_filename = file.filename
    
    # Get file size by reading content
    file_data = file.read()
    file_size = len(file_data)
    
    # Reset stream for upload
    from io import BytesIO
    file_stream = BytesIO(file_data)

    upload_result = upload_file(file_stream, original_filename, category)

    if not upload_result:
        flash("Failed to upload file to cloud storage. Please try again.", "error")
        return redirect(url_for('admin_dashboard'))

    blob_url = upload_result["blob_url"]

    # ── AGENT 2: Save metadata to PostgreSQL ──
    resource_id = add_resource(
        title=title,
        category=category,
        branch=branch,
        semester=semester,
        blob_url=blob_url,
        file_name=original_filename,
        file_size=file_size,
        status="verified",       # Admin uploads are verified by default
        uploaded_by="admin",
        subject_name=subject_name,
    )

    if not resource_id:
        flash("File uploaded to cloud but failed to save to database.", "error")
        return redirect(url_for('admin_dashboard'))

    flash(f"'{title}' uploaded successfully!", "success")
    return redirect(url_for('admin_dashboard'))


# ─────────────────────────────────────────────
# ADMIN MANAGEMENT ROUTES
# ─────────────────────────────────────────────

@app.route('/admin/toggle-status/<int:resource_id>', methods=['POST'])
def toggle_status(resource_id):
    """Toggles a resource between verified and unverified."""
    if not session.get('is_admin'):
        return redirect(url_for('admin_panel'))

    resource = get_resource_by_id(resource_id)
    if not resource:
        flash("Resource not found.", "error")
        return redirect(url_for('admin_dashboard'))

    new_status = "unverified" if resource["status"] == "verified" else "verified"
    update_resource_status(resource_id, new_status)

    flash(f"Status updated to '{new_status}'.", "success")
    return redirect(url_for('admin_dashboard'))


@app.route('/admin/delete/<int:resource_id>', methods=['POST'])
def admin_delete(resource_id):
    """Deletes a resource from both Azure Storage and the database."""
    if not session.get('is_admin'):
        return redirect(url_for('admin_panel'))

    # Agent 2: Delete from DB and get the blob_url
    blob_url = delete_resource(resource_id)

    if blob_url:
        # Agent 1: Delete from Azure Blob Storage
        delete_file(blob_url)
        flash("Resource deleted successfully.", "success")
    else:
        flash("Failed to delete resource.", "error")

    return redirect(url_for('admin_dashboard'))


# ─────────────────────────────────────────────
# API ROUTES (for student dashboard consumption)
# ─────────────────────────────────────────────

@app.route('/api/resources')
def api_resources():
    """
    Returns filtered resources as JSON.
    Query params: category, branch, semester, status
    Only returns verified resources to students.
    """
    category = request.args.get('category')
    branch = request.args.get('branch')
    semester = request.args.get('semester')

    # Students only see verified resources
    resources = get_resources(
        category=category,
        branch=branch,
        semester=semester,
        status="verified"
    )

    return jsonify(resources)


if __name__ == '__main__':
    app.run(debug=True, port=8000)