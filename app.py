import os
import secrets
import zipfile
from collections.abc import Mapping
from functools import wraps
from pathlib import Path

from flask import (
    Flask, abort, flash, jsonify, redirect, render_template,
    request, session, url_for,
)
from authlib.integrations.flask_client import OAuth
from database import (
    add_or_update_user,
    check_connection,
    create_tables,
    get_user_by_email,
    update_user_profile,
)
from admin_user_service import (
    AdminUserServiceError,
    AdminUserValidationError,
    ban_user,
    create_admin_user_schema,
    create_warning,
    delete_warning,
    list_warnings,
    list_warnings_for_users,
    search_users,
    unban_user,
)
from storage_agent import upload_file, delete_file
from db_agent import (
    add_resource, get_resources, get_resource_by_id,
    update_resource_status, delete_resource, get_resource_stats
)
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

load_dotenv()


def normalize_email(value):
    """Normalize an email address before authentication/authorization checks."""
    return str(value or "").strip().casefold()


ADMIN_EMAILS = frozenset(
    email
    for email in (normalize_email(value) for value in os.getenv("Emails", "").split(","))
    if email
)
if not ADMIN_EMAILS:
    raise RuntimeError("The Emails environment variable must list at least one administrator.")

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + (1024 * 1024)
ALLOWED_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".ppt", ".pptx",
    ".png", ".jpg", ".jpeg", ".webp",
}
ALLOWED_CATEGORIES = {"pyq", "assignment", "book", "notes"}
ALLOWED_BRANCHES = {"cse", "it", "ece", "ee", "me", "ce"}
ALLOWED_SEMESTERS = {str(value) for value in range(1, 9)}


def file_content_matches_extension(file_stream, extension):
    """Validate common document/image signatures instead of trusting the name."""
    file_stream.seek(0)
    header = file_stream.read(1024)
    file_stream.seek(0)

    if extension == '.pdf':
        return b'%PDF-' in header
    if extension in {'.jpg', '.jpeg'}:
        return header.startswith(b'\xff\xd8\xff')
    if extension == '.png':
        return header.startswith(b'\x89PNG\r\n\x1a\n')
    if extension == '.webp':
        return header.startswith(b'RIFF') and header[8:12] == b'WEBP'
    if extension in {'.doc', '.ppt'}:
        return header.startswith(b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1')
    if extension in {'.docx', '.pptx'}:
        expected_folder = 'word/' if extension == '.docx' else 'ppt/'
        try:
            with zipfile.ZipFile(file_stream) as office_file:
                names = set(office_file.namelist())
                return (
                    '[Content_Types].xml' in names
                    and any(name.startswith(expected_folder) for name in names)
                )
        except (OSError, zipfile.BadZipFile):
            return False
        finally:
            file_stream.seek(0)

    return False

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

secret_key = os.getenv("flash_secret")
if not secret_key:
    raise RuntimeError("The flash_secret environment variable must be configured.")

app.config.update(
    SECRET_KEY=secret_key,
    MAX_CONTENT_LENGTH=MAX_REQUEST_BYTES,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)

# Google OAuth setup
google_client_id = os.getenv("google_Client_ID")
google_client_secret = os.getenv("google_Client_Secret")
if not google_client_id or not google_client_secret:
    raise RuntimeError("Google OAuth client ID and secret must be configured.")

oauth = OAuth(app)
google = oauth.register(
    name='google',
    client_id=google_client_id,
    client_secret=google_client_secret,
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'},
)

# Verify database connection and initialize tables on startup
check_connection()
if create_tables():
    try:
        create_admin_user_schema()
    except AdminUserServiceError:
        app.logger.exception("Could not initialize user moderation tables")

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
    intent = request.args.get('role', 'student').strip().lower()
    if intent not in {'student', 'admin'}:
        intent = 'student'

    # Rotate all session state before starting a fresh OAuth login.
    session.clear()
    session['oauth_intent'] = intent

    redirect_uri = url_for('callback', _external=True)
    authorization_options = {'prompt': 'select_account'} if intent == 'admin' else {}
    try:
        return google.authorize_redirect(redirect_uri, **authorization_options)
    except Exception:
        session.pop('oauth_intent', None)
        app.logger.exception("Google OAuth authorization could not be started")
        flash("Google sign-in is temporarily unavailable. Please try again.", "error")
        endpoint = 'admin_panel' if intent == 'admin' else 'login'
        return redirect(url_for(endpoint))

@app.route('/callback')
def callback():
    intent = session.pop('oauth_intent', 'student')
    failure_endpoint = 'admin_panel' if intent == 'admin' else 'login'
    session.pop('user', None)
    session.pop('admin_user', None)
    session.pop('is_admin', None)

    try:
        token = google.authorize_access_token()
        user_info = token.get('userinfo') if isinstance(token, Mapping) else None
    except Exception:
        app.logger.exception("Google OAuth callback failed")
        flash("Google sign-in could not be completed. Please try again.", "error")
        return redirect(url_for(failure_endpoint))

    if not isinstance(user_info, Mapping):
        flash("Google did not return a valid profile. Please try again.", "error")
        return redirect(url_for(failure_endpoint))

    email = normalize_email(user_info.get('email'))
    name = str(user_info.get('name') or '').strip() or email.split('@')[0]
    email_verified = user_info.get('email_verified')
    is_verified = email_verified is True or str(email_verified).lower() == 'true'

    if not email or not is_verified:
        flash("A verified Google email address is required.", "error")
        return redirect(url_for(failure_endpoint))

    session['is_admin'] = False

    if email in ADMIN_EMAILS:
        session['is_admin'] = True
        session['admin_user'] = {'email': email, 'name': name}
        return redirect(url_for('admin_dashboard'))

    if intent == 'admin':
        flash("This Google account is not authorized for administrator access.", "error")
        return redirect(url_for('admin_panel'))

    if not add_or_update_user(email, name):
        flash("Your account could not be saved. Please try again.", "error")
        return redirect(url_for('login'))

    profile = get_user_by_email(email)
    if not profile:
        flash("Your account could not be loaded. Please try again.", "error")
        return redirect(url_for('login'))
    if profile.get('is_banned'):
        flash("This account has been banned. Contact an administrator for help.", "error")
        return redirect(url_for('login'))

    session['user'] = {'email': email, 'name': name}
    return redirect(url_for('dashboard'))

@app.route('/dashboard')
def dashboard():
    user = session.get('user')
    if not user:
        return redirect(url_for('login'))

    profile = get_user_by_email(user.get('email'))
    if not profile:
        session.pop('user', None)
        flash("Your account could not be loaded. Please sign in again.", "error")
        return redirect(url_for('login'))
    if profile.get('is_banned'):
        session.clear()
        flash("This account has been banned. Contact an administrator for help.", "error")
        return redirect(url_for('login'))

    warnings = []
    try:
        warnings = list_warnings(profile['id'], limit=10)
    except (AdminUserServiceError, AdminUserValidationError):
        app.logger.exception("Could not load warnings for user %s", profile['id'])

    return render_template(
        'dashboard.html', user=user, profile=profile, user_warnings=warnings
    )

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('home'))

