"""Role assignments are available only in the administrator control room."""
from flask import current_app, flash, redirect, render_template, request, url_for
from admin_user_service import search_users, AdminUserServiceError, AdminUserValidationError
from role_access import ROLE_LABELS, current_actor_email, profile_roles
import role_service


def register_routes(app, admin_required, csrf_protected, admin_emails):
    @app.get('/admin/roles')
    @admin_required
    def admin_roles():
        error = None
        try:
            users = search_users(request.args.get('q', ''))
        except (AdminUserServiceError, AdminUserValidationError) as exc:
            users, error = [], str(exc)
        return render_template('admin-roles.html', users=users, role_labels=ROLE_LABELS,
                               admin_emails=admin_emails, error=error,
                               profile_roles=profile_roles), 503 if error else 200

    @app.post('/admin/users/<int:user_id>/role')
    @admin_required
    @csrf_protected
    def admin_assign_role(user_id):
        try:
            if 'roles_present' in request.form or 'roles' in request.form:
                if request.form.getlist('roles_present') != ['1'] or 'role' in request.form:
                    raise ValueError('Choose the roles using the role assignment form.')
                updated = role_service.assign_roles(user_id, request.form.getlist('roles'),
                                                    current_actor_email(), admin_emails)
            else:
                # Accept a previously opened single-role form during migration.
                if len(request.form.getlist('role')) != 1:
                    raise ValueError('Choose the roles using the role assignment form.')
                updated = role_service.assign_role(user_id, request.form['role'], current_actor_email(), admin_emails)
            flash('Roles saved. Access changes take effect on the next request.' if updated else 'User not found.',
                  'success' if updated else 'error')
        except (ValueError, role_service.RoleServiceError) as exc:
            if isinstance(exc, role_service.RoleServiceError):
                current_app.logger.exception('Could not save role assignment')
            flash(str(exc), 'error')
        return redirect(url_for('admin_roles', q=request.form.get('q', '')[:200]))
