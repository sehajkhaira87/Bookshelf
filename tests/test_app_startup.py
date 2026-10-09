"""Startup regressions without connecting to the live database."""
import importlib
import io
import os
import sys
import unittest
from contextlib import ExitStack, redirect_stdout
from unittest.mock import MagicMock, patch

import psycopg2

import database
import db_agent
from werkzeug.security import generate_password_hash


SCHEMAS = (
    'department_service.create_schema',
    'role_service.create_schema',
    'ui_settings_service.create_schema',
    'pyq_service.create_pyq_schema',
    'communications_service.create_schema',
    'admin_user_service.create_admin_user_schema',
)


class AppStartupTests(unittest.TestCase):
    def load_app(self, available=False, pyq_failure=False):
        with ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, {
                'Emails': 'admin@example.test',
                'flash_secret': 'startup-test-secret',
            }))
            check = stack.enter_context(patch('database.check_connection', return_value=available))
            tables = stack.enter_context(patch('database.create_tables', return_value=True))
            schemas = {target: stack.enter_context(patch(target)) for target in SCHEMAS}
            if pyq_failure:
                schemas['pyq_service.create_pyq_schema'].side_effect = RuntimeError('Connection lost')
            if 'app' in sys.modules:
                module = importlib.reload(sys.modules['app'])
            else:
                module = importlib.import_module('app')
        module.app.config['TESTING'] = True
        return module, check, tables, schemas

    def test_offline_startup_skips_repeated_connections_and_serves_public_pages(self):
        with self.assertLogs('app', level='WARNING'):
            module, check, tables, schemas = self.load_app()
        check.assert_called_once_with()
        tables.assert_not_called()
        for migration in schemas.values():
            migration.assert_not_called()
        client = module.app.test_client()
        self.assertEqual(client.get('/').status_code, 200)
        self.assertEqual(client.get('/login').status_code, 200)

    def test_database_features_still_report_unavailable_without_fake_results(self):
        with self.assertLogs('app', level='WARNING'):
            module, _, _, _ = self.load_app()
        with patch('db_agent.get_connection', return_value=None), \
                patch('department_service.get_connection', return_value=None), \
                self.assertLogs('app', level='ERROR'):
            response = module.app.test_client().get('/notes')
        self.assertEqual(response.status_code, 503)
        self.assertIn(b'This library is temporarily unavailable.', response.data)

    def test_connection_lost_during_pyq_setup_does_not_stop_the_web_server(self):
        with self.assertLogs('app', level='ERROR'):
            module, _, _, schemas = self.load_app(available=True, pyq_failure=True)
        schemas['pyq_service.create_pyq_schema'].assert_called_once_with()
        schemas['communications_service.create_schema'].assert_called_once_with()
        self.assertEqual(module.app.test_client().get('/').status_code, 200)

    def test_available_database_keeps_all_existing_schema_initialization(self):
        _, check, tables, schemas = self.load_app(available=True)
        check.assert_called_once_with()
        tables.assert_called_once_with()
        for migration in schemas.values():
            migration.assert_called_once_with()

    def test_both_connection_helpers_use_a_finite_wait(self):
        with patch('psycopg2.connect', side_effect=psycopg2.OperationalError('Timed out')) as connect, \
                self.assertLogs('database', level='ERROR'), redirect_stdout(io.StringIO()):
            self.assertIsNone(database.get_connection())
            self.assertIsNone(db_agent.get_connection())
        self.assertEqual(connect.call_count, 2)
        for call in connect.call_args_list:
            self.assertEqual(call.kwargs['connect_timeout'], 5)

    def test_database_failure_is_not_reported_as_an_incorrect_password(self):
        with self.assertLogs('app', level='WARNING'):
            module, _, _, _ = self.load_app()
        client = module.app.test_client()
        with patch('database.get_connection', return_value=None):
            response = client.post('/login', data={
                'crn': '2415262', 'password': 'test-password',
            }, follow_redirects=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Sign-in is temporarily unavailable.', response.data)
        self.assertNotIn(b'Incorrect CRN or password.', response.data)
        with client.session_transaction() as session:
            self.assertNotIn('user', session)
            self.assertNotIn('admin_user', session)

    def test_query_failure_is_a_sign_in_availability_error_and_closes_connection(self):
        connection = MagicMock()
        connection.cursor.return_value.execute.side_effect = psycopg2.OperationalError('Connection lost')
        with patch('database.get_connection', return_value=connection), \
                self.assertLogs('database', level='ERROR'), \
                self.assertRaises(database.LoginUnavailableError):
            database.verify_student_login('2415262', 'test-password')
        connection.cursor.return_value.close.assert_called_once_with()
        connection.close.assert_called_once_with()

    def test_real_password_verification_still_rejects_wrong_credentials(self):
        profile = {'id': 1, 'email': 'student@example.test', 'crn': '2415262',
                   'name': 'Test Student', 'is_banned': False, 'roles': []}
        stored_hash = generate_password_hash('test-password')
        row = tuple(profile.get(column) for column in database.USER_RESULT_COLUMNS) + (stored_hash,)
        connection = MagicMock()
        connection.cursor.return_value.fetchone.return_value = row
        with patch('database.get_connection', return_value=connection):
            self.assertIsNone(database.verify_student_login('2415262', 'wrong-password'))
            user = database.verify_student_login(' 2415262 ', 'test-password')
        self.assertEqual(user['crn'], '2415262')
        self.assertEqual(user['display_name'], 'Test Student')

    def test_missing_account_still_uses_the_normal_credentials_error(self):
        with self.assertLogs('app', level='WARNING'):
            module, _, _, _ = self.load_app()
        connection = MagicMock()
        connection.cursor.return_value.fetchone.return_value = None
        with patch('database.get_connection', return_value=connection):
            response = module.app.test_client().post('/login', data={
                'crn': '2415262', 'password': 'test-password',
            }, follow_redirects=True)
        self.assertIn(b'Incorrect CRN or password.', response.data)
        self.assertNotIn(b'Sign-in is temporarily unavailable.', response.data)

    def test_profile_outage_does_not_log_out_a_verified_student(self):
        with self.assertLogs('app', level='WARNING'):
            module, _, _, _ = self.load_app()
        client = module.app.test_client()
        with client.session_transaction() as session:
            session['user'] = {'email': 'student@example.test', 'name': 'Test Student', 'crn': '2415262'}
            session['is_admin'] = False
        with patch('database.get_connection', return_value=None):
            response = client.get('/dashboard')
        self.assertEqual(response.status_code, 503)
        self.assertIn(b'Your account is temporarily unavailable.', response.data)
        self.assertNotIn(b'Your account could not be loaded. Please sign in again.', response.data)
        with client.session_transaction() as session:
            self.assertEqual(session['user']['crn'], '2415262')
        profile = {'id': 1, 'email': 'student@example.test', 'display_name': 'Test Student',
                   'crn': '2415262', 'is_banned': False, 'role': 'student', 'roles': []}
        module.app.config['DEPARTMENT_LOADER'] = lambda: module.department_service.DEFAULT_DEPARTMENTS
        with patch('app.get_user_by_email', return_value=profile), \
                patch('app.list_warnings', return_value=[]), \
                patch('app.communications_service.announcement', return_value=None), \
                patch('app.ui_settings_service.get_settings', return_value=module.ui_settings_service.DEFAULT_SETTINGS.copy()):
            recovered = client.get('/dashboard')
        self.assertEqual(recovered.status_code, 200, 'Refresh should recover without signing in again')

    def test_absent_profile_still_removes_the_invalid_session(self):
        with self.assertLogs('app', level='WARNING'):
            module, _, _, _ = self.load_app()
        client = module.app.test_client()
        with client.session_transaction() as session:
            session['user'] = {'email': 'missing@example.test', 'crn': '2415262'}
            session['is_admin'] = False
        with patch('app.get_user_by_email', return_value=None):
            response = client.get('/dashboard')
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.location.endswith('/login'))
        with client.session_transaction() as session:
            self.assertNotIn('user', session)


if __name__ == '__main__':
    unittest.main()
