"""Website resource listings and upload visibility, with remote services mocked."""
import io
import unittest
from unittest.mock import MagicMock, patch

from test_pyqs import website
import db_agent


class ResourceCatalogueTests(unittest.TestCase):
    def setUp(self):
        website.app.config.update(TESTING=True)
        self.client = website.app.test_client()

    def test_each_section_reads_its_own_category_and_filters(self):
        for endpoint, category, title in [('notes', 'notes', 'Notes'), ('assignments', 'assignment', 'Assignments'), ('books', 'book', 'Digital Books')]:
            with self.subTest(category=category), patch.object(website, 'get_resource_catalogue', return_value=([], 0)) as read:
                response = self.client.get(f'/{endpoint}?branch=ECE&semester=4&q=Circuits&page=2')
                self.assertEqual(response.status_code, 200)
                read.assert_called_once_with(category, 'ece', '4', 'Circuits', 2)
                self.assertIn(title.encode(), response.data)
                self.assertIn(b'value="ece" selected', response.data)
                self.assertIn(b'value="4" selected', response.data)

    def test_invalid_filters_do_not_query_database(self):
        with patch.object(website, 'get_resource_catalogue') as read:
            for query in ('branch=invalid', 'semester=9', 'semester=abc', 'page=-1', 'page=bad'):
                self.assertEqual(self.client.get('/notes?' + query).status_code, 400)
            read.assert_not_called()

    def test_all_three_admin_uploads_appear_in_matching_sections(self):
        stored = []
        def add(**resource):
            resource['id'] = len(stored) + 1
            stored.append(resource)
            return resource['id']
        def read(category, branch, semester, search, page):
            found = [r for r in stored if r['category'] == category and r['status'] == 'verified'
                     and (not branch or r['branch'] == branch) and (not semester or r['semester'] == semester)]
            return found, len(found)
        with self.client.session_transaction() as session:
            session.update(is_admin=True, admin_user={'email': 'admin@example.test'}, _csrf_token='token')
        with patch.object(website, 'upload_file', return_value={'blob_url': 'https://example.test/upload.pdf'}), \
             patch.object(website, 'add_resource', side_effect=add), \
             patch.object(website, 'get_resource_catalogue', side_effect=read):
            for category, endpoint in [('notes', 'notes'), ('assignment', 'assignments'), ('book', 'books')]:
                response = self.client.post('/upload', data={'_csrf_token': 'token', 'category': category,
                    'title': f'Uploaded {category}', 'subject_name': 'Circuits', 'branch': 'ece', 'semester': '4',
                    'file_upload': (io.BytesIO(b'%PDF-1.4 test'), f'{category}.pdf')})
                self.assertEqual(response.status_code, 302)
                page = self.client.get(f'/{endpoint}?branch=ece&semester=4')
                self.assertIn(f'Uploaded {category}'.encode(), page.data)
                self.assertIn(b'https://example.test/upload.pdf', page.data)
                self.assertIn(b'Uploaded by <strong>Admin</strong>', page.data)
                wrong_semester = self.client.get(f'/{endpoint}?branch=ece&semester=3')
                self.assertNotIn(f'Uploaded {category}'.encode(), wrong_semester.data)
            self.assertNotIn(b'Uploaded book', self.client.get('/notes').data)
            self.assertNotIn(b'Uploaded assignment', self.client.get('/books').data)

    def test_database_query_enforces_verified_status_and_pagination(self):
        conn, cur = MagicMock(), MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur
        cur.fetchone.return_value = {'total': 51}
        cur.fetchall.return_value = []
        with patch.object(db_agent, 'get_connection', return_value=conn):
            self.assertEqual(db_agent.get_resource_catalogue('notes', 'cse', '2', 'Math%', 2), ([], 51))
        sql, parameters = cur.execute.call_args.args
        self.assertIn('FROM resources', sql)
        self.assertIn('status = %s', sql)
        self.assertIn('LIMIT 50 OFFSET %s', sql)
        self.assertIn('AS contributor_name', sql)
        self.assertIn('LOWER(BTRIM(resources.uploaded_by))', sql)
        self.assertEqual(parameters, ['notes', 'verified', 'cse', 2, '%Math\\%%', '%Math\\%%', 50])
        conn.close.assert_called_once()

    def test_catalogue_escapes_titles_and_preserves_next_page_filters(self):
        resource = dict(title='<script>alert(1)</script>', branch='cse', semester=2,
            subject_name='Subject', file_name='paper.pdf', file_size=100, blob_url='https://example.test/paper.pdf')
        with patch.object(website, 'get_resource_catalogue', return_value=([resource], 51)):
            page = self.client.get('/books?branch=cse&semester=2&q=Subject')
        self.assertIn(b'&lt;script&gt;', page.data)
        self.assertIn(b'page=2', page.data)
        self.assertIn(b'branch=cse', page.data)
        self.assertIn(b'semester=2', page.data)

    def test_database_outage_is_not_reported_as_empty_library(self):
        with patch.object(website, 'get_resource_catalogue', side_effect=RuntimeError('offline')):
            response = self.client.get('/notes')
        self.assertEqual(response.status_code, 503)
        self.assertIn(b'temporarily unavailable', response.data)
        self.assertNotIn(b'No notes found', response.data)

    def test_uploader_labels_use_admin_or_profile_name_without_exposing_email(self):
        base = dict(title='Notes', branch='cse', semester=2, file_size=100,
                    blob_url='https://example.test/paper.pdf')
        cases = [
            ('admin', None, 'Admin'),
            (' ADMIN@EXAMPLE.TEST ', 'Private admin name', 'Admin'),
            ('student@example.test', 'Alex Singh', 'Alex Singh'),
            ('student@example.test', 'Admin', 'Admin'),
            ('student@example.test', '<script>Student</script>', '&lt;script&gt;Student&lt;/script&gt;'),
            ('deleted@example.test', None, 'User'),
            (None, None, 'User'),
        ]
        for endpoint in ('notes', 'assignments', 'books'):
            for uploader, name, label in cases:
                with self.subTest(endpoint=endpoint, uploader=uploader), patch.object(
                    website, 'get_resource_catalogue', return_value=([
                        dict(base, uploaded_by=uploader, contributor_name=name)], 1)
                ):
                    page = self.client.get('/' + endpoint)
                    self.assertEqual(page.status_code, 200)
                    self.assertIn(f'Uploaded by <strong>{label}</strong>'.encode(), page.data)
                    self.assertNotIn(b'@example.test', page.data)
                    self.assertNotIn(b'<script>Student</script>', page.data)
                    self.assertEqual(b'class="admin-upload-badge"' in page.data,
                                     uploader in ('admin', ' ADMIN@EXAMPLE.TEST '))


if __name__ == '__main__':
    unittest.main()
