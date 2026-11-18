"""Contribution routes and file-removal boundaries without live services."""
import importlib
import os
import sys
import unittest
from datetime import datetime, timezone
from io import BytesIO
from unittest.mock import MagicMock, patch

import contribution_service
import department_service


class ContributionRoutesTests(unittest.TestCase):
    def setUp(self):
        with patch.dict(os.environ, {'Emails': 'admin@example.test', 'flash_secret': 'contribution-tests'}), \
                patch('database.check_connection', return_value=False), self.assertLogs('app', level='WARNING'):
            self.module = importlib.reload(sys.modules['app']) if 'app' in sys.modules else importlib.import_module('app')
        self.module.app.config.update(TESTING=True, DEPARTMENT_LOADER=lambda: department_service.DEFAULT_DEPARTMENTS)
        self.client = self.module.app.test_client()

    def sign_in(self, *, admin=False):
        with self.client.session_transaction() as session:
            session['_csrf_token'] = 'test-token'
            if admin:
                session['is_admin'] = True
                session['admin_user'] = {'email': 'admin@example.test'}
            else:
                session['user'] = {'email': ' Student@example.test '}

    def test_history_is_private_and_uses_the_signed_in_email(self):
        with patch.object(contribution_service, 'list_contributions', return_value=([], 0)) as read:
            response = self.client.get('/dashboard/contributions')
            self.assertIn('/login', response.location)
            read.assert_not_called()
            self.sign_in()
            with patch.object(self.module, 'get_user_by_email', return_value={'is_banned': False}):
                response = self.client.get('/dashboard/contributions?email=other@example.test')
            self.assertEqual(response.status_code, 200)
            self.assertIn('no-store', response.headers['Cache-Control'])
            self.assertIn(b'0 total contributions', response.data)
            self.assertIn(b'href="/contribute">Add a contribution</a>', response.data)
            read.assert_called_once_with('student@example.test', 1)

    def test_request_requires_csrf_and_cannot_use_a_submitted_owner(self):
        self.sign_in()
        path = '/dashboard/contributions/42/request-removal'
        with patch.object(self.module, 'get_user_by_email', return_value={'is_banned': False}), \
                patch.object(contribution_service, 'request_removal', return_value=False) as submit:
            self.assertEqual(self.client.post(path, data={'reason': 'Old version'}).status_code, 400)
            submit.assert_not_called()
            response = self.client.post(path, data={'_csrf_token': 'test-token', 'reason': 'Old version',
                                                   'reason_option': 'new-version',
                                                   'email': 'other@example.test'})
        self.assertEqual(response.status_code, 302)
        submit.assert_called_once_with(42, 'student@example.test', 'Old version', reason_option='new-version')

    def test_student_upload_uses_session_owner_and_starts_unverified(self):
        self.sign_in()
        with patch.object(self.module, 'get_user_by_email', return_value={'is_banned': False}), \
                patch.object(self.module, 'upload_file', return_value={'blob_url': 'https://example.test/file.pdf'}), \
                patch.object(self.module, 'add_resource', return_value=42) as save:
            response = self.client.post('/contribute', data={
                '_csrf_token': 'test-token', 'category': 'mst', 'branch': 'cse', 'semester': '5',
                'subject': 'Networks', 'file': (BytesIO(b'%PDF-1.7\ntest'), 'networks.pdf'),
                'uploaded_by': 'other@example.test', 'status': 'verified',
            })
        self.assertEqual(response.location, '/dashboard/contributions')
        self.assertEqual(save.call_args.kwargs['uploaded_by'], 'student@example.test')
        self.assertEqual(save.call_args.kwargs['status'], 'unverified')

    def test_applied_science_contributions_save_the_first_year_branch(self):
        self.sign_in()
        for semester in ('1', '2'):
            with self.subTest(semester=semester), \
                    patch.object(self.module, 'get_user_by_email', return_value={'is_banned': False}), \
                    patch.object(self.module, 'upload_file', return_value={'blob_url': 'https://example.test/file.pdf'}), \
                    patch.object(self.module, 'add_resource', return_value=42) as save:
                response = self.client.post('/contribute', data={
                    '_csrf_token': 'test-token', 'category': 'notes', 'branch': 'as', 'semester': semester,
                    'subject': 'Applied Physics', 'file': (BytesIO(b'%PDF-1.7\ntest'), 'physics.pdf'),
                })
                self.assertEqual(response.location, '/dashboard/contributions')
                self.assertEqual(save.call_args.kwargs['branch'], 'as')
                self.assertEqual(save.call_args.kwargs['semester'], semester)
                self.assertEqual(save.call_args.kwargs['status'], 'unverified')

    def test_contribution_semester_must_match_the_branch_before_uploading(self):
        self.sign_in()
        branches = [item['code'].lower() for item in department_service.DEFAULT_DEPARTMENTS]
        invalid_choices = [(branch, semester) for branch in branches for semester in ('1', '2')]
        invalid_choices += [('as', str(semester)) for semester in range(3, 9)]
        with patch.object(self.module, 'get_user_by_email', return_value={'is_banned': False}), \
                patch.object(self.module, 'upload_file') as upload, \
                patch.object(self.module, 'add_resource') as save:
            for branch, semester in invalid_choices:
                with self.subTest(branch=branch, semester=semester):
                    response = self.client.post('/contribute', data={
                        '_csrf_token': 'test-token', 'category': 'notes', 'branch': branch,
                        'semester': semester, 'subject': 'Physics',
                        'file': (BytesIO(b'%PDF-1.7\ntest'), 'physics.pdf'),
                    })
                    self.assertEqual(response.location, '/contribute')
            upload.assert_not_called()
            save.assert_not_called()

    def test_applied_science_uploads_are_available_in_the_catalogue(self):
        with patch.object(self.module, 'get_resource_catalogue', return_value=([], 0)) as catalogue:
            response = self.client.get('/notes?branch=as&semester=1')
        self.assertEqual(response.status_code, 200)
        catalogue.assert_called_once_with('notes', 'as', '1', '', 1)
        self.assertIn(b'value="as" selected>Applied Science (AS)</option>', response.data)

    def test_only_admin_can_approve_the_selected_request(self):
        path = '/admin/contributions/42/removal-decision'
        requested_at = datetime(2026, 11, 16, tzinfo=timezone.utc)
        form = {'_csrf_token': 'test-token', 'decision': 'approve', 'requested_at': requested_at.isoformat()}
        self.sign_in()
        with patch.object(contribution_service, 'remove_resource', return_value=True) as remove:
            self.assertEqual(self.client.post(path, data={**form, 'confirm_delete': 'yes'}).location, '/admin')
            self.sign_in(admin=True)
            self.assertEqual(self.client.post(path, data=form).status_code, 400)
            remove.assert_not_called()
            response = self.client.post(path, data={**form, 'confirm_delete': 'yes'})
        self.assertEqual(response.location, '/admin/contributions/removal-requests')
        remove.assert_called_once_with(42, requested_at=requested_at)


