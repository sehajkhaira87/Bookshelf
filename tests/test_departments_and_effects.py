"""Department publication, integration, and site effects without remote calls."""
import io
from unittest import TestCase
from unittest.mock import MagicMock, patch

from test_pyqs import website
import database
import department_service as departments
import ui_settings_service as appearance


NEW_DEPARTMENT = {'code': 'AI', 'name': 'Artificial Intelligence', 'icon': 'chip'}


class DepartmentServiceTests(TestCase):
    def setUp(self):
        self.connection, self.cursor = MagicMock(), MagicMock()
        self.connection.cursor.return_value.__enter__.return_value = self.cursor
        patcher = patch.object(departments, 'get_connection', return_value=self.connection)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_add_normalizes_code_and_uses_parameterized_conflict_safe_insert(self):
        self.cursor.fetchone.return_value = {'code': 'AI'}
        result = departments.add_department({**NEW_DEPARTMENT, 'code': ' ai '}, 'editor@example.test')
        sql, params = self.cursor.execute.call_args.args
        self.assertEqual(result['code'], 'AI')
        self.assertIn('ON CONFLICT (code) DO NOTHING', sql)
        self.assertEqual(params, ('AI', 'Artificial Intelligence', 'chip', 'editor@example.test', None))
        self.connection.__exit__.assert_called_once_with(None, None, None)

    def test_duplicate_code_does_not_overwrite_existing_department(self):
        self.cursor.fetchone.return_value = None
        with self.assertRaisesRegex(ValueError, 'already exists'):
            departments.add_department(NEW_DEPARTMENT, 'editor@example.test')
        self.assertIs(self.connection.__exit__.call_args.args[0], ValueError)

    def test_invalid_fields_never_connect(self):
        with patch.object(departments, 'get_connection') as connect:
            for field, value in [('code', '../AI'), ('code', 'A'), ('code', '9AI'), ('code', 'A' * 13),
                                 ('name', ''), ('name', 'x' * 81), ('name', 'AI\nLab'),
                                 ('icon', '../../secret'), ('icon', '<svg>')]:
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    departments.add_department({**NEW_DEPARTMENT, field: value}, 'editor@example.test')
            connect.assert_not_called()

    def test_seed_is_repeatable_without_overwriting_custom_departments(self):
        departments.create_schema()
        inserts = self.cursor.execute.call_args_list[1:]
        self.assertEqual(len(inserts), 6)
        self.assertTrue(all('ON CONFLICT (code) DO NOTHING' in call.args[0] for call in inserts))
        self.assertEqual({call.args[1][0] for call in inserts}, {'CSE', 'IT', 'ECE', 'EE', 'ME', 'CE'})

    def test_department_read_uses_only_known_icon_paths(self):
        self.cursor.fetchall.return_value = [NEW_DEPARTMENT]
        self.assertEqual(departments.list_departments()[0]['icon_path'], 'images/it-icon.svg')
        self.cursor.fetchall.return_value = [{**NEW_DEPARTMENT, 'icon': '/evil.svg'}]
        with self.assertRaises(departments.DepartmentUnavailable):
            departments.list_departments()

    def test_profile_accepts_published_department_and_rejects_unknown(self):
        connection, cursor = MagicMock(), MagicMock()
        connection.cursor.return_value = cursor
        profile = {'id': 20, 'email': 'student@example.test', 'department': 'AI', 'preferred_name': 'Alex Singh'}
        cursor.fetchone.return_value = tuple(profile.get(field) for field in database.USER_RESULT_COLUMNS)
        with patch.object(departments, 'list_departments', return_value=[NEW_DEPARTMENT]), \
             patch.object(database, 'get_connection', return_value=connection) as connect:
            updated = database.update_user_profile('student@example.test', 'Alex Singh', 'ai', '2415001', '2416001', '2')
            self.assertEqual(updated['department'], 'AI')
            connect.reset_mock()
            with self.assertRaisesRegex(ValueError, 'valid department'):
                database.update_user_profile('student@example.test', 'Alex Singh', 'ZZ', '2415001', '2416001', '2')
            connect.assert_not_called()


