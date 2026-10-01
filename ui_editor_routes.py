"""Dashboard workspace available exclusively to the UI editor role."""
from hashlib import sha256
from io import BytesIO

from flask import abort, flash, make_response, redirect, render_template, request, send_file, url_for

from role_access import current_actor_email, role_required
import ui_settings_service as service
import department_service


def register_routes(app, csrf_protected):
    def editor_page(error=None, status=200, preserve_draft=False, unavailable=False, department_draft=None):
        try:
            settings = service.get_settings()
        except Exception:
            app.logger.exception('Could not load appearance settings')
            settings = dict(service.DEFAULT_SETTINGS)
            error, status, unavailable = 'Appearance settings are temporarily unavailable. Please try again.', 503, True
        draft = {field: request.form.get(field, settings[field]) for field in service.SETTING_FIELDS} if preserve_draft else settings
        departments_unavailable = False
        try:
            departments = app.config.get('DEPARTMENT_LOADER', department_service.list_departments)()
        except department_service.DepartmentUnavailable:
            app.logger.exception('Could not load departments for UI editor')
            departments, departments_unavailable = [], True
        response = make_response(render_template('ui-editor.html', settings=settings, draft=draft,
            draft_revision=request.form.get('revision', settings['revision']) if preserve_draft else settings['revision'],
            palettes=service.PALETTES, error=error, unavailable=unavailable,
            departments=departments, department_icons=department_service.ICONS,
            departments_unavailable=departments_unavailable, department_draft=department_draft or {}), status)
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/dashboard/appearance')
    @role_required('ui_editor', allow_admin=False)
    def ui_editor_dashboard():
        return editor_page()

    @app.post('/dashboard/appearance/save')
    @role_required('ui_editor', allow_admin=False)
    @csrf_protected
    def ui_editor_save():
        try:
            service.save_settings(request.form, current_actor_email(), request.form.get('revision'))
        except service.AppearanceConflict as exc:
            return editor_page(str(exc), 409, preserve_draft=True)
        except ValueError as exc:
            return editor_page(str(exc), 400, preserve_draft=True)
        except Exception:
            app.logger.exception('Could not save appearance settings')
            return editor_page('Your changes could not be saved. Please try again.', 503, preserve_draft=True)
        flash('Dashboard appearance updated for everyone.', 'success')
        return redirect(url_for('ui_editor_dashboard'))

    @app.post('/dashboard/appearance/reset')
    @role_required('ui_editor', allow_admin=False)
    @csrf_protected
    def ui_editor_reset():
        try:
            service.reset_settings(current_actor_email(), request.form.get('revision'))
        except service.AppearanceConflict as exc:
            return editor_page(str(exc), 409)
        except ValueError as exc:
            return editor_page(str(exc), 400)
        except Exception:
            app.logger.exception('Could not reset appearance settings')
            return editor_page('The default appearance could not be restored. Please try again.', 503)
        flash('Default dashboard appearance restored.', 'success')
        return redirect(url_for('ui_editor_dashboard'))

    @app.post('/dashboard/appearance/departments')
    @role_required('ui_editor', allow_admin=False)
    @csrf_protected
    def ui_editor_add_department():
        try:
            icon_file = request.files.get('icon_file')
            if icon_file and icon_file.filename:
                item = department_service.add_department(request.form, current_actor_email(), icon_file=icon_file)
            else:
                item = department_service.add_department(request.form, current_actor_email())
        except ValueError as exc:
            return editor_page(str(exc), 400, department_draft=request.form)
        except department_service.DepartmentUnavailable:
            app.logger.exception('Could not add department')
            return editor_page('The department could not be saved. Please try again.', 503,
                               department_draft=request.form)
        flash(f"{item['name']} ({item['code']}) added to the website.", 'success')
        return redirect(url_for('ui_editor_dashboard', _anchor='departmentsHeading'))

    @app.get('/departments/<code>/icon.png')
    def department_icon(code):
        try:
            icon = department_service.get_department_icon(code)
        except department_service.DepartmentUnavailable:
            app.logger.exception('Could not load department icon')
            abort(503, description='This icon is temporarily unavailable.')
        if icon is None:
            abort(404)
        response = send_file(BytesIO(icon), mimetype='image/png', conditional=True,
                             etag=sha256(icon).hexdigest(), max_age=86400)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response
