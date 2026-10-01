"""Multi-role authorization and form integration without live database calls."""
from html.parser import HTMLParser
from itertools import combinations
from unittest import TestCase
from unittest.mock import MagicMock, patch

from flask import session
from werkzeug.datastructures import MultiDict

from test_pyqs import website
import admin_user_service
import communications_service
import database
import role_access
import role_service
import ui_settings_service
import user_manager_service


STAFF_ROLES = ('notification_head', 'user_manager', 'ui_editor')
WORKSPACES = {
    'notification_head': '/dashboard/notifications',
    'user_manager': '/dashboard/users',
    'ui_editor': '/dashboard/appearance',
}
MUTATIONS = {
    'notification_head': '/dashboard/notifications/announcement',
    'user_manager': '/dashboard/users/7/ban',
    'ui_editor': '/dashboard/appearance/save',
}


class SidebarLinks(HTMLParser):
    """Inspect actual navigation links, excluding form actions and page copy."""
    def __init__(self, markup):
        super().__init__()
        self.in_sidebar_nav = False
        self.links = set()
        self.feed(markup)

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if tag == 'nav' and 'sidebar-nav' in attributes.get('class', '').split():
            self.in_sidebar_nav = True
        if tag == 'a' and self.in_sidebar_nav:
            self.links.add(attributes.get('href'))

    def handle_endtag(self, tag):
        if tag == 'nav':
            self.in_sidebar_nav = False


