"""Communications regression tests; no real database changes or notifications."""
from datetime import datetime, timezone
from unittest import TestCase
from unittest.mock import MagicMock, patch
from uuid import uuid4

from test_pyqs import website
import communications_service as service
import communications_routes as routes
import role_access


class CommunicationRouteTests(TestCase):
    def setUp(self):
        website.app.config.update(TESTING=True)
        self.client = website.app.test_client()
        self.profile = dict(id=7, email='student@example.test', preferred_name='Alex',
                            profile_completed=True, is_banned=False)
        appearance = patch.object(website.ui_settings_service, 'get_settings',
                                  return_value=website.ui_settings_service.DEFAULT_SETTINGS.copy())
        appearance.start()
        self.addCleanup(appearance.stop)
        for module, name, result in [(routes, 'get_user_by_email', self.profile),
                                     (role_access, 'get_user_by_email', self.profile),
                                     (service, 'announcement', None), (service, 'history', [])]:
            mocked = patch.object(module, name, return_value=result)
            mocked.start(); self.addCleanup(mocked.stop)

    def login(self, admin=False):
        with self.client.session_transaction() as session:
            session.clear()
            session['_csrf_token'] = 'token'
            if admin:
                session.update(is_admin=True, admin_user={'email': 'admin@example.test'})
            else:
                session['user'] = {'email': self.profile['email'], 'picture': 'https://example.test/avatar.png'}

    def test_admin_only_and_csrf_for_all_mutations(self):
        for endpoint in ('/admin/communications', '/admin/communications/students'):
            self.assertEqual(self.client.get(endpoint).status_code, 302)
        with patch.object(service, 'send_notification') as send, patch.object(service, 'save_announcement') as save:
            for endpoint in ('/admin/communications/send', '/admin/communications/announcement'):
                self.login()
                self.assertEqual(self.client.post(endpoint, data={'_csrf_token': 'token'}).status_code, 403)
                self.login(admin=True)
                self.assertEqual(self.client.post(endpoint).status_code, 400)
            send.assert_not_called(); save.assert_not_called()

    def test_publish_remove_and_escape_announcement(self):
        self.login(admin=True)
        with patch.object(service, 'save_announcement') as save:
            response = self.client.post('/admin/communications/announcement', data={
                '_csrf_token': 'token', 'notice_title': 'Exam update', 'notice_body': 'Read this',
                'notice_link': '/pyqs', 'revision': '0'})
            self.assertEqual(response.status_code, 302)
            self.assertEqual(response.location, '/admin/communications')
            save.assert_called_once_with('Exam update', 'Read this', '/pyqs', 'admin@example.test', '0')
        with patch.object(service, 'remove_announcement') as remove:
            response = self.client.post('/admin/communications/announcement', data={'_csrf_token': 'token', 'action': 'remove', 'revision': '1'})
            self.assertEqual(response.location, '/admin/communications')
            remove.assert_called_once_with('admin@example.test', '1')
        self.login()
        with patch.object(website, 'get_user_by_email', return_value=self.profile), \
             patch.object(website, 'list_warnings', return_value=[]), \
             patch.object(website, 'get_pyq_summary', return_value=None), \
             patch.object(service, 'announcement', return_value=dict(title='<b>Title</b>', body='Official body', link_url='/notes')):
            page = self.client.get('/dashboard')
            self.assertIn(b'Official announcement', page.data)
            self.assertIn(b'&lt;b&gt;Title&lt;/b&gt;', page.data)
            self.assertIn(b'https://example.test/avatar.png', page.data)
            self.assertIn(b'notificationBell', page.data)
            self.assertNotIn(b'Shared study library', page.data)
        with patch.object(website, 'get_user_by_email', return_value=self.profile), \
             patch.object(website, 'list_warnings', return_value=[]), patch.object(website, 'get_pyq_summary', return_value=None):
            self.assertNotIn(b'officialAnnouncementTitle', self.client.get('/dashboard').data)

    def test_admin_form_and_search(self):
        self.login(admin=True)
        page = self.client.get('/admin/communications')
        self.assertEqual(page.status_code, 200)
        self.assert_admin_workspace(page)
        self.assertIn(b'Selected students', page.data)
        with patch.object(service, 'find_students', return_value=[{'id': 7, 'name': 'Alex'}]) as find:
            response = self.client.get('/admin/communications/students?q=Alex')
            self.assertEqual(response.json['items'][0]['id'], 7)
            find.assert_called_once_with('Alex', website.ADMIN_EMAILS)

    def assert_admin_workspace(self, response):
        self.assertIn(b'aria-label="Admin navigation"', response.data)
        self.assertIn(b'href="/admin-dashboard"', response.data)
        self.assertIn(b'action="/admin/communications/announcement"', response.data)
        self.assertIn(b'action="/admin/communications/send"', response.data)
        self.assertIn(b'data-search-url="/admin/communications/students"', response.data)
        self.assertNotIn(b'/dashboard/notifications', response.data)
        self.assertNotIn(b'href="/contribute"', response.data)

    def test_admin_errors_keep_admin_navigation_and_form_actions(self):
        self.login(admin=True)
        for endpoint, method in [('announcement', 'save_announcement'), ('send', 'send_notification')]:
            for error, status in [(ValueError('Check the form'), 400), (RuntimeError('offline'), 503)]:
                with self.subTest(endpoint=endpoint, status=status), patch.object(service, method, side_effect=error):
                    response = self.client.post('/admin/communications/' + endpoint,
                                                data={'_csrf_token': 'token'})
                self.assertEqual(response.status_code, status)
                self.assert_admin_workspace(response)
        with patch.object(service, 'history', side_effect=RuntimeError('offline')):
            response = self.client.get('/admin/communications')
        self.assertEqual(response.status_code, 503)
        self.assert_admin_workspace(response)

    def test_crn_login_uses_verified_identity_and_safe_default_avatar(self):
        profile = {**self.profile, 'display_name': 'Alex', 'crn': '123456'}
        with patch.object(website, 'verify_student_login', return_value=profile) as verify:
            response = self.client.post('/login', data={'crn': '123456', 'password': 'test-password',
                'email': 'forged@example.test', 'picture': 'javascript:bad', 'role': 'notification_head'})
        verify.assert_called_once_with('123456', 'test-password')
        self.assertEqual(response.location, '/dashboard')
        with self.client.session_transaction() as session:
            self.assertEqual(session['user']['email'], self.profile['email'])
            self.assertEqual(session['user']['picture'], '')
            self.assertNotIn('role', session['user'])
            self.assertFalse(session['is_admin'])

    def test_send_uses_authenticated_actor_and_selected_ids(self):
        self.login(admin=True)
        key = str(uuid4())
        with patch.object(service, 'send_notification', return_value=2) as send:
            response = self.client.post('/admin/communications/send', data={
                '_csrf_token': 'token', 'title': 'Title', 'body': 'Message', 'link_url': '/notes',
                'audience': 'selected', 'recipients': ['7', '8'], 'request_key': key, 'created_by': 'forged'})
            self.assertEqual(response.status_code, 302)
            self.assertEqual(response.location, '/admin/communications')
            send.assert_called_once_with('Title', 'Message', '/notes', 'selected', ['7', '8'],
                                        'admin@example.test', key, website.ADMIN_EMAILS)

    def test_validation_preserves_composed_message_and_retry_key(self):
        self.login(admin=True)
        key = str(uuid4())
        with patch.object(service, 'send_notification', side_effect=ValueError('Select students')):
            response = self.client.post('/admin/communications/send', data={'_csrf_token': 'token',
                'title': '<Draft>', 'body': 'Keep my message', 'audience': 'selected', 'recipients': ['7'], 'request_key': key})
        self.assertEqual(response.status_code, 400)
        self.assertIn(b'&lt;Draft&gt;', response.data)
        self.assertIn(b'Keep my message', response.data)
        self.assertIn(key.encode(), response.data)
        self.assert_admin_workspace(response)

    def test_inbox_requires_active_student_and_ignores_forged_user_id(self):
        self.assertEqual(self.client.get('/api/notifications').status_code, 401)
        self.login()
        with patch.object(service, 'inbox', return_value={'items': [], 'unread_count': 0, 'next_before': None}) as inbox:
            response = self.client.get('/api/notifications?user_id=999&before=30')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            inbox.assert_called_once_with(7, 30)
        with patch.object(routes, 'get_user_by_email', return_value=dict(self.profile, is_banned=True)):
            self.assertEqual(self.client.get('/api/notifications').status_code, 403)
        for value in ('bad', '0', '-1', '999999999999999999999999'):
            self.assertEqual(self.client.get('/api/notifications?before=' + value).status_code, 400)

    def test_read_scoped_to_current_student_and_csrf(self):
        self.login()
        with patch.object(service, 'mark_read', return_value=False) as mark:
            self.assertEqual(self.client.post('/api/notifications/9/read').status_code, 400)
            mark.assert_not_called()
            response = self.client.post('/api/notifications/9/read', data={'_csrf_token': 'token', 'user_id': '999'})
            self.assertEqual(response.status_code, 404)
            mark.assert_called_once_with(7, notification_id=9)
        with patch.object(service, 'mark_read', return_value=True) as mark:
            response = self.client.post('/api/notifications/read-all', data={'_csrf_token': 'token', 'through': '25'})
            self.assertEqual(response.status_code, 200)
            mark.assert_called_once_with(7, through=25)

    def test_inbox_outage_is_reported(self):
        self.login()
        with patch.object(service, 'inbox', side_effect=RuntimeError('offline')):
            self.assertEqual(self.client.get('/api/notifications').status_code, 503)