# ─────────────────────────────────────────────
# ADMIN ROUTES
# ─────────────────────────────────────────────

@app.route('/admin') 
def admin_panel():
    if session.get('is_admin'):
        return redirect(url_for('admin_dashboard'))
    return render_template('admin.html')


def admin_required(view):
    """Require an authenticated administrator for a route."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get('is_admin'):
            return redirect(url_for('admin_panel'))
        return view(*args, **kwargs)

    return wrapped


def csrf_token():
    """Return the current session's CSRF token, creating it when needed."""
    token = session.get('_csrf_token')
    if not token:
        token = secrets.token_urlsafe(32)
        session['_csrf_token'] = token
    return token


app.jinja_env.globals['csrf_token'] = csrf_token


def csrf_protected(view):
    """Reject state-changing requests without the session's CSRF token."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        expected_token = session.get('_csrf_token', '')
        supplied_token = request.form.get('_csrf_token', '')
        if not expected_token or not supplied_token or not secrets.compare_digest(
            expected_token, supplied_token
        ):
            abort(400, description="Invalid or missing CSRF token.")
        return view(*args, **kwargs)

    return wrapped


@app.route('/profile', methods=['POST'])
@csrf_protected
def complete_profile():
    """Persist the signed-in student's required onboarding details."""
    session_user = session.get('user')
    if not session_user:
        return redirect(url_for('login'))

    current_profile = get_user_by_email(session_user.get('email'))
    if not current_profile:
        session.pop('user', None)
        flash("Your account could not be loaded. Please sign in again.", "error")
        return redirect(url_for('login'))
    if current_profile.get('is_banned'):
        session.clear()
        flash("This account has been banned. Contact an administrator for help.", "error")
        return redirect(url_for('login'))

    try:
        updated_profile = update_user_profile(
            email=session_user.get('email'),
            preferred_name=request.form.get('preferred_name'),
            department=request.form.get('department'),
            urn=request.form.get('urn'),
            crn=request.form.get('crn'),
            semester_no=request.form.get('semester_no'),
        )
    except ValueError as error:
        flash(str(error), "error")
        return redirect(url_for('dashboard'))

    if not updated_profile:
        flash("Your details could not be saved. Please try again.", "error")
        return redirect(url_for('dashboard'))

    session['user']['name'] = updated_profile['display_name']
    flash("Your details were saved successfully.", "success")
    return redirect(url_for('dashboard'))

