"""Integrated role assignment, dashboard visibility, and revocation checks."""
from unittest import TestCase
from unittest.mock import MagicMock, patch

from test_pyqs import website
import role_access
import role_routes
import role_service
import ui_settings_service


class RoleIntegrationTests(TestCase):
    def setUp(self):
        self.client = website.app.test_client()
        website.app.config.update(TESTING=True)
        self.profile = dict(id=20, email='staff@example.test', preferred_name='Sam',
                            role='student', is_banned=False, profile_completed=True)
        for module, name, value in (
            (website, 'get_user_by_email', self.profile),
            (website, 'list_warnings', []),
            (website.communications_service, 'announcement', None),
            (website.communications_service, 'history', []),
            (ui_settings_service, 'get_settings', ui_settings_service.DEFAULT_SETTINGS.copy()),
        ):
            mocked = patch.object(module, name, return_value=value)
            mocked.start()
            self.addCleanup(mocked.stop)
        self.login()

    def login(self, admin=False):
        with self.client.session_transaction() as session:
            session.clear()
            session['_csrf_token'] = 'token'
            if admin:
                session.update(is_admin=True, admin_user={'email': 'admin@example.test'})
            else:
                session['user'] = {'email': self.profile['email'], 'name': 'Sam'}

    def test_only_assigned_workspace_is_rendered_on_dashboard(self):
        links = {'notification_head': b'/dashboard/notifications',
                 'user_manager': b'/dashboard/users', 'ui_editor': b'/dashboard/appearance'}
        for role in ['student', *links]:
            self.profile['role'] = role
            response = self.client.get('/dashboard')
            self.assertEqual(response.status_code, 200)
            self.assertIn('no-store', response.headers['Cache-Control'])
            for target, link in links.items():
                if target == role:
                    self.assertIn(link, response.data)
                else:
                    self.assertNotIn(link, response.data)
            self.assertIn(b'notificationBell', response.data)

    def test_role_change_and_ban_take_effect_without_new_login(self):
        self.profile['role'] = 'notification_head'
        self.assertEqual(self.client.get('/dashboard/notifications').status_code, 200)
        self.profile['role'] = 'ui_editor'
        self.assertEqual(self.client.get('/dashboard/notifications').status_code, 403)
        self.assertEqual(self.client.get('/dashboard/appearance').status_code, 200)
        self.profile['is_banned'] = True
        self.assertEqual(self.client.get('/dashboard/appearance').status_code, 403)

    def test_role_and_admin_flags_in_student_session_do_not_escalate(self):
        with self.client.session_transaction() as session:
            session.update(role='ui_editor', is_admin=True, admin_user={'email': self.profile['email']})
        self.assertEqual(self.client.get('/dashboard/appearance').status_code, 403)
        self.assertEqual(self.client.get('/admin/roles').status_code, 302)
        self.assertEqual(self.client.get('/admin').status_code, 200)

    def test_saved_appearance_is_visible_and_escaped_on_student_dashboard(self):
        settings = {**ui_settings_service.DEFAULT_SETTINGS, 'dashboard_title': '<em>Study together</em>',
                    'dashboard_subtitle': 'Find your next read.', 'banner_text': '<script>test</script>',
                    'accent': '#34634a'}
        with patch.object(ui_settings_service, 'get_settings', return_value=settings):
            page = self.client.get('/dashboard')
        self.assertEqual(page.status_code, 200)
        self.assertIn(b'&lt;em&gt;Study together&lt;/em&gt;', page.data)
        self.assertIn(b'Find your next read.', page.data)
        self.assertIn(b'&lt;script&gt;test&lt;/script&gt;', page.data)
        self.assertIn(b'--site-accent: #34634a', page.data)
        self.assertNotIn(b'<script>test</script>', page.data)

    def test_every_other_role_is_denied_each_management_section(self):
        urls = {'notification_head': '/dashboard/notifications',
                'user_manager': '/dashboard/users', 'ui_editor': '/dashboard/appearance'}
        for role in ['student', *urls]:
            self.profile['role'] = role
            for required, path in urls.items():
                if role != required:
                    self.assertEqual(self.client.get(path).status_code, 403, (role, path))
        self.login(admin=True)
        for path in urls.values():
            self.assertEqual(self.client.get(path).status_code, 403)

    def test_only_administrator_can_assign_roles_with_csrf(self):
        with patch.object(role_service, 'assign_role', return_value=True) as assign:
            for role in role_access.ROLE_LABELS:
                self.profile['role'] = role
                self.assertEqual(self.client.post('/admin/users/20/role', data={
                    'role': 'ui_editor', '_csrf_token': 'token'}).status_code, 302)
            assign.assert_not_called()
            self.login(admin=True)
            self.assertEqual(self.client.post('/admin/users/20/role', data={'role': 'ui_editor'}).status_code, 400)
            assign.assert_not_called()
            response = self.client.post('/admin/users/20/role', data={
                'role': 'ui_editor', '_csrf_token': 'token', 'actor': 'forged'})
            self.assertEqual(response.status_code, 302)
            assign.assert_called_once_with(20, 'ui_editor', 'admin@example.test', website.ADMIN_EMAILS)

    def test_administrator_can_find_and_remove_roles(self):
        self.login(admin=True)
        with patch.object(role_routes, 'search_users', return_value=[self.profile]):
            page = self.client.get('/admin/roles')
        self.assertEqual(page.status_code, 200)
        for label in role_access.ROLE_LABELS.values():
            self.assertIn(label.encode(), page.data)

    def test_login_never_accepts_role_from_form(self):
        with patch.object(website, 'verify_student_login', return_value=self.profile):
            response = self.client.post('/login', data={'crn': '123456', 'password': 'example', 'role': 'ui_editor'})
        self.assertEqual(response.location, '/dashboard')
        self.assertEqual(self.client.get('/dashboard/appearance').status_code, 403)


