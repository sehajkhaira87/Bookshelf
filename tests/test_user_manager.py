"""Delegated user-manager regression tests; database and storage are mocked."""

from functools import wraps
from pathlib import Path
from unittest import TestCase
from unittest.mock import MagicMock, patch

from flask import Flask, abort, request, session

import admin_user_service as moderation
import user_manager_routes as routes
import user_manager_service as service


class UserManagerRouteTests(TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[1]
        self.app = Flask('user-manager-tests', template_folder=str(root / 'templates'))
        self.profile = dict(id=50, email='manager@example.test', role='user_manager', is_banned=False)
        self.student = dict(id=7, email='student@example.test', role='student', name='Alex',
                            preferred_name='Alex', department='CSE', semester_no=2,
                            crn='2415007', urn='2416007', contributor_badge='', warning_count=0,
                            is_banned=False)
        self.resource = dict(id=12, uploaded_by=self.student['email'], category='notes',
                             title='Study notes', status='unverified', branch='cse', semester=2,
                             subject_name='Algorithms', blob_url='https://example.test/notes.pdf')
        self.app.config.update(TESTING=True, SECRET_KEY='test-only',
            ADMIN_EMAILS=frozenset({'admin@example.test'}), ROLE_PROFILE_LOADER=lambda email: self.profile)
        self.app.add_url_rule('/login', 'login', lambda: 'Login')
        self.app.add_url_rule('/dashboard', 'dashboard', lambda: 'Dashboard')
        self.app.add_url_rule('/pyqs', 'pyqs', lambda: 'Past papers')
        self.app.add_url_rule('/contribute', 'contribute', lambda: 'Contribute')
        self.app.add_url_rule('/logout', 'logout', lambda: 'Logout')
        self.app.jinja_env.globals['csrf_token'] = lambda: 'token'

        def csrf_protected(view):
            @wraps(view)
            def wrapped(*args, **kwargs):
                if request.form.get('_csrf_token') != session.get('_csrf_token') or not session.get('_csrf_token'):
                    abort(400)
                return view(*args, **kwargs)
            return wrapped

        routes.register_routes(self.app, csrf_protected, self.app.config['ADMIN_EMAILS'])
        self.client = self.app.test_client()
        self.mocks = {}
        for module, name, result in [
            (service, 'list_students', ([self.student], False)),
            (service, 'list_student_resources', ([self.resource], False)),
            (service, 'get_student', self.student),
            (moderation, 'list_warnings_for_users', {}),
            (routes, 'get_user_by_email', self.student),
            (routes.db_agent, 'get_resource_by_id', self.resource),
            (routes.db_agent, 'update_resource_status', True),
            (routes.db_agent, 'delete_resource', self.resource['blob_url']),
            (routes.storage_agent, 'delete_file', True),
            (moderation, 'ban_user', True), (moderation, 'unban_user', True),
            (moderation, 'create_warning', 3), (moderation, 'delete_warning', True),
            (moderation, 'set_contributor_badge', True),
        ]:
            patcher = patch.object(module, name, return_value=result)
            self.mocks[name] = patcher.start()
            self.addCleanup(patcher.stop)

    def login(self):
        with self.client.session_transaction() as signed:
            signed.clear()
            signed.update(user={'email': self.profile['email'], 'role': 'user_manager'}, _csrf_token='token')

    def post(self, path, **data):
        return self.client.post(path, data={'_csrf_token': 'token', **data})

    def mutations(self):
        return ['/dashboard/users/7/ban', '/dashboard/users/7/unban',
                '/dashboard/users/7/warn', '/dashboard/users/7/badge',
                '/dashboard/users/7/warnings/3/delete',
                '/dashboard/users/resources/12/status', '/dashboard/users/resources/12/delete']

    def test_all_routes_are_exclusive_to_user_manager(self):
        self.assertEqual(self.client.get('/dashboard/users').status_code, 302)
        for path in self.mutations():
            self.assertEqual(self.post(path).status_code, 302)
        self.login()
        for role in ('student', 'notification_head', 'ui_editor', 'unknown'):
            self.profile['role'] = role
            self.assertEqual(self.client.get('/dashboard/users').status_code, 403)
            for path in self.mutations():
                self.assertEqual(self.post(path).status_code, 403)
        with self.client.session_transaction() as signed:
            signed.update(is_admin=True, admin_user={'email': 'admin@example.test'})
        self.assertEqual(self.client.get('/dashboard/users').status_code, 403)
        for path in self.mutations():
            self.assertEqual(self.post(path).status_code, 403)
        self.mocks['ban_user'].assert_not_called()
        self.mocks['delete_file'].assert_not_called()

    def test_csrf_required_on_every_mutation(self):
        self.login()
        for path in self.mutations():
            self.assertEqual(self.client.post(path).status_code, 400)
        self.mocks['get_student'].assert_not_called()
        self.mocks['get_resource_by_id'].assert_not_called()

    def test_banned_missing_and_revoked_role_are_rechecked(self):
        self.login()
        self.assertEqual(self.client.get('/dashboard/users').status_code, 200)
        self.profile['role'] = 'student'
        self.assertEqual(self.post('/dashboard/users/7/ban').status_code, 403)
        self.profile.update(role='user_manager', is_banned=True)
        self.assertEqual(self.post('/dashboard/users/7/ban').status_code, 403)
        self.profile = None
        self.assertEqual(self.post('/dashboard/users/7/ban').status_code, 403)
        self.mocks['ban_user'].assert_not_called()

    def test_dashboard_render_filters_and_escaping(self):
        self.login()
        self.student['preferred_name'] = '<script>alert(1)</script>'
        self.resource.update(title='<b>Unsafe title</b>', blob_url='javascript:alert(1)')
        response = self.client.get('/dashboard/users?q=Alex&resource_q=notes&status=unverified')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertIn(b'&lt;script&gt;alert(1)&lt;/script&gt;', response.data)
        self.assertIn(b'&lt;b&gt;Unsafe title&lt;/b&gt;', response.data)
        self.assertNotIn(b'javascript:alert', response.data)
        self.assertNotIn(b'/admin/', response.data)
        self.assertIn(b'Suspend access', response.data)
        self.assertIn(b'Verify contribution', response.data)
        self.mocks['list_students'].assert_called_once_with('Alex', 1, self.app.config['ADMIN_EMAILS'], 'manager@example.test')
        self.mocks['list_student_resources'].assert_called_once_with('notes', 'unverified', 1, self.app.config['ADMIN_EMAILS'], 'manager@example.test')

    def test_warnings_history_render_and_delete(self):
        self.login()
        self.mocks['list_warnings_for_users'].return_value = {7: [dict(id=3, message='Please use a real name.', created_at='2026-01-01')]}
        self.assertIn(b'Please use a real name.', self.client.get('/dashboard/users').data)
        self.assertEqual(self.post('/dashboard/users/7/warnings/3/delete').status_code, 302)
        self.mocks['delete_warning'].assert_called_once_with(7, 3)

    def test_student_moderation_uses_signed_in_actor(self):
        self.login()
        self.assertEqual(self.post('/dashboard/users/7/ban').status_code, 302)
        self.assertEqual(self.post('/dashboard/users/7/unban').status_code, 302)
        self.assertEqual(self.post('/dashboard/users/7/badge', badge='trusted').status_code, 302)
        self.assertEqual(self.post('/dashboard/users/7/warn', message='Check your upload.', created_by='forged').status_code, 302)
        self.mocks['ban_user'].assert_called_once_with(7)
        self.mocks['unban_user'].assert_called_once_with(7)
        self.mocks['set_contributor_badge'].assert_called_once_with(7, 'trusted')
        self.mocks['create_warning'].assert_called_once_with(7, 'Check your upload.', 'manager@example.test')

    def test_staff_admin_self_and_unknown_targets_cannot_be_moderated(self):
        self.login()
        protected = [None, dict(self.student, role='notification_head'),
                     dict(self.student, role='ui_editor'), dict(self.student, role='user_manager'),
                     dict(self.student, role='unknown'), dict(self.student, email=' ADMIN@example.test '),
                     dict(self.student, email='manager@example.test'), dict(self.student, role=None)]
        for target in protected:
            self.mocks['get_student'].return_value = target
            for path in self.mutations()[:5]:
                self.assertEqual(self.post(path).status_code, 404)
        for operation in ('ban_user', 'unban_user', 'create_warning', 'set_contributor_badge', 'delete_warning'):
            self.mocks[operation].assert_not_called()

    def test_student_scope_is_rechecked_on_each_action(self):
        self.login()
        self.assertEqual(self.post('/dashboard/users/7/ban').status_code, 302)
        self.mocks['get_student'].return_value = dict(self.student, role='ui_editor')
        self.assertEqual(self.post('/dashboard/users/7/unban').status_code, 404)
        self.mocks['unban_user'].assert_not_called()

    def test_resource_status_and_delete_success(self):
        self.login()
        for status in ('verified', 'unverified'):
            self.assertEqual(self.post('/dashboard/users/resources/12/status', status=status).status_code, 302)
            self.mocks['update_resource_status'].assert_called_with(12, status)
        self.assertEqual(self.post('/dashboard/users/resources/12/delete', confirm_delete='yes').status_code, 302)
        self.mocks['delete_file'].assert_called_once_with('https://example.test/notes.pdf')
        self.mocks['delete_resource'].assert_called_once_with(12)

    def test_resources_of_staff_admin_self_missing_users_cannot_change(self):
        self.login()
        for owner in (None, dict(self.student, role='notification_head'),
                      dict(self.student, role='ui_editor'), dict(self.student, role='user_manager'),
                      dict(self.student, email='admin@example.test'),
                      dict(self.student, email='manager@example.test')):
            self.mocks['get_user_by_email'].return_value = owner
            self.assertEqual(self.post('/dashboard/users/resources/12/status', status='verified').status_code, 404)
            self.assertEqual(self.post('/dashboard/users/resources/12/delete', confirm_delete='yes').status_code, 404)
        self.mocks['update_resource_status'].assert_not_called()
        self.mocks['delete_file'].assert_not_called()
        self.mocks['delete_resource'].assert_not_called()

    def test_unknown_protected_or_nonstudent_resource_cannot_change(self):
        self.login()
        for resource in (None, dict(self.resource, uploaded_by='admin'),
                         dict(self.resource, uploaded_by=' ADMIN@example.test '),
                         dict(self.resource, category='pyq'), dict(self.resource, is_protected=True)):
            self.mocks['get_resource_by_id'].return_value = resource
            self.assertEqual(self.post('/dashboard/users/resources/12/status', status='verified').status_code, 404)
            self.assertEqual(self.post('/dashboard/users/resources/12/delete', confirm_delete='yes').status_code, 404)
        self.mocks['update_resource_status'].assert_not_called()
        self.mocks['delete_file'].assert_not_called()

    def test_resource_validation_and_storage_failure_keep_record(self):
        self.login()
        self.post('/dashboard/users/resources/12/status', status='anything')
        self.mocks['update_resource_status'].assert_not_called()
        self.post('/dashboard/users/resources/12/delete')
        self.mocks['delete_file'].assert_not_called()
        self.mocks['delete_file'].return_value = False
        self.post('/dashboard/users/resources/12/delete', confirm_delete='yes')
        self.mocks['delete_resource'].assert_not_called()
        self.assertIn(b'The contribution was kept', self.client.get('/dashboard/users').data)

    def test_database_and_validation_errors_do_not_leak_details(self):
        self.login()
        self.mocks['ban_user'].side_effect = moderation.AdminUserServiceError('private db credentials')
        self.post('/dashboard/users/7/ban')
        page = self.client.get('/dashboard/users')
        self.assertIn(b'The change could not be saved', page.data)
        self.assertNotIn(b'private db credentials', page.data)
        self.mocks['create_warning'].side_effect = moderation.AdminUserValidationError('Warning text is required.')
        self.post('/dashboard/users/7/warn')
        self.assertIn(b'Warning text is required.', self.client.get('/dashboard/users').data)

    def test_read_outage_and_invalid_pagination_remain_safe(self):
        self.login()
        self.mocks['list_students'].side_effect = moderation.AdminUserServiceError('private db credentials')
        page = self.client.get('/dashboard/users')
        self.assertEqual(page.status_code, 200)
        self.assertIn(b'temporarily unavailable', page.data)
        self.assertNotIn(b'private db credentials', page.data)
        self.assertIn(b'Choose a valid page', self.client.get('/dashboard/users?page=-1').data)


class UserManagerServiceTests(TestCase):
    def setUp(self):
        self.connection, self.cursor = MagicMock(), MagicMock()
        self.connection.cursor.return_value.__enter__.return_value = self.cursor
        self.cursor.fetchall.return_value = []
        patcher = patch.object(service, 'get_connection', return_value=self.connection)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_student_search_is_scoped_before_pagination_and_escapes_wildcards(self):
        service.list_students('%_search', 2, {' ADMIN@example.test '}, 'manager@example.test')
        sql, params = self.cursor.execute.call_args.args
        self.assertIn('cardinality(u.roles) = 0', sql)
        self.assertIn('LOWER(BTRIM(u.email)) <> ALL(%s)', sql)
        self.assertEqual(set(params[0]), {'admin', 'admin@example.test', 'manager@example.test'})
        self.assertEqual(params[1], '%\\%\\_search%')
        self.assertEqual(params[-2:], [26, 25])
        self.assertNotIn('password', sql)

    def test_resource_read_excludes_staff_and_unknown_uploaders_in_query(self):
        service.list_student_resources('notes', 'unverified', 1, {'admin@example.test'}, 'manager@example.test')
        sql, params = self.cursor.execute.call_args.args
        self.assertIn('JOIN users u', sql)
        self.assertIn('cardinality(u.roles) = 0', sql)
        self.assertIn('r.category = ANY(%s)', sql)
        self.assertIn('AND r.status = %s', sql)
        self.assertEqual(params[1], ['notes', 'assignment', 'book'])
        self.assertEqual(params[-3:], ['unverified', 26, 0])

    def test_pagination_only_returns_one_page(self):
        self.cursor.fetchall.return_value = [dict(id=index) for index in range(26)]
        students, more = service.list_students('', 1, (), 'manager@example.test')
        self.assertEqual(len(students), 25)
        self.assertTrue(more)

    def test_invalid_filters_do_not_touch_database(self):
        for value in (0, -1, 'bad', 100001):
            with self.assertRaises(moderation.AdminUserValidationError):
                service.list_students('', value, (), 'manager@example.test')
        with self.assertRaises(moderation.AdminUserValidationError):
            service.list_students('a' * 201, 1, (), '')
        with self.assertRaises(moderation.AdminUserValidationError):
            service.list_student_resources('', 'deleted', 1, (), '')
        self.cursor.execute.assert_not_called()

    def test_student_lookup_has_same_scope_as_search(self):
        service.get_student(8, {'admin@example.test'}, 'manager@example.test')
        sql, params = self.cursor.execute.call_args.args
        self.assertIn('cardinality(u.roles) = 0', sql)
        self.assertIn('u.id = %s', sql)
        self.assertEqual(params[-1], 8)

    def test_unavailable_database_has_a_safe_error(self):
        with patch.object(service, 'get_connection', return_value=None):
            with self.assertRaisesRegex(moderation.AdminUserServiceError, 'temporarily unavailable'):
                service.list_students('', 1, (), '')
