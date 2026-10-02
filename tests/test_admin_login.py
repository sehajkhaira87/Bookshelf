"""Administrator sign-in regressions; OAuth and database calls stay mocked."""
from unittest import TestCase
from unittest.mock import MagicMock, patch

from flask import redirect

from test_pyqs import website


class AdminLoginTests(TestCase):
    def setUp(self):
        self.client = website.app.test_client()
        self.profile = {
            'id': 7,
            'email': 'admin@example.test',
            'display_name': 'Administrator',
            'crn': '123456',
            'is_banned': False,
        }
        self.provider = MagicMock()
        self.provider.authorize_redirect.return_value = redirect('https://accounts.example.test/authorize')
        self.provider.authorize_access_token.return_value = {
            'userinfo': {'email': 'admin@example.test', 'email_verified': True, 'name': 'Administrator'},
        }
        for mocked in (
            patch.dict(website.app.config, TESTING=True, GOOGLE_ADMIN_LOGIN_ENABLED=True),
            patch.object(website, 'google', self.provider),
        ):
            mocked.start()
            self.addCleanup(mocked.stop)
        profile_patch = patch.object(website, 'get_user_by_email', return_value=self.profile)
        self.load_profile = profile_patch.start()
        self.addCleanup(profile_patch.stop)

    def begin_callback(self, intent='admin'):
        with self.client.session_transaction() as session:
            session.clear()
            session['oauth_intent'] = intent

    def assert_rejected(self, response):
        self.assertIn(response.status_code, (302, 303, 400, 403))
        self.assertNotEqual(response.location, '/admin-dashboard')
        with self.client.session_transaction() as session:
            self.assertFalse(session.get('is_admin'))
            self.assertNotIn('admin_user', session)

    def test_admin_gateway_links_to_admin_google_sign_in(self):
        page = self.client.get('/admin')
        self.assertEqual(page.status_code, 200)
        self.assertIn(b'/auth/google?role=admin', page.data)

    def test_google_start_clears_old_identity_and_selects_account(self):
        with self.client.session_transaction() as session:
            session.update(user={'email': 'student@example.test'}, is_admin=True,
                           admin_user={'email': 'admin@example.test'}, _csrf_token='old-token')
        response = self.client.get('/auth/google?role=admin')
        self.assertEqual(response.location, 'https://accounts.example.test/authorize')
        self.provider.authorize_redirect.assert_called_once()
        arguments = self.provider.authorize_redirect.call_args
        self.assertEqual(arguments.kwargs.get('prompt'), 'select_account')
        callback_url = arguments.args[0] if arguments.args else arguments.kwargs.get('redirect_uri')
        self.assertTrue(callback_url.endswith('/callback'))
        with self.client.session_transaction() as session:
            self.assertEqual(session.get('oauth_intent'), 'admin')
            for old_key in ('user', 'admin_user', 'is_admin', '_csrf_token'):
                self.assertNotIn(old_key, session)

    def test_callback_requires_admin_intent_before_contacting_provider(self):
        for intent in (None, 'student', 'ui_editor'):
            with self.subTest(intent=intent):
                with self.client.session_transaction() as session:
                    session.clear()
                    if intent is not None:
                        session['oauth_intent'] = intent
                self.assert_rejected(self.client.get('/callback?role=admin'))
        self.provider.authorize_access_token.assert_not_called()
        self.load_profile.assert_not_called()

    def test_verified_allowlisted_existing_account_signs_in_without_password(self):
        self.begin_callback()
        with self.client.session_transaction() as session:
            session['user'] = {'email': 'student@example.test'}
            session['_csrf_token'] = 'old-token'
        response = self.client.get('/callback')
        self.assertEqual(response.location, '/admin-dashboard')
        self.provider.authorize_access_token.assert_called_once_with()
        self.load_profile.assert_called_once_with('admin@example.test')
        with self.client.session_transaction() as session:
            self.assertTrue(session['is_admin'])
            self.assertEqual(session['admin_user']['email'], 'admin@example.test')
            for old_key in ('oauth_intent', 'user', '_csrf_token'):
                self.assertNotIn(old_key, session)

    def test_verified_admin_email_is_normalized(self):
        self.begin_callback()
        self.provider.authorize_access_token.return_value = {
            'userinfo': {'email': ' ADMIN@EXAMPLE.TEST ', 'email_verified': True},
        }
        response = self.client.get('/callback')
        self.assertEqual(response.location, '/admin-dashboard')
        self.load_profile.assert_called_once_with('admin@example.test')
        with self.client.session_transaction() as session:
            self.assertEqual(session['admin_user']['email'], 'admin@example.test')

    def test_nonallowlisted_identity_cannot_sign_in_as_admin(self):
        self.begin_callback()
        self.provider.authorize_access_token.return_value = {
            'userinfo': {'email': 'student@example.test', 'email_verified': True},
        }
        self.assert_rejected(self.client.get('/callback'))
        self.load_profile.assert_not_called()

    def test_missing_unverified_or_malformed_identity_is_rejected(self):
        tokens = [
            {},
            {'userinfo': {}},
            {'userinfo': {'email_verified': True}},
            {'userinfo': {'email': 'admin@example.test'}},
            {'userinfo': {'email': 'admin@example.test', 'email_verified': False}},
            {'userinfo': {'email': 'admin@example.test', 'email_verified': 'false'}},
        ]
        for token in tokens:
            with self.subTest(token=token):
                self.begin_callback()
                self.provider.authorize_access_token.return_value = token
                self.assert_rejected(self.client.get('/callback'))
        self.load_profile.assert_not_called()

    def test_missing_or_banned_database_account_is_rejected(self):
        for profile in (None, {**self.profile, 'is_banned': True}):
            with self.subTest(profile=profile):
                self.begin_callback()
                self.load_profile.return_value = profile
                self.assert_rejected(self.client.get('/callback'))

    def test_provider_failure_does_not_create_admin_session(self):
        self.begin_callback()
        self.provider.authorize_access_token.side_effect = RuntimeError('Provider unavailable')
        self.assert_rejected(self.client.get('/callback'))
        self.load_profile.assert_not_called()

    def test_authenticated_administrator_returns_to_admin_dashboard(self):
        with self.client.session_transaction() as session:
            session.update(is_admin=True, admin_user={'email': 'admin@example.test'})
        for path in ('/login', '/dashboard', '/admin'):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 302)
                self.assertEqual(response.location, '/admin-dashboard')
        self.load_profile.assert_not_called()

    def test_forged_or_stale_admin_identity_is_not_redirected_to_admin_dashboard(self):
        for identity in (None, {}, {'email': 'student@example.test'}):
            with self.subTest(identity=identity):
                with self.client.session_transaction() as session:
                    session.clear()
                    session['is_admin'] = True
                    if identity is not None:
                        session['admin_user'] = identity
                for path in ('/login', '/dashboard', '/admin'):
                    response = self.client.get(path)
                    self.assertNotEqual(response.location, '/admin-dashboard')

    def test_allowlisted_crn_password_login_still_opens_admin_dashboard(self):
        with patch.object(website, 'verify_student_login', return_value=self.profile) as verify:
            response = self.client.post('/login', data={'crn': '123456', 'password': 'test-password'})
        verify.assert_called_once_with('123456', 'test-password')
        self.assertEqual(response.location, '/admin-dashboard')
        with self.client.session_transaction() as session:
            self.assertTrue(session['is_admin'])
            self.assertEqual(session['admin_user']['email'], 'admin@example.test')
            self.assertNotIn('user', session)

