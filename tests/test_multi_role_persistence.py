"""Multi-role migration and persistence contracts without a live database."""
from unittest import TestCase
from unittest.mock import MagicMock, patch

import admin_user_service
import database
import role_service
import user_manager_service


ADMINS = {'admin@example.test'}
ACTOR = 'admin@example.test'
ROLE_ORDER = ['notification_head', 'user_manager', 'ui_editor']


def connection_with(row=None):
    connection, cursor = MagicMock(), MagicMock()
    connection.cursor.return_value = cursor
    cursor.__enter__.return_value = cursor
    cursor.fetchone.return_value = row
    return connection, cursor


class MultiRoleAssignmentTests(TestCase):
    def test_add_roles_deduplicates_orders_locks_and_audits_complete_sets(self):
        conn, cursor = connection_with(('member@example.test', 'student', [], False))
        with patch.object(role_service, 'get_connection', return_value=conn):
            self.assertTrue(role_service.assign_roles(20,
                ['ui_editor', 'notification_head', 'ui_editor', 'user_manager'], ' ADMIN@example.test ', ADMINS))
        self.assertIn('FOR UPDATE', cursor.execute.call_args_list[0].args[0])
        self.assertEqual(cursor.execute.call_args_list[0].args[1], (20,))
        self.assertEqual(cursor.execute.call_args_list[1].args[1], (ROLE_ORDER, 'notification_head', 20))
        self.assertEqual(cursor.execute.call_args_list[2].args[1],
                         (20, 'student', 'notification_head', ACTOR, [], ROLE_ORDER))
        conn.__exit__.assert_called_once_with(None, None, None)
        conn.close.assert_called_once()

    def test_remove_one_role_preserves_others_and_clear_revokes_everything(self):
        for selected, primary in [(['ui_editor', 'notification_head'], 'notification_head'), ([], 'student')]:
            with self.subTest(selected=selected):
                conn, cursor = connection_with(('member@example.test', 'notification_head', ROLE_ORDER, False))
                with patch.object(role_service, 'get_connection', return_value=conn):
                    self.assertTrue(role_service.assign_roles(20, selected, ACTOR, ADMINS))
                expected = [role for role in ROLE_ORDER if role in selected]
                self.assertEqual(cursor.execute.call_args_list[1].args[1], (expected, primary, 20))
                self.assertEqual(cursor.execute.call_args_list[2].args[1],
                                 (20, 'notification_head', primary, ACTOR, ROLE_ORDER, expected))

    def test_empty_canonical_array_does_not_restore_stale_legacy_role(self):
        conn, cursor = connection_with(('member@example.test', 'ui_editor', [], False))
        with patch.object(role_service, 'get_connection', return_value=conn):
            role_service.assign_roles(20, [], ACTOR, ADMINS)
        self.assertEqual(cursor.execute.call_args_list[1].args[1], ([], 'student', 20))
        self.assertEqual(cursor.execute.call_count, 2)

    def test_unchanged_role_set_does_not_update_or_append_audit(self):
        conn, cursor = connection_with(('member@example.test', 'notification_head', ROLE_ORDER, False))
        with patch.object(role_service, 'get_connection', return_value=conn):
            self.assertTrue(role_service.assign_roles(20, list(reversed(ROLE_ORDER)) + ['ui_editor'], ACTOR, ADMINS))
        self.assertEqual(cursor.execute.call_count, 1)

    def test_banned_account_can_only_have_all_roles_revoked(self):
        for selected in ([ROLE_ORDER[0]], ROLE_ORDER):
            conn, cursor = connection_with(('member@example.test', 'notification_head', ROLE_ORDER, True))
            with patch.object(role_service, 'get_connection', return_value=conn), self.assertRaises(ValueError):
                role_service.assign_roles(20, selected, ACTOR, ADMINS)
            self.assertEqual(cursor.execute.call_count, 1)
        conn, cursor = connection_with(('member@example.test', 'notification_head', ROLE_ORDER, True))
        with patch.object(role_service, 'get_connection', return_value=conn):
            self.assertTrue(role_service.assign_roles(20, [], ACTOR, ADMINS))
        self.assertEqual(cursor.execute.call_args_list[1].args[1], ([], 'student', 20))

    def test_entire_selection_is_validated_before_connecting(self):
        invalid = [None, 'ui_editor', {'ui_editor': True}, ['student'], ['admin'], ['unknown'],
                   ['ui_editor', 'admin'], ['notification_head', None], [False], [['ui_editor']]]
        with patch.object(role_service, 'get_connection') as connect:
            for roles in invalid:
                with self.subTest(roles=roles), self.assertRaises(ValueError):
                    role_service.assign_roles(20, roles, ACTOR, ADMINS)
            connect.assert_not_called()

    def test_nonadmin_actor_or_invalid_user_id_never_connects(self):
        with patch.object(role_service, 'get_connection') as connect:
            with self.assertRaises(ValueError):
                role_service.assign_roles(20, ['ui_editor'], 'member@example.test', ADMINS)
            for user_id in (False, 0, -1, 1.5, 'invalid', None, 2147483648):
                with self.subTest(user_id=user_id), self.assertRaises(ValueError):
                    role_service.assign_roles(user_id, [], ACTOR, ADMINS)
            connect.assert_not_called()

    def test_administrator_targets_are_protected_even_when_clearing(self):
        for selected in ([], ['ui_editor']):
            conn, cursor = connection_with((' ADMIN@example.test ', 'student', [], False))
            with patch.object(role_service, 'get_connection', return_value=conn), self.assertRaises(ValueError):
                role_service.assign_roles(20, selected, ACTOR, ADMINS)
            self.assertEqual(cursor.execute.call_count, 1)

    def test_missing_target_has_no_mutations(self):
        conn, cursor = connection_with(None)
        with patch.object(role_service, 'get_connection', return_value=conn):
            self.assertFalse(role_service.assign_roles(20, ROLE_ORDER, ACTOR, ADMINS))
        self.assertEqual(cursor.execute.call_count, 1)

    def test_audit_failure_rolls_back_assignment(self):
        conn, cursor = connection_with(('member@example.test', 'student', [], False))
        cursor.execute.side_effect = [None, None, RuntimeError('Audit unavailable')]
        with patch.object(role_service, 'get_connection', return_value=conn), self.assertRaises(role_service.RoleServiceError):
            role_service.assign_roles(20, ROLE_ORDER, ACTOR, ADMINS)
        self.assertIs(conn.__exit__.call_args.args[0], RuntimeError)
        conn.close.assert_called_once()

    def test_single_role_compatibility_wrapper_maps_student_to_empty(self):
        with patch.object(role_service, 'assign_roles', return_value=True) as assign:
            self.assertTrue(role_service.assign_role(20, 'student', ACTOR, ADMINS))
            assign.assert_called_once_with(20, [], ACTOR, ADMINS)
            assign.reset_mock()
            self.assertTrue(role_service.assign_role(20, 'ui_editor', ACTOR, ADMINS))
            assign.assert_called_once_with(20, ['ui_editor'], ACTOR, ADMINS)


