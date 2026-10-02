"""Contributor recognition is assigned only by administrators."""
from unittest import TestCase
from unittest.mock import MagicMock, patch

from test_pyqs import website
import admin_user_service as service
import database


class ContributorBadgeTests(TestCase):
    def setUp(self):
        website.app.config.update(TESTING=True)
        self.client = website.app.test_client()
        appearance = patch.object(website.ui_settings_service, 'get_settings',
                                  return_value=website.ui_settings_service.DEFAULT_SETTINGS.copy())
        appearance.start()
        self.addCleanup(appearance.stop)

    def admin(self):
        with self.client.session_transaction() as session:
            session.update(is_admin=True, admin_user={'email': 'admin@example.test'}, _csrf_token='token')

    def test_badge_assignment_requires_admin_and_csrf(self):
        with patch.object(website, 'set_contributor_badge') as assign:
            self.assertEqual(self.client.post('/admin/users/7/badge', data={'badge': 'trusted'}).status_code, 302)
            with self.client.session_transaction() as session:
                session.update(user={'email': 'student@example.test'}, _csrf_token='token')
            self.assertEqual(self.client.post('/admin/users/7/badge', data={'badge': 'trusted', '_csrf_token': 'token'}).status_code, 302)
            self.admin()
            self.assertEqual(self.client.post('/admin/users/7/badge', data={'badge': 'trusted'}).status_code, 400)
            assign.assert_not_called()

    def test_admin_can_assign_change_and_remove_badge(self):
        self.admin()
        with patch.object(website, 'set_contributor_badge', return_value=True) as assign:
            for badge in ('trusted', 'best_contributor', ''):
                response = self.client.post('/admin/users/7/badge', data={'badge': badge, '_csrf_token': 'token', 'q': 'Alex'})
                self.assertEqual(response.status_code, 302)
                self.assertIn('panel=users', response.location)
                self.assertIn('q=Alex', response.location)
                self.assertEqual(assign.call_args.args, (7, badge))

    def test_assignment_changes_recognition_only_and_cannot_grant_admin(self):
        conn, cur = MagicMock(), MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur
        cur.fetchone.return_value = (7,)
        with patch.object(service, '_open_connection', return_value=conn) as connect:
            for badge in ('admin', 'official', None, '<script>'):
                with self.assertRaises(service.AdminUserValidationError):
                    service.set_contributor_badge(7, badge)
            connect.assert_not_called()
            self.assertTrue(service.set_contributor_badge(7, 'trusted'))
        sql, params = cur.execute.call_args.args
        self.assertEqual(params, ('trusted', 7))
        self.assertIn('contributor_badge=%s', sql)
        self.assertNotIn('email=', sql)
        self.assertNotIn('is_admin', sql)
        conn.close.assert_called_once()

    def test_nonexistent_student_is_not_reported_as_success(self):
        self.admin()
        with patch.object(website, 'set_contributor_badge', return_value=False):
            self.client.post('/admin/users/999/badge', data={'badge': 'trusted', '_csrf_token': 'token'})
        with self.client.session_transaction() as session:
            self.assertIn(('error', 'User not found.'), session['_flashes'])

    def test_catalogue_badges_use_recorded_assignment_and_admin_takes_precedence(self):
        base = dict(title='Notes', branch='cse', semester=2, file_size=100,
                    blob_url='https://example.test/paper.pdf', uploaded_by='student@example.test', contributor_name='Alex')
        for endpoint in ('notes', 'assignments', 'books'):
            for badge, expected in [('trusted', b'contributor-badge-trusted'), ('best_contributor', b'contributor-badge-best'), ('', None), ('admin', None)]:
                with patch.object(website, 'get_resource_catalogue', return_value=([dict(base, contributor_badge=badge)], 1)):
                    page = self.client.get('/' + endpoint)
                    if expected: self.assertIn(expected, page.data)
                    else: self.assertNotIn(b'class="contributor-badge ', page.data)
                    self.assertNotIn(b'class="admin-upload-badge"', page.data)
            with patch.object(website, 'get_resource_catalogue', return_value=([
                dict(base, uploaded_by='admin@example.test', contributor_badge='best_contributor')], 1)):
                page = self.client.get('/' + endpoint)
                self.assertIn(b'class="admin-upload-badge"', page.data)
                self.assertNotIn(b'class="contributor-badge ', page.data)

    def test_user_database_contains_badge_controls_and_current_selection(self):
        self.admin()
        user = dict(id=7, preferred_name='Alex', google_name='Alex Singh', email='alex@example.test',
                    contributor_badge='trusted', is_banned=False)
        with patch.object(website, 'get_resources', return_value=[]), \
             patch.object(website, 'get_resource_stats', return_value={}), \
             patch.object(website, 'get_pyq_summary', return_value={'total': 0}), \
             patch.object(website, 'search_users', return_value=[user]), \
             patch.object(website, 'list_warnings_for_users', return_value={}):
            page = self.client.get('/admin-dashboard?panel=users')
        self.assertEqual(page.status_code, 200)
        self.assertIn(b'action="/admin/users/7/badge"', page.data)
        self.assertIn(b'value="trusted" selected', page.data)
        self.assertIn(b'No badge', page.data)
        self.assertIn(b'Best Contributor', page.data)

    def test_dashboard_uses_current_database_badge_and_removal_hides_it(self):
        with self.client.session_transaction() as session:
            session['user'] = {'email': 'alex@example.test', 'contributor_badge': 'trusted'}
        profile = dict(id=7, email='alex@example.test', preferred_name='Alex',
                       is_banned=False, profile_completed=True)
        with patch.object(website, 'get_user_by_email') as read, \
             patch.object(website, 'list_warnings', return_value=[]), \
             patch.object(website.communications_service, 'announcement', return_value=None):
            for badge, expected in [('trusted', b'contributor-badge-trusted'),
                                    ('best_contributor', b'contributor-badge-best'), ('', None), ('admin', None)]:
                read.return_value = dict(profile, contributor_badge=badge)
                page = self.client.get('/dashboard')
                self.assertEqual(page.status_code, 200)
                if expected:
                    self.assertIn(expected, page.data)
                    self.assertIn(b'profile-contributor-badge', page.data)
                else:
                    self.assertNotIn(b'class="contributor-badge ', page.data)
                self.assertIn(b'notificationBell', page.data)

    def test_profile_query_returns_badge_without_shifting_existing_fields(self):
        conn, cur = MagicMock(), MagicMock()
        conn.cursor.return_value = cur
        values = dict(id=7, email='alex@example.test', preferred_name='Alex',
                      department='CSE', semester_no=2, contributor_badge='trusted')
        cur.fetchone.return_value = tuple(values.get(name) for name in database.USER_RESULT_COLUMNS)
        with patch.object(database, 'get_connection', return_value=conn):
            profile = database.get_user_by_email('alex@example.test')
        self.assertEqual(profile['contributor_badge'], 'trusted')
        self.assertEqual(profile['display_name'], 'Alex')
        self.assertEqual(profile['department'], 'CSE')
        self.assertEqual(profile['semester_no'], 2)
        self.assertIn('contributor_badge', cur.execute.call_args.args[0])
