"""Server-side, request-scoped authorization for delegated staff workspaces."""
from functools import wraps

from flask import abort, current_app, g, redirect, session, url_for
import database

ROLE_LABELS = {
    'student': 'Student',
    'notification_head': 'Notification head',
    'user_manager': 'User manager',
    'ui_editor': 'UI editor',
}
STAFF_ROLES = frozenset(ROLE_LABELS) - {'student'}
STAFF_ROLE_ORDER = tuple(role for role in ROLE_LABELS if role in STAFF_ROLES)


def normalize_email(value):
    return str(value or '').strip().casefold()


def current_actor_email():
    identity = session.get('admin_user') if session.get('is_admin') else session.get('user')
    return normalize_email((identity or {}).get('email'))


def is_administrator():
    allowed = current_app.config.get('ADMIN_EMAILS', ())
    return bool(session.get('is_admin') and current_actor_email() in allowed)


def get_user_by_email(email):
    loader = current_app.config.get('ROLE_PROFILE_LOADER', database.get_user_by_email)
    return loader(email)


def profile_roles(profile):
    """Return ordered staff grants; an explicit empty set overrides legacy data."""
    profile = profile or {}
    if 'roles' in profile:
        values = profile['roles']
        if not isinstance(values, (list, tuple, set, frozenset)):
            return ()
        if any(not isinstance(role, str) or role not in STAFF_ROLES for role in values):
            return ()
    else:
        # Preserve pre-migration profiles; never restore a revoked canonical set.
        values = (profile.get('role', 'student'),)
    return tuple(role for role in STAFF_ROLE_ORDER if role in values)


def profile_role(profile):
    """Legacy display helper; authorization must check the full role set."""
    roles = profile_roles(profile)
    return roles[0] if roles else 'student'


def _current_profile():
    if not hasattr(g, 'role_profile'):
        email = current_actor_email()
        try:
            g.role_profile = get_user_by_email(email) if email else None
        except Exception:
            current_app.logger.exception('Could not verify workspace access')
            abort(503, description='Workspace access is temporarily unavailable.')
    return g.role_profile


def current_roles():
    # Delegated roles are never trusted from a cookie or a submitted form.
    if is_administrator():
        return frozenset({'admin'})
    profile = _current_profile()
    if not profile or profile.get('is_banned'):
        return frozenset()
    return frozenset(profile_roles(profile))


def current_role():
    """Compatibility helper for code that displays a single primary role."""
    if is_administrator():
        return 'admin'
    profile = _current_profile()
    if not profile or profile.get('is_banned'):
        return None
    return profile_role(profile)


def role_required(role, allow_admin=True):
    if role not in STAFF_ROLES:
        raise ValueError('Unknown staff role.')

    def decorate(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if not current_actor_email():
                return redirect(url_for('login'))
            actual_roles = current_roles()
            if role not in actual_roles and not (allow_admin and 'admin' in actual_roles):
                abort(403, description='This workspace is restricted to its assigned role.')
            g.assigned_workspace_roles = tuple(value for value in STAFF_ROLE_ORDER if value in actual_roles)
            return view(*args, **kwargs)
        return wrapped
    return decorate
