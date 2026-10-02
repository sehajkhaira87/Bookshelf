"""Appearance authorization, validation and persistence; no live database calls."""
from unittest import TestCase
from unittest.mock import MagicMock, patch

from test_pyqs import website
import ui_settings_service as service


class AppearanceRouteTests(TestCase):
    def setUp(self):
        website.app.config.update(TESTING=True)
        self.client = website.app.test_client()
        self.profile = {'id': 9, 'email': 'editor@example.test', 'role': 'ui_editor',
                        'preferred_name': 'Alex', 'profile_completed': True, 'is_banned': False}
        for module, name, result in [(website, 'get_user_by_email', self.profile),
                                     (service, 'get_settings', dict(service.DEFAULT_SETTINGS))]:
            patched = patch.object(module, name, return_value=result)
            patched.start()
            self.addCleanup(patched.stop)

    def login(self, role='ui_editor', admin=False):
        self.profile['role'] = role
        with self.client.session_transaction() as session:
            session.clear()
            session['_csrf_token'] = 'token'
            if admin:
                session.update(is_admin=True, admin_user={'email': 'admin@example.test'})
            else:
                session['user'] = {'email': self.profile['email'], 'role': 'ui_editor'}

    def test_workspace_is_exclusively_for_assigned_editor(self):
        self.assertEqual(self.client.get('/dashboard/appearance').status_code, 302)
        for role in ('student', 'notification_head', 'user_manager', 'unknown'):
            self.login(role)
            self.assertEqual(self.client.get('/dashboard/appearance').status_code, 403)
        self.login(admin=True)
        self.assertEqual(self.client.get('/dashboard/appearance').status_code, 403)
        self.login()
        page = self.client.get('/dashboard/appearance')
        self.assertEqual(page.status_code, 200)
        self.assertIn(b'Publish appearance', page.data)
        self.assertIn('no-store', page.headers['Cache-Control'])

    def test_banned_revoked_and_missing_profiles_are_denied_immediately(self):
        self.login()
        self.assertEqual(self.client.get('/dashboard/appearance').status_code, 200)
        self.profile['role'] = 'student'
        self.assertEqual(self.client.get('/dashboard/appearance').status_code, 403)
        self.profile.update(role='ui_editor', is_banned=True)
        self.assertEqual(self.client.get('/dashboard/appearance').status_code, 403)
        with patch.object(website, 'get_user_by_email', return_value=None):
            self.assertEqual(self.client.get('/dashboard/appearance').status_code, 403)

    def test_mutations_enforce_role_and_csrf_before_service(self):
        with patch.object(service, 'save_settings') as save, patch.object(service, 'reset_settings') as reset:
            for endpoint in ('/dashboard/appearance/save', '/dashboard/appearance/reset'):
                self.login('student')
                self.assertEqual(self.client.post(endpoint, data={'_csrf_token': 'token'}).status_code, 403)
                self.login()
                self.assertEqual(self.client.post(endpoint).status_code, 400)
            save.assert_not_called()
            reset.assert_not_called()

    def test_save_and_reset_use_authenticated_actor(self):
        self.login()
        payload = {**service.DEFAULT_VALUES, 'palette': 'forest', 'revision': '2', '_csrf_token': 'token', 'updated_by': 'forged@test'}
        with patch.object(service, 'save_settings') as save:
            response = self.client.post('/dashboard/appearance/save', data=payload)
            self.assertEqual(response.status_code, 302)
            self.assertEqual(save.call_args.args[1:], (self.profile['email'], '2'))
            self.assertEqual(save.call_args.args[0]['palette'], 'forest')
        with patch.object(service, 'reset_settings') as reset:
            self.assertEqual(self.client.post('/dashboard/appearance/reset', data=payload).status_code, 302)
            reset.assert_called_once_with(self.profile['email'], '2')

    def test_validation_and_conflict_preserve_escaped_draft_and_old_revision(self):
        self.login()
        payload = {**service.DEFAULT_VALUES, 'dashboard_title': '<script>alert(1)</script>', 'revision': '2', '_csrf_token': 'token'}
        for exception, status in ((ValueError('Bad input'), 400), (service.AppearanceConflict('Reload editor'), 409)):
            with patch.object(service, 'save_settings', side_effect=exception):
                response = self.client.post('/dashboard/appearance/save', data=payload)
                self.assertEqual(response.status_code, status)
                self.assertIn(b'&lt;script&gt;alert(1)&lt;/script&gt;', response.data)
                self.assertNotIn(b'<script>alert(1)</script>', response.data)
                self.assertIn(b'name="revision" value="2"', response.data)

    def test_outage_disables_editor_and_reports_failure(self):
        self.login()
        with patch.object(service, 'get_settings', side_effect=service.AppearanceUnavailable('offline')):
            response = self.client.get('/dashboard/appearance')
            self.assertEqual(response.status_code, 503)
            self.assertIn(b'<fieldset disabled>', response.data)
        with patch.object(service, 'save_settings', side_effect=service.AppearanceUnavailable('offline')):
            response = self.client.post('/dashboard/appearance/save', data={
                **service.DEFAULT_VALUES, 'revision': '0', '_csrf_token': 'token'})
            self.assertEqual(response.status_code, 503)
            self.assertIn(b'could not be saved', response.data)