@app.route('/admin-dashboard')
@admin_required
def admin_dashboard():
    # Fetch all resources and stats for the dashboard
    resources = get_resources()
    stats = get_resource_stats()
    try:
        users = search_users(request.args.get('q', ''))
    except AdminUserValidationError as error:
        users = []
        flash(str(error), "error")
    except AdminUserServiceError:
        users = []
        app.logger.exception("Could not load the admin user database")
        flash("The user database is currently unavailable.", "error")
    try:
        warnings_by_user = list_warnings_for_users(
            [managed_user['id'] for managed_user in users]
        )
    except (AdminUserValidationError, AdminUserServiceError):
        warnings_by_user = {}
        app.logger.exception("Could not load admin warning histories")
        flash("Warning histories could not be loaded.", "error")
    return render_template(
        'admin-dashboard.html', resources=resources, stats=stats, users=users,
        warnings_by_user=warnings_by_user,
    )


def _moderation_redirect():
    return redirect(url_for('admin_dashboard', panel='users'))


@app.route('/admin/users/<int:user_id>/ban', methods=['POST'])
@admin_required
@csrf_protected
def admin_ban_user(user_id):
    try:
        updated = ban_user(user_id)
    except (AdminUserValidationError, AdminUserServiceError) as error:
        app.logger.exception("Could not ban user %s", user_id)
        flash(str(error), "error")
        return _moderation_redirect()

    flash("User banned successfully." if updated else "User not found.",
          "success" if updated else "error")
    return _moderation_redirect()


@app.route('/admin/users/<int:user_id>/unban', methods=['POST'])
@admin_required
@csrf_protected
def admin_unban_user(user_id):
    try:
        updated = unban_user(user_id)
    except (AdminUserValidationError, AdminUserServiceError) as error:
        app.logger.exception("Could not unban user %s", user_id)
        flash(str(error), "error")
        return _moderation_redirect()

    flash("User access restored." if updated else "User not found.",
          "success" if updated else "error")
    return _moderation_redirect()


@app.route('/admin/users/<int:user_id>/warn', methods=['POST'])
@admin_required
@csrf_protected
def admin_warn_user(user_id):
    actor = session.get('admin_user', {}).get('email', 'admin')
    try:
        warning_id = create_warning(user_id, request.form.get('message'), actor)
    except (AdminUserValidationError, AdminUserServiceError) as error:
        if isinstance(error, AdminUserServiceError):
            app.logger.exception("Could not warn user %s", user_id)
        flash(str(error), "error")
        return _moderation_redirect()

    flash("Warning sent successfully." if warning_id else "User not found.",
          "success" if warning_id else "error")
    return _moderation_redirect()


@app.route(
    '/admin/users/<int:user_id>/warnings/<int:warning_id>/delete',
    methods=['POST'],
)
@admin_required
@csrf_protected
def admin_delete_warning(user_id, warning_id):
    try:
        deleted = delete_warning(user_id, warning_id)
    except (AdminUserValidationError, AdminUserServiceError) as error:
        if isinstance(error, AdminUserServiceError):
            app.logger.exception(
                "Could not delete warning %s for user %s", warning_id, user_id
            )
        flash(str(error), "error")
        return _moderation_redirect()

    flash("Warning removed." if deleted else "Warning not found.",
          "success" if deleted else "error")
    return _moderation_redirect()


# ─────────────────────────────────────────────
# UPLOAD ROUTE (Agent 1 + Agent 2 working together)
# ─────────────────────────────────────────────