class MultiRoleMigrationTests(TestCase):
    def test_users_migration_only_backfills_null_and_is_repeatable(self):
        conn, cursor = connection_with()
        with patch.object(database, 'get_connection', return_value=conn), \
             patch.object(database, 'create_resources_table'):
            self.assertTrue(database.create_tables())
            self.assertTrue(database.create_tables())
        first, second = (call.args[0] for call in cursor.execute.call_args_list)
        self.assertEqual(first, second)
        sql = ' '.join(first.split())
        self.assertIn('ADD COLUMN IF NOT EXISTS roles TEXT[];', sql)
        self.assertIn('THEN ARRAY[role]::TEXT[] ELSE ARRAY[]::TEXT[] END WHERE roles IS NULL;', sql)
        self.assertLess(sql.index('WHERE roles IS NULL'), sql.index('ALTER COLUMN roles SET DEFAULT'))
        self.assertIn('ALTER COLUMN roles SET NOT NULL', sql)
        self.assertIn("conname = 'users_roles_valid' AND conrelid = 'users'::regclass", sql)
        self.assertIn("roles <@ ARRAY['notification_head', 'user_manager', 'ui_editor']::TEXT[]", sql)
        self.assertIn('array_position(roles, NULL) IS NULL', sql)
        self.assertIn("WHERE role IS DISTINCT FROM COALESCE(roles[1], 'student')", sql)
        self.assertNotIn('DROP ', sql)
        self.assertEqual(conn.commit.call_count, 2)

    def test_audit_migration_preserves_scalar_history_and_backfills_null_arrays_only(self):
        conn, cursor = connection_with()
        with patch.object(role_service, 'get_connection', return_value=conn):
            role_service.create_schema()
            role_service.create_schema()
        first, second = (call.args[0] for call in cursor.execute.call_args_list)
        self.assertEqual(first, second)
        sql = ' '.join(first.split())
        for name in ('previous_roles', 'new_roles'):
            self.assertIn(f'ADD COLUMN IF NOT EXISTS {name} TEXT[];', sql)
            self.assertIn(f'WHERE {name} IS NULL;', sql)
            self.assertIn(f'ALTER COLUMN {name} SET NOT NULL', sql)
        self.assertNotIn('SET previous_role =', sql)
        self.assertNotIn('SET new_role =', sql)
        self.assertNotIn('DROP ', sql)

    def test_profile_mapping_exposes_canonical_roles_and_legacy_role(self):
        record = {name: None for name in database.USER_RESULT_COLUMNS}
        record.update(id=20, email='member@example.test', role='notification_head', roles=ROLE_ORDER)
        user = database._user_from_row(tuple(record[name] for name in database.USER_RESULT_COLUMNS))
        self.assertEqual(user['roles'], ROLE_ORDER)
        self.assertEqual(user['role'], 'notification_head')
        self.assertIn('roles', database.USER_SELECT_COLUMNS)

    def test_admin_search_returns_full_role_array(self):
        conn, cursor = connection_with()
        cursor.fetchall.return_value = [{'id': 20, 'role': 'notification_head', 'roles': ROLE_ORDER}]
        with patch.object(admin_user_service, 'get_connection', return_value=conn):
            result = admin_user_service.search_users('member')
        self.assertIn('u.roles', cursor.execute.call_args.args[0])
        self.assertEqual(result[0]['roles'], ROLE_ORDER)


