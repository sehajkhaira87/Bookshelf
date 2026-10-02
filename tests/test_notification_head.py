"""Notification head authorization and publishing; every persistence call is mocked."""
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from test_pyqs import website
import communications_service as service
import role_access


class NotificationHeadTests(TestCase):
    def setUp(self):
        website.app.config.update(TESTING=True)
        self.client = website.app.test_client()
        self.profile = dict(id=17, email='head@example.test', preferred_name='Alex',
                            role='notification_head', profile_completed=True, is_banned=False)
        lookup = patch.object(role_access, 'get_user_by_email', return_value=self.profile)
        self.lookup = lookup.start()
        self.addCleanup(lookup.stop)
        for name, value in [('announcement', None), ('history', [])]:
            mocked = patch.object(service, name, return_value=value)
            mocked.start()
            self.addCleanup(mocked.stop)

    def login(self, role='notification_head'):
        self.profile['role'] = role
        with self.client.session_transaction() as session:
            session.clear()
            session['_csrf_token'] = 'token'
            if role == 'admin':
                session.update(is_admin=True, admin_user={'email': 'admin@example.test'})
            else:
                session['user'] = {'email': self.profile['email'], 'role': 'notification_head'}

    def test_workspace_only_for_notification_head(self):
        self.assertEqual(self.client.get('/dashboard/notifications').status_code, 302)
        for role in ('student', 'user_manager', 'ui_editor', 'admin'):
            self.login(role)
            with self.subTest(role=role):
                self.assertEqual(self.client.get('/dashboard/notifications').status_code, 403)
        self.login()
        page = self.client.get('/dashboard/notifications')
        self.assertEqual(page.status_code, 200)
        self.assertIn('no-store', page.headers['Cache-Control'])
        self.assertIn(b'<h1>Notification head</h1>', page.data)
        self.assertIn(b'href="/dashboard"', page.data)
        self.assertIn(b'action="/dashboard/notifications/send"', page.data)
        self.assertIn(b'action="/dashboard/notifications/announcement"', page.data)
        self.assertIn(b'data-search-url="/dashboard/notifications/students"', page.data)
        self.assertNotIn(b'/admin-dashboard', page.data)
        self.assertNotIn(b'UI editor', page.data)
        self.assertNotIn(b'User manager', page.data)

    def test_other_roles_cannot_use_any_notification_management_action(self):
        with patch.object(service, 'save_announcement') as save, \
             patch.object(service, 'send_notification') as send, \
             patch.object(service, 'find_students') as find:
            for role in ('student', 'user_manager', 'ui_editor'):
                self.login(role)
                for base in ('/dashboard/notifications', '/admin/communications'):
                    with self.subTest(role=role, base=base):
                        self.assertEqual(self.client.get(base).status_code, 403)
                        self.assertEqual(self.client.get(base + '/students?q=Alex').status_code, 403)
                        for action in ('send', 'announcement'):
                            self.assertEqual(self.client.post(base + '/' + action,
                                data={'_csrf_token': 'token'}).status_code, 403)
            save.assert_not_called()
            send.assert_not_called()
            find.assert_not_called()

    def test_revoked_role_and_banned_account_are_rejected_immediately(self):
        self.login()
        self.assertEqual(self.client.get('/dashboard/notifications').status_code, 200)
        self.profile['role'] = 'student'
        self.assertEqual(self.client.get('/dashboard/notifications').status_code, 403)
        self.profile.update(role='notification_head', is_banned=True)
        with patch.object(service, 'send_notification') as send:
            self.assertEqual(self.client.post('/dashboard/notifications/send',
                data={'_csrf_token': 'token'}).status_code, 403)
            send.assert_not_called()
        self.lookup.return_value = None
        self.assertEqual(self.client.get('/dashboard/notifications').status_code, 403)

    def test_publish_and_remove_record_real_actor_and_return_to_workspace(self):
        self.login()
        with patch.object(service, 'save_announcement') as save:
            response = self.client.post('/dashboard/notifications/announcement', data={
                '_csrf_token': 'token', 'notice_title': 'Exams', 'notice_body': 'New dates',
                'notice_link': '/pyqs', 'revision': '2', 'created_by': 'forged@example.test'})
            self.assertEqual(response.status_code, 302)
            self.assertTrue(response.location.endswith('/dashboard/notifications'))
            save.assert_called_once_with('Exams', 'New dates', '/pyqs', self.profile['email'], '2')
        with patch.object(service, 'remove_announcement') as remove:
            response = self.client.post('/dashboard/notifications/announcement', data={
                '_csrf_token': 'token', 'action': 'remove', 'revision': '3'})
            self.assertEqual(response.status_code, 302)
            remove.assert_called_once_with(self.profile['email'], '3')

    def test_account_lookup_outage_fails_closed(self):
        self.login()
        self.lookup.side_effect = RuntimeError('Database unavailable')
        with patch.object(service, 'send_notification') as send:
            self.assertEqual(self.client.get('/dashboard/notifications').status_code, 503)
            self.assertEqual(self.client.post('/dashboard/notifications/send',
                data={'_csrf_token': 'token'}).status_code, 503)
            send.assert_not_called()

    def test_send_to_all_or_selected_students_uses_real_actor(self):
        self.login()
        for audience, recipients in [('all', []), ('selected', ['7', '8'])]:
            key = str(uuid4())
            with self.subTest(audience=audience), patch.object(service, 'send_notification', return_value=2) as send:
                response = self.client.post('/dashboard/notifications/send', data={
                    '_csrf_token': 'token', 'title': 'Update', 'body': 'New material',
                    'link_url': '/notes', 'audience': audience, 'recipients': recipients,
                    'request_key': key, 'created_by': 'forged@example.test'})
                self.assertEqual(response.status_code, 302)
                self.assertTrue(response.location.endswith('/dashboard/notifications'))
                send.assert_called_once_with('Update', 'New material', '/notes', audience, recipients,
                    self.profile['email'], key, website.ADMIN_EMAILS)

    def test_csrf_required_for_each_mutation_url(self):
        self.login()
        with patch.object(service, 'save_announcement') as save, patch.object(service, 'send_notification') as send:
            for base in ('/dashboard/notifications', '/admin/communications'):
                for action in ('send', 'announcement'):
                    self.assertEqual(self.client.post(base + '/' + action).status_code, 400)
            save.assert_not_called()
            send.assert_not_called()

    def test_recipient_search_and_failed_send_stay_in_role_workspace(self):
        self.login()
        with patch.object(service, 'find_students', return_value=[{'id': 7, 'name': 'Alex'}]) as find:
            response = self.client.get('/dashboard/notifications/students?q=Alex')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json['items'][0]['id'], 7)
            self.assertIn('no-store', response.headers['Cache-Control'])
            find.assert_called_once_with('Alex', website.ADMIN_EMAILS)
        key = str(uuid4())
        with patch.object(service, 'send_notification', side_effect=ValueError('Select students')):
            response = self.client.post('/dashboard/notifications/send', data={
                '_csrf_token': 'token', 'title': '<Draft>', 'body': 'Keep my message',
                'audience': 'selected', 'recipients': ['7'], 'request_key': key})
        self.assertEqual(response.status_code, 400)
        self.assertIn(b'&lt;Draft&gt;', response.data)
        self.assertIn(b'Keep my message', response.data)
        self.assertIn(key.encode(), response.data)
        self.assertIn(b'action="/dashboard/notifications/send"', response.data)

    def test_admin_retains_legacy_workspace_without_head_section(self):
        self.login('admin')
        self.assertEqual(self.client.get('/admin/communications').status_code, 200)
        for suffix in ('', '/students'):
            self.assertEqual(self.client.get('/dashboard/notifications' + suffix).status_code, 403)
        with patch.object(service, 'send_notification') as send:
            self.assertEqual(self.client.post('/dashboard/notifications/send',
                data={'_csrf_token': 'token'}).status_code, 403)
            send.assert_not_called()
