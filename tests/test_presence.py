"""Active student tracking and admin-only visibility; all database calls mocked."""
from datetime import datetime, timezone
from unittest import TestCase
from unittest.mock import MagicMock, patch

from test_pyqs import website
import communications_routes as routes
import communications_service
import presence_service as service


class PresenceTests(TestCase):
    def setUp(self):
        website.app.config.update(TESTING=True)
        self.client = website.app.test_client()
        self.profile = dict(id=7, email='alex@example.test', preferred_name='Alex',
                            profile_completed=True, is_banned=False)

    def login(self, admin=False):
        with self.client.session_transaction() as session:
            session.clear()
            session['_csrf_token'] = 'token'
            if admin:
                session.update(is_admin=True, admin_user={'email': 'admin@example.test'})
            else:
                session['user'] = {'email': self.profile['email']}

    def test_active_list_requires_admin(self):
        with patch.object(service, 'active_students', return_value={'total': 1, 'items': [], 'window_minutes': 5}) as active:
            self.assertEqual(self.client.get('/api/admin/active-students').status_code, 302)
            self.login()
            self.assertEqual(self.client.get('/api/admin/active-students').status_code, 302)
            active.assert_not_called()
            self.login(admin=True)
            response = self.client.get('/api/admin/active-students')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json['total'], 1)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            active.assert_called_once_with(website.ADMIN_EMAILS)

    def test_heartbeat_requires_auth_csrf_and_uses_current_user(self):
        with patch.object(service, 'record_activity') as record, \
             patch.object(routes, 'get_user_by_email', return_value=self.profile):
            self.assertEqual(self.client.post('/api/activity').status_code, 401)
            self.login()
            self.assertEqual(self.client.post('/api/activity').status_code, 400)
            record.assert_not_called()
            response = self.client.post('/api/activity', data={'_csrf_token': 'token', 'user_id': '99'})
            self.assertEqual(response.status_code, 204)
            record.assert_called_once_with(7, website.ADMIN_EMAILS)

    def test_banned_students_cannot_report_activity(self):
        self.login()
        with patch.object(routes, 'get_user_by_email', return_value=dict(self.profile, is_banned=True)), \
             patch.object(service, 'record_activity') as record:
            self.assertEqual(self.client.post('/api/activity', data={'_csrf_token': 'token'}).status_code, 403)
            record.assert_not_called()

    def test_active_query_uses_expiry_and_excludes_admins_and_bans(self):
        conn, cur = MagicMock(), MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur
        cur.fetchone.return_value = {'total': 80}
        cur.fetchall.return_value = [dict(id=7, name='Alex', last_seen_at=datetime.now(timezone.utc))]
        with patch.object(communications_service, 'get_connection', return_value=conn):
            result = service.active_students(['admin@example.test'])
        self.assertEqual(result['total'], 80)
        self.assertIsInstance(result['items'][0]['last_seen_at'], str)
        for call in cur.execute.call_args_list:
            sql, params = call.args
            self.assertIn("INTERVAL '5 minutes'", sql)
            self.assertIn('is_banned=FALSE', sql)
            self.assertIn('NOT (LOWER(email)=ANY(%s))', sql)
            self.assertEqual(params, (['admin@example.test'],))
        self.assertIn('LIMIT 50', cur.execute.call_args.args[0])
        conn.close.assert_called_once()

    def test_multiple_tab_heartbeats_throttle_writes_without_changing_profile_time(self):
        conn, cur = MagicMock(), MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur
        with patch.object(communications_service, 'get_connection', return_value=conn):
            service.record_activity(7, ['admin@example.test'])
        sql, params = cur.execute.call_args.args
        self.assertIn("INTERVAL '30 seconds'", sql)
        self.assertIn('last_seen_at IS NULL', sql)
        self.assertNotIn('updated_at', sql)
        self.assertEqual(params, (7, ['admin@example.test']))

    def test_signed_in_resource_pages_include_tracking_but_guests_do_not(self):
        with patch.object(website, 'get_resource_catalogue', return_value=([], 0)):
            self.assertNotIn(b'student-activity.js', self.client.get('/notes').data)
            self.login()
            for endpoint in ('notes', 'books', 'assignments', 'contribute'):
                response = self.client.get('/' + endpoint)
                self.assertIn(b'student-activity.js', response.data)
                self.assertIn(b'data-endpoint="/api/activity"', response.data)

    def test_presence_outage_is_not_reported_as_zero_students(self):
        self.login(admin=True)
        with patch.object(service, 'active_students', side_effect=RuntimeError('offline')):
            response = self.client.get('/api/admin/active-students')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('total', response.json)
