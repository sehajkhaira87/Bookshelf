"""Dedicated, role-restricted student and contribution moderation routes."""

from urllib.parse import urlsplit

from flask import abort, flash, redirect, render_template, request, url_for

import admin_user_service as moderation
import db_agent
import storage_agent
import user_manager_service as service
from database import get_user_by_email
from role_access import current_actor_email, role_required


def register_routes(app, csrf_protected, admin_emails):
    def destination():
        return redirect(url_for('user_manager_dashboard',
                                q=request.form.get('q', '')[:200],
                                resource_q=request.form.get('resource_q', '')[:200],
                                status=request.form.get('status_filter', '')[:20]))

    def require_student(user_id):
        student = service.get_student(user_id, admin_emails, current_actor_email())
        if not service.is_manageable_student(student, admin_emails, current_actor_email()):
            abort(404, description='This student is not available for management.')
        return student

    def require_resource(resource_id):
        resource = db_agent.get_resource_by_id(resource_id)
        if not resource or resource.get('category') not in service.RESOURCE_CATEGORIES or resource.get('is_protected'):
            abort(404, description='This student contribution is not available for management.')
        uploader = service.normalize_email(resource.get('uploaded_by'))
        if not uploader or uploader == 'admin' or uploader in admin_emails:
            abort(404, description='This student contribution is not available for management.')
        owner = get_user_by_email(uploader)
        if not service.is_manageable_student(owner, admin_emails, current_actor_email()):
            abort(404, description='This student contribution is not available for management.')
        return resource

    def student_action(user_id, action, success_message):
        try:
            require_student(user_id)
            result = action()
            flash(success_message if result else 'Student not found. Refresh and try again.',
                  'success' if result else 'error')
        except moderation.AdminUserValidationError as error:
            flash(str(error), 'error')
        except moderation.AdminUserServiceError:
            app.logger.exception('User manager action failed for student %s', user_id)
            flash('The change could not be saved. Please try again.', 'error')
        return destination()

    @app.get('/dashboard/users')
    @role_required('user_manager', allow_admin=False)
    def user_manager_dashboard():
        search = request.args.get('q', '').strip()
        resource_search = request.args.get('resource_q', '').strip()
        status = request.args.get('status', '').strip()
        students, resources, warnings = [], [], {}
        more_students = more_resources = False
        page = resource_page = 1
        try:
            page = service._page(request.args.get('page', 1))
            resource_page = service._page(request.args.get('resource_page', 1))
            students, more_students = service.list_students(search, page, admin_emails, current_actor_email())
            resources, more_resources = service.list_student_resources(
                resource_search, status, resource_page, admin_emails, current_actor_email())
            warnings = moderation.list_warnings_for_users([student['id'] for student in students], limit_per_user=5)
        except moderation.AdminUserValidationError as error:
            flash(str(error), 'error')
        except moderation.AdminUserServiceError:
            app.logger.exception('Could not load the user manager workspace')
            flash('Student management is temporarily unavailable. Please try again.', 'error')
        for resource in resources:
            # Old imported metadata must not inject a javascript: preview link.
            try:
                link = urlsplit(resource.get('blob_url') or '')
                resource['preview_url'] = resource['blob_url'] if link.scheme in ('https', 'http') and link.netloc else ''
            except ValueError:
                resource['preview_url'] = ''
        response = app.make_response(render_template('user-manager.html', students=students,
            resources=resources, warnings_by_user=warnings, search=search[:200],
            resource_search=resource_search[:200], status=status, page=page,
            resource_page=resource_page, more_students=more_students, more_resources=more_resources))
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.post('/dashboard/users/<int:user_id>/ban')
    @role_required('user_manager', allow_admin=False)
    @csrf_protected
    def user_manager_ban(user_id):
        return student_action(user_id, lambda: moderation.ban_user(user_id), 'Student access suspended.')

    @app.post('/dashboard/users/<int:user_id>/unban')
    @role_required('user_manager', allow_admin=False)
    @csrf_protected
    def user_manager_unban(user_id):
        return student_action(user_id, lambda: moderation.unban_user(user_id), 'Student access restored.')

    @app.post('/dashboard/users/<int:user_id>/warn')
    @role_required('user_manager', allow_admin=False)
    @csrf_protected
    def user_manager_warn(user_id):
        return student_action(user_id, lambda: moderation.create_warning(
            user_id, request.form.get('message'), current_actor_email()), 'Warning sent to the student dashboard.')

    @app.post('/dashboard/users/<int:user_id>/badge')
    @role_required('user_manager', allow_admin=False)
    @csrf_protected
    def user_manager_badge(user_id):
        return student_action(user_id, lambda: moderation.set_contributor_badge(
            user_id, request.form.get('badge')), 'Contributor badge saved.')

    @app.post('/dashboard/users/<int:user_id>/warnings/<int:warning_id>/delete')
    @role_required('user_manager', allow_admin=False)
    @csrf_protected
    def user_manager_delete_warning(user_id, warning_id):
        return student_action(user_id, lambda: moderation.delete_warning(user_id, warning_id), 'Warning removed.')

    @app.post('/dashboard/users/resources/<int:resource_id>/status')
    @role_required('user_manager', allow_admin=False)
    @csrf_protected
    def user_manager_resource_status(resource_id):
        status = request.form.get('status')
        if status not in ('verified', 'unverified'):
            flash('Choose Verified or Needs review.', 'error')
            return destination()
        require_resource(resource_id)
        if db_agent.update_resource_status(resource_id, status):
            flash('Contribution verified.' if status == 'verified' else 'Contribution returned to review.', 'success')
        else:
            flash('The contribution status could not be saved. Please try again.', 'error')
        return destination()

    @app.post('/dashboard/users/resources/<int:resource_id>/delete')
    @role_required('user_manager', allow_admin=False)
    @csrf_protected
    def user_manager_resource_delete(resource_id):
        if request.form.get('confirm_delete') != 'yes':
            flash('Confirm permanent deletion before removing a contribution.', 'error')
            return destination()
        resource = require_resource(resource_id)
        if not storage_agent.delete_file(resource['blob_url']):
            flash('The file could not be removed from storage. The contribution was kept.', 'error')
        elif not db_agent.delete_resource(resource_id):
            app.logger.error('User manager removed file but could not remove resource record %s', resource_id)
            flash('The file was removed, but its record could not be cleared. Contact an administrator.', 'error')
        else:
            flash('Student contribution permanently deleted.', 'success')
        return destination()