@app.route('/upload', methods=['POST'])
@admin_required
@csrf_protected
def upload():

    # Extract form data
    category = (request.form.get('category') or '').strip().lower()
    branch = (request.form.get('branch') or '').strip().lower()
    semester = (request.form.get('semester') or '').strip()
    title = (request.form.get('title') or '').strip()
    subject_name = request.form.get('subject_name', '').strip() or None
    file = request.files.get('file_upload')

    if not all([category, branch, semester, title, file]):
        flash("All required fields must be filled.", "error")
        return redirect(url_for('admin_dashboard'))

    if category not in ALLOWED_CATEGORIES or branch not in ALLOWED_BRANCHES or semester not in ALLOWED_SEMESTERS:
        flash("Invalid category, branch, or semester.", "error")
        return redirect(url_for('admin_dashboard'))

    if len(title) > 500 or (subject_name and len(subject_name) > 255):
        flash("The title or subject name is too long.", "error")
        return redirect(url_for('admin_dashboard'))

    original_filename = secure_filename(file.filename or '')
    if not original_filename:
        flash("No file selected.", "error")
        return redirect(url_for('admin_dashboard'))

    # ── AGENT 1: Upload to Azure Blob Storage ──
    extension = Path(original_filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        flash("Unsupported file type.", "error")
        return redirect(url_for('admin_dashboard'))

    if not file_content_matches_extension(file.stream, extension):
        flash("The file contents do not match the selected file type.", "error")
        return redirect(url_for('admin_dashboard'))

    # Determine the size without loading the entire file into application memory.
    file.stream.seek(0, os.SEEK_END)
    file_size = file.stream.tell()
    file.stream.seek(0)

    if file_size <= 0:
        flash("The selected file is empty.", "error")
        return redirect(url_for('admin_dashboard'))

    if file_size > MAX_UPLOAD_BYTES:
        flash("Files must be 50 MB or smaller.", "error")
        return redirect(url_for('admin_dashboard'))

    upload_result = upload_file(file.stream, original_filename, category)

    if not upload_result or not upload_result.get("blob_url"):
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
        uploaded_by=session.get('admin_user', {}).get('email', 'admin'),
        subject_name=subject_name,
    )

    if not resource_id:
        cleanup_succeeded = delete_file(blob_url)
        if cleanup_succeeded:
            flash("The database save failed, so the uploaded file was removed.", "error")
        else:
            app.logger.error("Orphaned blob after database failure: %s", blob_url)
            flash("The database save failed and cloud cleanup also failed.", "error")
        return redirect(url_for('admin_dashboard'))

    flash(f"'{title}' uploaded successfully!", "success")
    return redirect(url_for('admin_dashboard'))


# ─────────────────────────────────────────────
# ADMIN MANAGEMENT ROUTES
# ─────────────────────────────────────────────

@app.route('/admin/toggle-status/<int:resource_id>', methods=['POST'])
@admin_required
@csrf_protected
def toggle_status(resource_id):
    """Toggles a resource between verified and unverified."""
    resource = get_resource_by_id(resource_id)
    if not resource:
        flash("Resource not found.", "error")
        return redirect(url_for('admin_dashboard'))

    new_status = "unverified" if resource["status"] == "verified" else "verified"
    if not update_resource_status(resource_id, new_status):
        flash("Failed to update the resource status.", "error")
        return redirect(url_for('admin_dashboard'))

    flash(f"Status updated to '{new_status}'.", "success")
    return redirect(url_for('admin_dashboard'))


@app.route('/admin/delete/<int:resource_id>', methods=['POST'])
@admin_required
@csrf_protected
def admin_delete(resource_id):
    """Deletes a resource from both Azure Storage and the database."""
    resource = get_resource_by_id(resource_id)
    if not resource:
        flash("Resource not found.", "error")
        return redirect(url_for('admin_dashboard'))

    # Keep the database record when cloud deletion fails so cleanup can be retried.
    if not delete_file(resource['blob_url']):
        flash("Cloud deletion failed; the resource record was kept.", "error")
        return redirect(url_for('admin_dashboard'))

    blob_url = delete_resource(resource_id)
    if not blob_url:
        app.logger.error(
            "Blob deleted but database cleanup failed for resource %s", resource_id
        )
        flash("Failed to delete resource.", "error")
        return redirect(url_for('admin_dashboard'))

    flash("Resource deleted successfully.", "success")
    return redirect(url_for('admin_dashboard'))


@app.errorhandler(RequestEntityTooLarge)
def handle_file_too_large(_error):
    flash("Files must be 50 MB or smaller.", "error")
    endpoint = 'admin_dashboard' if session.get('is_admin') else 'admin_panel'
    return redirect(url_for(endpoint))


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


@app.route('/pyqs')
def pyqs():
    # Later, we will fetch the database records here
    return render_template('pyqs.html')


@app.route('/contribute')
def contribute():
    return render_template('contribute.html')

if __name__ == '__main__':
    app.run(debug=os.getenv('FLASK_DEBUG') == '1', port=8000)
