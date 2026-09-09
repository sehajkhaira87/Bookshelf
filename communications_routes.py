"""Authenticated admin publishing and student inbox endpoints."""
from uuid import uuid4
from functools import wraps

from flask import abort, flash, jsonify, render_template, redirect, request, session, url_for, g
from database import get_user_by_email
import communications_service as service
import presence_service


def register_routes(app, admin_required, csrf_protected, admin_emails):
    def student_required(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            email = session.get('user', {}).get('email')
            if not email:
                abort(401)
            try:
                profile = get_user_by_email(email)
            except Exception:
                return jsonify(error='Notifications are temporarily unavailable.'), 503
            if not profile or profile.get('is_banned'):
                abort(403)
            g.notification_user = profile['id']
            return view(*args, **kwargs)
        return wrapped

    def admin_page(error=None, status=200):
        notice, sent = None, []
        unavailable = False
        try:
            notice, sent = service.announcement(include_hidden=True), service.history()
        except Exception:
            app.logger.exception('Could not load communications workspace')
            error, status = 'Communications are temporarily unavailable. Please try again.', 503
            unavailable = True
        return render_template('admin-communications.html', announcement=notice, sent=sent,
            error=error, request_key=request.form.get('request_key') or str(uuid4()),
            submitted=request.form, unavailable=unavailable), status

    @app.get('/admin/communications')
    @admin_required
    def admin_communications():
        return admin_page()

    @app.post('/api/activity')
    @student_required
    @csrf_protected
    def student_activity():
        try:
            presence_service.record_activity(g.notification_user, admin_emails)
        except Exception:
            app.logger.exception('Could not record student activity')
            return jsonify(error='Activity tracking is temporarily unavailable.'), 503
        return '', 204

    @app.get('/api/admin/active-students')
    @admin_required
    def admin_active_students():
        try:
            response = jsonify(presence_service.active_students(admin_emails))
            response.headers['Cache-Control'] = 'no-store'
            return response
        except Exception:
            app.logger.exception('Could not load active students')
            return jsonify(error='Active student information is temporarily unavailable.'), 503

    @app.post('/admin/communications/announcement')
    @admin_required
    @csrf_protected
    def admin_announcement():
        try:
            actor = session.get('admin_user', {}).get('email', 'admin')
            revision = request.form.get('revision', '')
            if request.form.get('action') == 'remove':
                service.remove_announcement(actor, revision)
            else:
                service.save_announcement(request.form.get('notice_title'), request.form.get('notice_body'),
                    request.form.get('notice_link'), actor, revision)
        except ValueError as exc:
            return admin_page(str(exc), 400)
        except Exception:
            app.logger.exception('Could not update official announcement')
            return admin_page('The announcement could not be saved. Please try again.', 503)
        flash('Announcement removed.' if request.form.get('action') == 'remove' else 'Official announcement published.', 'success')
        return redirect(url_for('admin_communications'))

    @app.get('/admin/communications/students')
    @admin_required
    def notification_students():
        try:
            response = jsonify(items=service.find_students(request.args.get('q'), admin_emails))
            response.headers['Cache-Control'] = 'no-store'
            return response
        except Exception:
            app.logger.exception('Could not search notification recipients')
            return jsonify(error='Student search is temporarily unavailable.'), 503

    @app.post('/admin/communications/send')
    @admin_required
    @csrf_protected
    def admin_send_notification():
        try:
            count = service.send_notification(request.form.get('title'), request.form.get('body'),
                request.form.get('link_url'), request.form.get('audience'), request.form.getlist('recipients'),
                session.get('admin_user', {}).get('email', 'admin'), request.form.get('request_key'), admin_emails)
        except (ValueError, TypeError) as exc:
            return admin_page(str(exc), 400)
        except Exception:
            app.logger.exception('Could not send student notifications')
            return admin_page('The send could not be confirmed. Retry this form safely; it will not send twice.', 503)
        flash(f'Notification sent to {count} student(s).', 'success')
        return redirect(url_for('admin_communications'))

    @app.get('/api/notifications')
    @student_required
    def student_notifications():
        try:
            before = int(request.args['before']) if 'before' in request.args else None
            if before is not None and not 0 < before <= 9223372036854775807:
                raise ValueError()
        except ValueError:
            abort(400)
        try:
            payload = service.inbox(g.notification_user, before)
            for item in payload['items']:
                item['created_at'] = item['created_at'].isoformat()
                item['read_at'] = item['read_at'].isoformat() if item['read_at'] else None
            response = jsonify(payload)
            response.headers['Cache-Control'] = 'no-store'
            return response
        except Exception:
            app.logger.exception('Could not load student inbox')
            return jsonify(error='Notifications are temporarily unavailable. Please try again.'), 503

    @app.post('/api/notifications/<int:notification_id>/read')
    @student_required
    @csrf_protected
    def read_notification(notification_id):
        if not 0 < notification_id <= 9223372036854775807:
            abort(400)
        try:
            found = service.mark_read(g.notification_user, notification_id=notification_id)
        except Exception:
            app.logger.exception('Could not mark notification read')
            return jsonify(error='Could not update this notification.'), 503
        if not found:
            abort(404)
        return jsonify(ok=True)

    @app.post('/api/notifications/read-all')
    @student_required
    @csrf_protected
    def read_all_notifications():
        try:
            through = int(request.form.get('through', ''))
            if not 0 < through <= 9223372036854775807:
                raise ValueError()
        except ValueError:
            abort(400)
        try:
            service.mark_read(g.notification_user, through=through)
        except Exception:
            app.logger.exception('Could not mark notifications read')
            return jsonify(error='Could not update your notifications.'), 503
        return jsonify(ok=True)