class MultiRoleIntegrationTests(TestCase):
    def setUp(self):
        self.client = website.app.test_client()
        self.profile = {
            'id': 20, 'email': 'staff@example.test', 'preferred_name': 'Sam',
            'display_name': 'Sam', 'role': 'student', 'roles': [],
            'is_banned': False, 'profile_completed': True,
        }
        self.student = {
            'id': 7, 'email': 'student@example.test', 'role': 'student',
            'roles': [], 'is_banned': False,
        }
        self.lookup = MagicMock(side_effect=lambda email: self.profile)
        config = patch.dict(website.app.config, TESTING=True, ROLE_PROFILE_LOADER=self.lookup)
        config.start()
        self.addCleanup(config.stop)
        # A missed service mock must fail locally instead of contacting the real DB.
        connection = patch.object(database.psycopg2, 'connect',
                                  side_effect=AssertionError('Unexpected database connection in multi-role test'))
        self.connect = connection.start()
        self.addCleanup(connection.stop)
        lookup = patch.object(website, 'get_user_by_email', self.lookup)
        lookup.start()
        self.addCleanup(lookup.stop)
        self.mocks = {}
        for module, name, result in (
            (website, 'list_warnings', []),
            (communications_service, 'announcement', None),
            (communications_service, 'history', []),
            (communications_service, 'save_announcement', None),
            (ui_settings_service, 'get_settings', dict(ui_settings_service.DEFAULT_SETTINGS)),
            (ui_settings_service, 'save_settings', None),
            (user_manager_service, 'list_students', ([], False)),
            (user_manager_service, 'list_student_resources', ([], False)),
            (user_manager_service, 'get_student', self.student),
            (admin_user_service, 'list_warnings_for_users', {}),
            (admin_user_service, 'ban_user', True),
        ):
            mocked = patch.object(module, name, return_value=result)
            self.mocks[name] = mocked.start()
            self.addCleanup(mocked.stop)
        self.login()

    def tearDown(self):
        self.connect.assert_not_called()

    def login(self, admin=False):
        with self.client.session_transaction() as signed:
            signed.clear()
            signed['_csrf_token'] = 'token'
            if admin:
                signed.update(is_admin=True, admin_user={'email': 'admin@example.test'})
            else:
                signed['user'] = {'email': 'staff@example.test', 'name': 'Sam'}

    def assert_workspace_links(self, response, roles):
        self.assertEqual(response.status_code, 200)
        links = SidebarLinks(response.get_data(as_text=True)).links
        expected = {WORKSPACES[role] for role in roles}
        self.assertEqual(links.intersection(WORKSPACES.values()), expected)
        self.assertNotIn('/admin-dashboard', links)
        self.assertNotIn('/admin/roles', links)
        self.assertIn('no-store', response.headers['Cache-Control'])

    def post_workspace(self, role):
        return self.client.post(MUTATIONS[role], data={
            '_csrf_token': 'token', 'notice_title': 'Study update',
            'notice_body': 'New materials', 'notice_link': '/notes', 'revision': '0',
            **ui_settings_service.DEFAULT_VALUES,
        })

    def test_every_role_combination_controls_dashboard_and_workspace_navigation(self):
        for count in range(4):
            for assigned in combinations(STAFF_ROLES, count):
                with self.subTest(assigned=assigned):
                    self.profile['roles'] = list(reversed(assigned))
                    self.assert_workspace_links(self.client.get('/dashboard'), assigned)
                    for role, path in WORKSPACES.items():
                        response = self.client.get(path)
                        if role in assigned:
                            self.assert_workspace_links(response, assigned)
                        else:
                            self.assertEqual(response.status_code, 403, (assigned, path))

    def test_all_three_roles_can_use_their_mutations_and_keep_role_specific_redirects(self):
        self.profile['roles'] = list(STAFF_ROLES)
        for role in STAFF_ROLES:
            with self.subTest(role=role):
                response = self.post_workspace(role)
                self.assertEqual(response.status_code, 302)
                self.assertEqual(response.location.split('?')[0], WORKSPACES[role])
        self.mocks['save_announcement'].assert_called_once_with(
            'Study update', 'New materials', '/notes', self.profile['email'], '0')
        self.mocks['ban_user'].assert_called_once_with(7)
        self.assertEqual(self.mocks['save_settings'].call_args.args[1:], (self.profile['email'], '0'))

    def test_partial_revocation_takes_effect_for_get_and_post_without_signing_in_again(self):
        services = {
            'notification_head': self.mocks['save_announcement'],
            'user_manager': self.mocks['ban_user'],
            'ui_editor': self.mocks['save_settings'],
        }
        with self.client.session_transaction() as signed:
            signed['roles'] = list(STAFF_ROLES)
            signed['user']['roles'] = list(STAFF_ROLES)
        for removed in STAFF_ROLES:
            with self.subTest(removed=removed):
                self.profile.update(roles=list(STAFF_ROLES), role=removed)
                self.assertEqual(self.client.get(WORKSPACES[removed]).status_code, 200)
                retained = [role for role in STAFF_ROLES if role != removed]
                self.profile['roles'] = retained
                services[removed].reset_mock()
                self.assertEqual(self.client.get(WORKSPACES[removed]).status_code, 403)
                self.assertEqual(self.post_workspace(removed).status_code, 403)
                services[removed].assert_not_called()
                self.assert_workspace_links(self.client.get('/dashboard'), retained)
                for role in retained:
                    self.assert_workspace_links(self.client.get(WORKSPACES[role]), retained)
                    self.assertEqual(self.post_workspace(role).status_code, 302)

    def test_empty_canonical_roles_override_stale_legacy_and_session_roles(self):
        self.profile.update(roles=[], role='notification_head')
        with self.client.session_transaction() as signed:
            signed.update(role='user_manager', roles=list(STAFF_ROLES))
            signed['user'].update(role='ui_editor', roles=list(STAFF_ROLES))
        self.assert_workspace_links(self.client.get('/dashboard'), [])
        for role, path in WORKSPACES.items():
            self.assertEqual(self.client.get(path).status_code, 403)
            self.assertEqual(self.post_workspace(role).status_code, 403)
        for name in ('save_announcement', 'ban_user', 'save_settings'):
            self.mocks[name].assert_not_called()

    def test_banned_missing_and_unknown_profiles_cannot_use_any_workspace(self):
        cases = (
            {**self.profile, 'roles': list(STAFF_ROLES), 'is_banned': True},
            {**self.profile, 'roles': ['admin', 'unknown'], 'role': 'ui_editor'},
            None,
        )
        for profile in cases:
            with self.subTest(profile=profile):
                self.profile = profile
                for role, path in WORKSPACES.items():
                    self.assertEqual(self.client.get(path).status_code, 403)
                    self.assertEqual(self.post_workspace(role).status_code, 403)
        for name in ('save_announcement', 'ban_user', 'save_settings'):
            self.mocks[name].assert_not_called()

    def test_authorization_lookup_is_cached_only_within_one_request(self):
        self.profile['roles'] = ['user_manager', 'ui_editor']
        self.lookup.reset_mock()
        with website.app.test_request_context('/dashboard/users'):
            session['user'] = {'email': self.profile['email'], 'roles': list(STAFF_ROLES)}
            self.assertEqual(role_access.current_roles(), frozenset({'user_manager', 'ui_editor'}))
            self.assertEqual(role_access.current_roles(), frozenset({'user_manager', 'ui_editor'}))
            self.lookup.assert_called_once_with(self.profile['email'])
        self.profile['roles'] = ['ui_editor']
        with website.app.test_request_context('/dashboard/appearance'):
            session['user'] = {'email': self.profile['email'], 'roles': list(STAFF_ROLES)}
            self.assertEqual(role_access.current_roles(), frozenset({'ui_editor'}))
        self.assertEqual(self.lookup.call_count, 2)

    def test_all_roles_still_require_csrf_and_cannot_assign_roles(self):
        self.profile['roles'] = list(STAFF_ROLES)
        for path in MUTATIONS.values():
            self.assertEqual(self.client.post(path).status_code, 400)
        for name in ('save_announcement', 'ban_user', 'save_settings'):
            self.mocks[name].assert_not_called()
        with patch.object(role_service, 'assign_roles') as assign:
            response = self.client.post('/admin/users/7/role', data={
                '_csrf_token': 'token', 'roles_present': '1', 'roles': list(STAFF_ROLES),
            })
            self.assertEqual(response.status_code, 302)
            assign.assert_not_called()

    def test_admin_multi_role_form_uses_current_actor_and_requires_csrf(self):
        self.login(admin=True)
        selected = ['notification_head', 'ui_editor']
        with patch.object(role_service, 'assign_roles', return_value=True) as assign, \
             patch.object(role_service, 'assign_role') as legacy:
            self.assertEqual(self.client.post('/admin/users/20/role', data={
                'roles_present': '1', 'roles': selected,
            }).status_code, 400)
            assign.assert_not_called()
            response = self.client.post('/admin/users/20/role', data={
                '_csrf_token': 'token', 'roles_present': '1', 'roles': selected,
                'actor': 'forged@example.test',
            })
            self.assertEqual(response.status_code, 302)
            assign.assert_called_once_with(20, selected, 'admin@example.test', website.ADMIN_EMAILS)
            legacy.assert_not_called()

    def test_admin_can_explicitly_remove_every_role(self):
        self.login(admin=True)
        with patch.object(role_service, 'assign_roles', return_value=True) as assign:
            response = self.client.post('/admin/users/20/role', data={
                '_csrf_token': 'token', 'roles_present': '1',
            })
            self.assertEqual(response.status_code, 302)
            assign.assert_called_once_with(20, [], 'admin@example.test', website.ADMIN_EMAILS)

    def test_legacy_scalar_role_form_remains_supported(self):
        self.login(admin=True)
        with patch.object(role_service, 'assign_roles') as assign, \
             patch.object(role_service, 'assign_role', return_value=True) as legacy:
            response = self.client.post('/admin/users/20/role', data={
                '_csrf_token': 'token', 'role': 'user_manager',
            })
            self.assertEqual(response.status_code, 302)
            legacy.assert_called_once_with(20, 'user_manager', 'admin@example.test', website.ADMIN_EMAILS)
            assign.assert_not_called()

    def test_mixed_or_ambiguous_assignment_forms_never_reach_persistence(self):
        self.login(admin=True)
        malformed = (
            [('roles_present', '1'), ('roles', 'ui_editor'), ('role', 'student')],
            [('roles', 'ui_editor')],
            [('roles_present', '0'), ('roles', 'ui_editor')],
            [('roles_present', '1'), ('roles_present', '0'), ('roles', 'ui_editor')],
            [('role', 'user_manager'), ('role', 'ui_editor')],
            [],
        )
        with patch.object(role_service, 'assign_roles') as assign, \
             patch.object(role_service, 'assign_role') as legacy:
            for fields in malformed:
                with self.subTest(fields=fields):
                    response = self.client.post('/admin/users/20/role', data=MultiDict([
                        ('_csrf_token', 'token'), *fields,
                    ]))
                    self.assertIn(response.status_code, (302, 400))
            assign.assert_not_called()
            legacy.assert_not_called()


class ProfileRolesTests(TestCase):
    def test_valid_roles_are_deduplicated_and_ordered(self):
        profile = {'role': 'student', 'roles': [
            'ui_editor', 'user_manager', 'notification_head', 'ui_editor',
        ]}
        self.assertEqual(role_access.profile_roles(profile), STAFF_ROLES)

    def test_empty_or_malformed_canonical_roles_never_restore_stale_legacy_access(self):
        for roles in ([], None, 'ui_editor', 7, {'ui_editor': True},
                      ['ui_editor', 'unknown'], ['admin'], ['ui_editor', None]):
            with self.subTest(roles=roles):
                self.assertEqual(role_access.profile_roles({'roles': roles, 'role': 'ui_editor'}), ())

    def test_legacy_profiles_keep_single_role_access(self):
        for role in STAFF_ROLES:
            self.assertEqual(role_access.profile_roles({'role': role}), (role,))
        for profile in (None, {}, {'role': 'student'}, {'role': 'admin'}, {'role': 'unknown'}):
            self.assertEqual(role_access.profile_roles(profile), ())