class MultiRoleModerationScopeTests(TestCase):
    def test_canonical_roles_override_stale_scalar_and_invalid_data_fails_closed(self):
        student = {'email': 'member@example.test', 'role': 'student'}
        self.assertTrue(user_manager_service.is_manageable_student(student, ADMINS, 'manager@example.test'))
        self.assertTrue(user_manager_service.is_manageable_student(
            dict(student, role='ui_editor', roles=[]), ADMINS, 'manager@example.test'))
        for roles in (ROLE_ORDER, ['ui_editor'], ['unknown'], ['student'], None, '[]', {}, [[]]):
            with self.subTest(roles=roles):
                self.assertFalse(user_manager_service.is_manageable_student(
                    dict(student, roles=roles), ADMINS, 'manager@example.test'))
        for role in ('unknown', None, 'ui_editor'):
            self.assertFalse(user_manager_service.is_manageable_student(
                dict(student, role=role), ADMINS, 'manager@example.test'))

    def test_admin_and_actor_are_protected_even_with_empty_roles(self):
        for email in (' ADMIN@example.test ', 'manager@example.test', '', 'admin'):
            self.assertFalse(user_manager_service.is_manageable_student(
                {'email': email, 'role': 'student', 'roles': []}, ADMINS, 'manager@example.test'))

    def test_all_student_queries_filter_by_empty_canonical_array(self):
        with patch.object(user_manager_service, '_query', return_value=[]) as query:
            user_manager_service.list_students('', 1, ADMINS, 'manager@example.test')
            user_manager_service.get_student(20, ADMINS, 'manager@example.test')
            user_manager_service.list_student_resources('', '', 1, ADMINS, 'manager@example.test')
        self.assertEqual(query.call_count, 3)
        for call in query.call_args_list:
            sql, params = call.args
            self.assertIn('cardinality(u.roles) = 0', sql)
            self.assertNotIn("u.role = 'student'", sql)
            self.assertIn('admin@example.test', params[0])
            self.assertIn('manager@example.test', params[0])