class ContributionStorageTests(unittest.TestCase):
    def test_storage_failure_keeps_the_file_entry_and_pending_request(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = ('https://example.test/file.pdf',)
        with patch.object(contribution_service, 'get_connection', return_value=connection), \
                patch.object(contribution_service, 'delete_file', return_value=False):
            with self.assertRaises(contribution_service.ContributionUnavailable):
                contribution_service.remove_resource(42)
        self.assertEqual(cursor.execute.call_count, 1)
        connection.close.assert_called_once_with()

    def test_blank_removal_reasons_are_rejected_before_database_access(self):
        with patch.object(contribution_service, 'get_connection') as connect:
            with self.assertRaises(ValueError):
                contribution_service.request_removal(42, 'student@example.test', '   ')
        connect.assert_not_called()

    def test_unknown_options_and_other_without_details_are_rejected(self):
        with patch.object(contribution_service, '_query') as query:
            with self.assertRaisesRegex(ValueError, 'Choose a reason'):
                contribution_service.request_removal(42, 'student@example.test', 'details', reason_option='unknown')
            with self.assertRaisesRegex(ValueError, 'Explain why'):
                contribution_service.request_removal(42, 'student@example.test', ' ', reason_option='other')
        query.assert_not_called()

    def test_presets_can_be_submitted_alone_or_with_details(self):
        with patch.object(contribution_service, '_query', return_value=True) as query:
            self.assertTrue(contribution_service.request_removal(42, 'student@example.test', '', reason_option='duplicate'))
            self.assertEqual(query.call_args.args[1][0], 'This is a duplicate upload')
            self.assertTrue(contribution_service.request_removal(42, 'student@example.test', ' Submitted twice. ', reason_option='duplicate'))
            self.assertEqual(query.call_args.args[1][0], 'This is a duplicate upload\nSubmitted twice.')