class RolePersistenceTests(TestCase):
    def connection(self, row):
        conn, cursor = MagicMock(), MagicMock()
        conn.cursor.return_value.__enter__.return_value = cursor
        cursor.fetchone.return_value = row
        return conn, cursor

    def test_assignment_is_transactional_and_audited(self):
        conn, cursor = self.connection(('staff@example.test', 'student', [], False))
        with patch.object(role_service, 'get_connection', return_value=conn):
            self.assertTrue(role_service.assign_role(20, 'user_manager', ' ADMIN@example.test ', {'admin@example.test'}))
        self.assertIn('FOR UPDATE', cursor.execute.call_args_list[0].args[0])
        self.assertEqual(cursor.execute.call_args_list[1].args[1], (['user_manager'], 'user_manager', 20))
        self.assertEqual(cursor.execute.call_args_list[2].args[1],
                         (20, 'student', 'user_manager', 'admin@example.test', [], ['user_manager']))
        conn.close.assert_called_once()

    def test_invalid_roles_and_nonadmin_actors_never_connect(self):
        with patch.object(role_service, 'get_connection') as connect:
            for role, actor in [('admin', 'admin@example.test'), ('ui_editor', 'student@example.test'),
                                ('<script>', 'admin@example.test'), (None, 'admin@example.test')]:
                with self.assertRaises(ValueError):
                    role_service.assign_role(20, role, actor, {'admin@example.test'})
            connect.assert_not_called()

    def test_administrators_and_banned_accounts_cannot_receive_staff_roles(self):
        for row in [(' ADMIN@example.test ', 'student', [], False), ('staff@example.test', 'student', [], True)]:
            conn, cursor = self.connection(row)
            with patch.object(role_service, 'get_connection', return_value=conn), self.assertRaises(ValueError):
                role_service.assign_role(20, 'notification_head', 'admin@example.test', {'admin@example.test'})
            self.assertEqual(cursor.execute.call_count, 1)

    def test_banned_staff_access_can_still_be_revoked(self):
        conn, cursor = self.connection(('staff@example.test', 'notification_head', ['notification_head'], True))
        with patch.object(role_service, 'get_connection', return_value=conn):
            self.assertTrue(role_service.assign_role(20, 'student', 'admin@example.test', {'admin@example.test'}))
        self.assertEqual(cursor.execute.call_args_list[1].args[1], ([], 'student', 20))