class EditorExpansionTests(TestCase):
    def setUp(self):
        self.client = website.app.test_client()
        self.profile = dict(id=20, email='editor@example.test', preferred_name='Alex',
                            profile_completed=True, roles=['ui_editor'], is_banned=False)
        self.catalogue = [dict(item) for item in departments.DEFAULT_DEPARTMENTS]
        config = patch.dict(website.app.config, TESTING=True, DEPARTMENT_LOADER=lambda: self.catalogue)
        config.start()
        self.addCleanup(config.stop)
        for module, name, value in (
            (website, 'get_user_by_email', self.profile), (website, 'list_warnings', []),
            (website.communications_service, 'announcement', None),
            (appearance, 'get_settings', dict(appearance.DEFAULT_SETTINGS)),
        ):
            item = patch.object(module, name, return_value=value)
            item.start()
            self.addCleanup(item.stop)
        self.login()

    def login(self, admin=False):
        with self.client.session_transaction() as signed:
            signed.clear()
            signed['_csrf_token'] = 'token'
            if admin:
                signed.update(is_admin=True, admin_user={'email': 'admin@example.test'})
            else:
                signed['user'] = {'email': self.profile['email']}

    def test_add_requires_editor_role_and_csrf(self):
        endpoint = '/dashboard/appearance/departments'
        with patch.object(departments, 'add_department') as add:
            self.assertEqual(self.client.post(endpoint, data=NEW_DEPARTMENT).status_code, 400)
            for roles in ([], ['user_manager', 'notification_head']):
                self.profile['roles'] = roles
                self.assertEqual(self.client.post(endpoint, data={**NEW_DEPARTMENT, '_csrf_token': 'token'}).status_code, 403)
            self.login(admin=True)
            self.assertEqual(self.client.post(endpoint, data={**NEW_DEPARTMENT, '_csrf_token': 'token'}).status_code, 403)
            add.assert_not_called()

    def test_published_department_appears_across_site_on_next_request(self):
        def publish(values, actor):
            self.assertEqual(actor, self.profile['email'])
            item = departments.validate_department(values)
            self.catalogue.append({**item, 'icon_path': departments.ICONS[item['icon']][1]})
            return item
        with patch.object(departments, 'add_department', side_effect=publish):
            response = self.client.post('/dashboard/appearance/departments', data={
                **NEW_DEPARTMENT, '_csrf_token': 'token', 'actor': 'forged'})
            self.assertEqual(response.status_code, 302)
        for path in ('/dashboard', '/contribute', '/dashboard/appearance'):
            page = self.client.get(path)
            self.assertEqual(page.status_code, 200)
            self.assertIn(b'Artificial Intelligence', page.data)
        self.assertIn(b'data-dept="ai"', self.client.get('/dashboard').data)
        with patch.object(website, 'get_resource_catalogue', return_value=([], 0)) as read:
            for path in ('/books', '/notes', '/assignments'):
                page = self.client.get(path + '?branch=ai&semester=2')
                self.assertEqual(page.status_code, 200)
                self.assertIn(b'value="ai" selected', page.data)
                self.assertEqual(read.call_args.args[1:3], ('ai', '2'))
        self.login(admin=True)
        with patch.object(website, 'upload_file', return_value={'blob_url': 'https://example.test/notes.pdf'}), \
             patch.object(website, 'add_resource', return_value=1) as add:
            response = self.client.post('/upload', data={'_csrf_token': 'token', 'category': 'notes',
                'title': 'AI Notes', 'branch': 'ai', 'semester': '2',
                'file_upload': (io.BytesIO(b'%PDF-1.4 test'), 'notes.pdf')})
            self.assertEqual(response.status_code, 302)
            self.assertEqual(add.call_args.kwargs['branch'], 'ai')

    def test_failed_add_preserves_escaped_form_and_never_reports_success(self):
        for error, status in ((ValueError('Duplicate code'), 400), (departments.DepartmentUnavailable('offline'), 503)):
            with patch.object(departments, 'add_department', side_effect=error):
                response = self.client.post('/dashboard/appearance/departments', data={
                    **NEW_DEPARTMENT, 'name': '<script>evil</script>', '_csrf_token': 'token'})
                self.assertEqual(response.status_code, status)
                self.assertIn(b'&lt;script&gt;evil&lt;/script&gt;', response.data)
                self.assertNotIn(b'<script>evil</script>', response.data)
                self.assertNotIn(b'added to the website', response.data)

    def test_effect_api_is_public_bounded_and_fails_with_effect_off(self):
        with self.client.session_transaction() as signed:
            signed.clear()
        for enabled in (True, False):
            with patch.object(appearance, 'get_settings', return_value={**appearance.DEFAULT_SETTINGS, 'snowfall_enabled': enabled}):
                response = self.client.get('/api/site-effects')
                self.assertEqual(response.json, {'snowfall_enabled': enabled})
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
        with patch.object(appearance, 'get_settings', side_effect=appearance.AppearanceUnavailable('private details')):
            response = self.client.get('/api/site-effects')
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json, {'snowfall_enabled': False})

    def test_snowfall_setting_has_strict_boolean_validation_and_reset_default(self):
        self.assertFalse(appearance.DEFAULT_SETTINGS['snowfall_enabled'])
        for value, enabled in ((True, True), (False, False), ('on', True), ('off', False)):
            self.assertIs(appearance.validate_settings({**appearance.DEFAULT_VALUES, 'snowfall_enabled': value})['snowfall_enabled'], enabled)
        for value in ('yes', 'true', '<script>', 1, None, []):
            with self.assertRaises(ValueError):
                appearance.validate_settings({**appearance.DEFAULT_VALUES, 'snowfall_enabled': value})