class CommunicationServiceTests(TestCase):
    def setUp(self):
        self.conn, self.cur = MagicMock(), MagicMock()
        self.conn.cursor.return_value.__enter__.return_value = self.cur
        patcher = patch.object(service, 'get_connection', return_value=self.conn)
        patcher.start(); self.addCleanup(patcher.stop)
        self.key = str(uuid4())

    def test_link_and_content_validation(self):
        for link in ('javascript:alert(1)', '//evil.test', '/\\evil.test', 'data:text/html,bad', 'https://u:p@example.test', '/\n/evil'):
            with self.subTest(link=link), self.assertRaises(ValueError):
                service.valid_link(link)
        for link in ('', '/notes?q=test', 'https://example.test/notice'):
            self.assertEqual(service.valid_link(link), link)
        for title, body in [('', 'body'), ('t'*161, 'body'), ('Title', 'b'*2001), ('Title', '\x00')]:
            with self.assertRaises(ValueError): service.content(title, body, '')

    def test_all_students_send_uses_atomic_database_snapshot(self):
        self.cur.fetchone.return_value = {'id': 10}
        self.cur.rowcount = 21
        self.assertEqual(service.send_notification('Title', 'Message', '', 'all', [], 'admin', self.key, ['admin@test']), 21)
        sql, params = self.cur.execute.call_args.args
        self.assertIn('SELECT %s, id FROM users WHERE is_banned=FALSE', sql)
        self.assertIn('LOWER(email)=ANY(%s)', sql)
        self.assertEqual(params, (10, ['admin@test']))
        self.conn.close.assert_called_once()

    def test_selected_send_deduplicates_and_rolls_back_invalid_recipients(self):
        self.cur.fetchone.return_value = {'id': 10}
        self.cur.rowcount = 2
        service.send_notification('Title', 'Message', '', 'selected', ['7', '7', '8'], 'admin', self.key, [])
        self.assertEqual(self.cur.execute.call_args.args[1], (10, [], [7, 8]))
        self.cur.rowcount = 1
        with self.assertRaises(ValueError):
            service.send_notification('Title', 'Message', '', 'selected', ['7', '8'], 'admin', self.key, [])
        self.assertEqual(self.conn.__exit__.call_args.args[0], ValueError)

    def test_duplicate_send_does_not_insert_recipients_again(self):
        self.cur.fetchone.side_effect = [None, {'total': 2}]
        self.assertEqual(service.send_notification('Title', 'Message', '', 'all', [], 'admin', self.key, []), 2)
        self.assertEqual(self.cur.execute.call_count, 2)
        self.assertNotIn('INSERT INTO student_notification_recipients', self.cur.execute.call_args.args[0])

    def test_no_recipients_or_invalid_audience_rejected(self):
        for audience, recipients in [('selected', []), ('selected', ['bad']), ('selected', ['0']), ('other', [])]:
            with self.assertRaises(ValueError):
                service.send_notification('Title', 'Message', '', audience, recipients, 'admin', self.key, [])
        self.cur.execute.assert_not_called()

    def test_inbox_pagination_and_read_ownership(self):
        now = datetime.now(timezone.utc)
        self.cur.fetchone.return_value = {'total': 25}
        self.cur.fetchall.return_value = [dict(id=i, created_at=now, read_at=None) for i in range(40, 19, -1)]
        result = service.inbox(7, 41)
        self.assertEqual(len(result['items']), 20)
        self.assertEqual(result['next_before'], 21)
        self.assertEqual(result['unread_count'], 25)
        self.assertEqual(self.cur.execute.call_args.args[1], (7, 41))
        service.mark_read(7, notification_id=5)
        self.assertIn('WHERE user_id=%s AND notification_id=%s', self.cur.execute.call_args.args[0])
        self.assertEqual(self.cur.execute.call_args.args[1], (7, 5))
        service.mark_read(7, through=40)
        self.assertIn('notification_id<=%s', self.cur.execute.call_args.args[0])

    def test_announcement_conflicts_and_hidden_state(self):
        self.cur.fetchone.return_value = None
        with self.assertRaises(ValueError): service.save_announcement('Title', 'Body', '', 'admin', 1)
        with self.assertRaises(ValueError): service.remove_announcement('admin', 1)
        self.cur.fetchone.return_value = dict(title='Title', active=False, revision=2)
        self.assertIsNone(service.announcement())
        self.assertEqual(service.announcement(include_hidden=True)['revision'], 2)

    def test_schema_is_additive_and_repeatable(self):
        service.create_schema()
        sql = self.cur.execute.call_args.args[0]
        self.assertIn('CREATE TABLE IF NOT EXISTS', sql)
        self.assertIn('ON CONFLICT DO NOTHING', sql)
        self.assertNotIn('DROP ', sql)
