"""PYQ regression tests. All database and Azure calls are mocked."""
import io
import os
import unittest
from unittest.mock import patch

import database
import pyq_service

with patch.dict(os.environ, {'Emails': 'admin@example.test', 'flash_secret': 'test-secret'}), \
     patch.object(database, 'check_connection'), \
     patch.object(database, 'create_tables', return_value=False):
    import app as website

# Shared HTML fixtures never need a live department catalogue. Individual
# department integration tests override this loader with their own records.
website.app.config['DEPARTMENT_LOADER'] = lambda: website.department_service.DEFAULT_DEPARTMENTS


class PyqTests(unittest.TestCase):
    def setUp(self):
        website.app.config.update(TESTING=True)
        self.client = website.app.test_client()
        self.summary = {'total': 5928, 'years': [2025, 2024, 2013], 'oldest_year': 2013, 'newest_year': 2025}
        summary_patch = patch.object(website, 'get_pyq_summary', return_value=self.summary)
        summary_patch.start()
        self.addCleanup(summary_patch.stop)
        announcement_patch = patch.object(website.communications_service, 'announcement', return_value=None)
        announcement_patch.start()
        self.addCleanup(announcement_patch.stop)

    def admin(self):
        with self.client.session_transaction() as session:
            session.update(is_admin=True, admin_user={'email': 'admin@example.test'}, _csrf_token='token')

    def test_student_cannot_upload_or_delete(self):
        with patch.object(website, 'import_pdf') as upload:
            self.assertEqual(self.client.post('/admin/pyqs/upload').status_code, 302)
            self.assertEqual(self.client.post('/admin/pyqs/1/delete').status_code, 302)
            self.assertEqual(self.client.get('/admin/pyqs').status_code, 302)
            upload.assert_not_called()

    def test_admin_requires_csrf(self):
        self.admin()
        with patch.object(website, 'import_pdf') as upload:
            self.assertEqual(self.client.post('/admin/pyqs/upload').status_code, 400)
            upload.assert_not_called()

    def test_admin_upload_has_no_semester_or_branch(self):
        self.admin()
        with patch.object(website, 'import_pdf', return_value=(1, True)) as upload:
            response = self.client.post('/admin/pyqs/upload', data={
                '_csrf_token': 'token', 'subject_code': 'CS301',
                'subject_name': 'Data Structures', 'year': '2024',
                'file_upload': (io.BytesIO(b'%PDF-1.4 test'), 'Original Name.pdf')})
            self.assertEqual(response.status_code, 302)
            self.assertEqual(upload.call_args.args[1:5], ('Original Name.pdf', 'CS301', 'Data Structures', '2024'))

    def test_old_upload_rejects_pyq(self):
        self.admin()
        with patch.object(website, 'upload_file') as upload:
            self.client.post('/upload', data={'_csrf_token': 'token', 'category': 'pyq',
                'branch': 'cse', 'semester': '1', 'title': 'Paper',
                'file_upload': (io.BytesIO(b'%PDF-1.4 test'), 'paper.pdf')})
            upload.assert_not_called()

    def test_catalogue_pagination_and_escaping(self):
        paper = dict(id=1, title='<script> - Subject', year=2024,
                     blob_url='https://example.test/paper.pdf', original_filename='paper.pdf')
        with patch.object(website, 'list_pyqs', return_value=([paper], 51)) as listing:
            response = self.client.get('/pyqs?q=CS&year=2024&semester=8')
            self.assertEqual(response.status_code, 200)
            self.assertIn(b'&lt;script&gt;', response.data)
            self.assertIn(b'Next', response.data)
            self.assertNotIn(b'Delete PYQ', response.data)
            listing.assert_called_once_with('CS', 2024, 1)
            self.admin()
            self.assertIn(b'Upload a PDF', self.client.get('/admin/pyqs').data)

    def test_invalid_api_filters(self):
        for suffix in ('?year=abc', '?page=0', '?year=100000'):
            self.assertEqual(self.client.get('/api/pyqs' + suffix).status_code, 400)

    def test_duplicate_skips_azure(self):
        with patch.object(pyq_service, 'query', return_value={'id': 7}), \
             patch('storage_agent.upload_file') as upload:
            self.assertEqual(pyq_service.import_pdf(io.BytesIO(b'%PDF-1.4 test'), 'x.pdf',
                'CS301', 'Subject', 2024, 'admin'), (7, False))
            upload.assert_not_called()

    def test_database_failure_cleans_up_blob(self):
        with patch.object(pyq_service, 'query', side_effect=[None, RuntimeError('DB failure')]), \
             patch('storage_agent.upload_file', return_value={'blob_url': 'https://example.test/x.pdf'}), \
             patch('storage_agent.delete_file', return_value=True) as delete:
            with self.assertRaises(RuntimeError):
                pyq_service.import_pdf(io.BytesIO(b'%PDF-1.4 test'), 'x.pdf', 'CS301', 'Subject', 2024, 'admin')
            delete.assert_called_once_with('https://example.test/x.pdf')

    def test_invalid_pdf_and_metadata(self):
        with self.assertRaises(ValueError):
            pyq_service.fingerprint(io.BytesIO(b'not a PDF'))
        for code, name, year in [('', 'Subject', 2024), ('CS301', '', 2024), ('CS301', 'Subject', 'bad')]:
            with self.assertRaises(ValueError):
                pyq_service.validate_metadata(code, name, year)

    def test_sql_pagination(self):
        with patch.object(pyq_service, 'query', side_effect=[{'total': 51}, []]) as query:
            pyq_service.list_pyqs('CS', 2024, 2)
            sql, parameters = query.call_args.args
            self.assertIn('LIMIT 50 OFFSET %s', sql)
            self.assertEqual(parameters, ['%CS%', '%CS%', 2024, 50])

    def test_student_dashboard_has_direct_shared_archive_access(self):
        profile = {'id': 1, 'email': 'student@example.test', 'preferred_name': 'Test Student',
                   'profile_completed': True, 'is_banned': False}
        with self.client.session_transaction() as session:
            session['user'] = {'email': profile['email'], 'name': 'Test Student'}
        with patch.object(website, 'get_user_by_email', return_value=profile), \
             patch.object(website, 'list_warnings', return_value=[]):
            response = self.client.get('/dashboard')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'PYQ archive', response.data)
        self.assertIn(b'href="/pyqs"', response.data)
        self.assertLess(response.data.index(b'PYQ archive'), response.data.index(b'id="step-dept"'))

    def test_admin_dashboard_links_to_shared_database_catalogue(self):
        self.admin()
        with patch.object(website, 'get_resources', return_value=[]), \
             patch.object(website, 'get_resource_stats', return_value={}), \
             patch.object(website, 'search_users', return_value=[]), \
             patch.object(website, 'list_warnings_for_users', return_value={}):
            response = self.client.get('/admin-dashboard')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'PYQ library', response.data)
        self.assertIn(b'href="/admin/pyqs"', response.data)
        self.assertIn(b'5,928', response.data)

    def test_imported_paper_visible_to_admin_student_and_api(self):
        paper = dict(id=40, title='CS301 - Data Structures', subject_code='CS301',
                     subject_name='Data Structures', year=2024,
                     blob_url='https://example.test/pyq/2024/imported.pdf',
                     original_filename='CS301 - Data Structures.pdf', file_hash='private-hash',
                     import_source_key='knimbus:source', uploaded_by='private@example.test')
        with patch.object(website, 'list_pyqs', return_value=([paper], 1)):
            student = self.client.get('/pyqs?year=2024')
            self.assertIn(b'Data Structures', student.data)
            self.assertIn(b'value="2024" selected', student.data)
            self.assertNotIn(b'Delete PYQ', student.data)
            api = self.client.get('/api/pyqs?year=2024').get_json()
            self.assertEqual(api['items'][0]['blob_url'], paper['blob_url'])
            self.assertNotIn('import_source_key', api['items'][0])
            self.assertNotIn('uploaded_by', api['items'][0])
            self.admin()
            admin = self.client.get('/admin/pyqs?year=2024')
            self.assertIn(b'Data Structures', admin.data)
            self.assertIn(b'Delete PYQ', admin.data)

    def test_archive_summary_is_derived_from_shared_pyqs(self):
        with patch.object(pyq_service, 'query', return_value=[{'year': 2025, 'total': 385}, {'year': 2024, 'total': 438}]) as query:
            result = pyq_service.get_pyq_summary()
            self.assertEqual(result['total'], 823)
            self.assertEqual(result['years'], [2025, 2024])
            self.assertIn('FROM pyqs', query.call_args.args[0])

    def test_rename_requires_admin_and_csrf(self):
        with patch.object(website, 'rename_pyq') as rename:
            self.assertEqual(self.client.post('/admin/pyqs/40/rename').status_code, 302)
            self.admin()
            self.assertEqual(self.client.post('/admin/pyqs/40/rename').status_code, 400)
            rename.assert_not_called()

    def test_admin_rename_preserves_filters_and_saves_only_name(self):
        self.admin()
        with patch.object(website, 'rename_pyq', return_value=True) as rename:
            response = self.client.post('/admin/pyqs/40/rename', data={
                '_csrf_token': 'token', 'subject_name': 'Updated subject', 'expected_name': 'Old subject',
                'q': 'CS301', 'filter_year': '2024', 'page': '2'})
            rename.assert_called_once_with(40, 'Updated subject', 'Old subject')
            self.assertEqual(response.status_code, 302)
            self.assertIn('year=2024', response.location)
            self.assertIn('page=2', response.location)
            self.assertIn('q=CS301', response.location)

    def test_rename_validates_name_and_preserves_file_metadata(self):
        with patch.object(pyq_service, 'query', return_value={'id': 40}) as query:
            for name in ('', '   ', 'a' * 256, 'bad\x00name'):
                with self.assertRaises(ValueError):
                    pyq_service.rename_pyq(40, name, 'Old')
            query.assert_not_called()
            self.assertTrue(pyq_service.rename_pyq(40, '  New   subject  ', 'Old'))
            sql, values = query.call_args.args
            self.assertEqual(values, ('New subject', 40, 'Old'))
            self.assertNotIn('blob_url', sql)
            self.assertNotIn('original_filename', sql)
            self.assertIn('subject_name=%s', sql)
            self.assertIn('updated_at=CURRENT_TIMESTAMP', sql)

    def test_rename_rejects_stale_record(self):
        with patch.object(pyq_service, 'query', return_value=None):
            self.assertFalse(pyq_service.rename_pyq(40, 'New name', 'Old name'))

    def test_admin_list_has_edit_controls_but_student_page_does_not(self):
        paper = dict(id=40, title='CS301 - Data Structures', subject_name='Data Structures',
                     year=2024, blob_url='https://example.test/paper.pdf', original_filename='paper.pdf')
        with patch.object(website, 'list_pyqs', return_value=([paper], 1)):
            student = self.client.get('/pyqs')
            self.assertNotIn(b'Save name', student.data)
            self.admin()
            admin = self.client.get('/admin/pyqs')
            self.assertIn(b'class="pyq-list"', admin.data)
            self.assertIn(b'Edit name', admin.data)
            self.assertIn(b'action="/admin/pyqs/40/rename"', admin.data)



if __name__ == '__main__':
    unittest.main()