class AppearanceServiceTests(TestCase):
    def setUp(self):
        self.conn, self.cur = MagicMock(), MagicMock()
        self.conn.cursor.return_value.__enter__.return_value = self.cur
        patched = patch.object(service, 'get_connection', return_value=self.conn)
        patched.start()
        self.addCleanup(patched.stop)

    def test_bounded_options_reject_css_html_and_unknown_values(self):
        for field, value in [('palette', '</style><script>alert(1)</script>'),
                              ('palette', '#000000'), ('card_shape', '999px'),
                              ('density', 'url(https://evil.test)'), ('palette', None),
                              ('dashboard_title', 'x' * 101), ('dashboard_subtitle', ''),
                              ('banner_text', 'x' * 301), ('banner_text', 'line\nnext'),
                              ('dashboard_title', '\x00'), ('dashboard_title', ['not text'])]:
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                service.save_settings({**service.DEFAULT_VALUES, field: value}, 'editor@test', '0')
        self.cur.execute.assert_not_called()

    def test_revision_validation_precedes_database(self):
        for revision in (None, '', '-1', '1.2', 'abc', True, '9223372036854775807'):
            with self.subTest(revision=revision), self.assertRaises(ValueError):
                service.save_settings(service.DEFAULT_VALUES, 'editor@test', revision)
        self.cur.execute.assert_not_called()

    def test_save_uses_parameters_and_optimistic_revision(self):
        self.cur.fetchone.return_value = {'revision': 4}
        values = {**service.DEFAULT_VALUES, 'dashboard_title': "A student's shelf", 'palette': 'ocean'}
        service.save_settings(values, 'editor@test', '3')
        sql, params = self.cur.execute.call_args.args
        self.assertIn('WHERE id=1 AND revision=%s', sql)
        self.assertIn('revision=revision+1', sql)
        self.assertNotIn("A student's shelf", sql)
        self.assertEqual(params, tuple(values[field] for field in service.SETTING_FIELDS) + ('editor@test', 3))
        self.conn.close.assert_called_once()

    def test_stale_save_rolls_back(self):
        self.cur.fetchone.return_value = None
        with self.assertRaises(service.AppearanceConflict):
            service.save_settings(service.DEFAULT_VALUES, 'editor@test', '3')
        self.assertEqual(self.conn.__exit__.call_args.args[0], service.AppearanceConflict)

    def test_read_validates_stored_values_and_uses_fixed_tokens(self):
        self.cur.fetchone.return_value = {**service.DEFAULT_VALUES, 'palette': 'forest', 'revision': 2, 'updated_at': None}
        result = service.get_settings()
        self.assertEqual(result['accent'], service.PALETTES['forest']['accent'])
        self.assertEqual(result['revision'], 2)
        self.cur.fetchone.return_value['palette'] = 'red; background:url(https://evil.test)'
        with self.assertRaises(service.AppearanceUnavailable):
            service.get_settings()

    def test_read_empty_row_returns_independent_defaults(self):
        self.cur.fetchone.return_value = None
        result = service.get_settings()
        self.assertEqual(result, service.DEFAULT_SETTINGS)
        result['palette'] = 'forest'
        self.assertEqual(service.DEFAULT_SETTINGS['palette'], 'classic')

    def test_outage_raises_instead_of_reporting_a_successful_save(self):
        with patch.object(service, 'get_connection', return_value=None):
            with self.assertRaises(service.AppearanceUnavailable):
                service.get_settings()
        self.cur.execute.side_effect = RuntimeError('db error')
        with self.assertRaises(service.AppearanceUnavailable):
            service.save_settings(service.DEFAULT_VALUES, 'editor@test', '0')
        self.conn.close.assert_called_once()

    def test_reset_uses_same_validated_revision_checked_save(self):
        with patch.object(service, 'save_settings') as save:
            service.reset_settings('editor@test', '8')
            save.assert_called_once_with(service.DEFAULT_VALUES, 'editor@test', '8')
