"""MST navigation and catalogue regressions without a live database."""
import importlib
import os
import re
import sys
import unittest
from html import unescape
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlsplit

import db_agent
import department_service


class MSTCatalogueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with patch.dict(os.environ, {
            'Emails': 'admin@example.test',
            'flash_secret': 'mst-tests-only',
        }), patch('database.check_connection', return_value=False), \
                patch('logging.Logger.warning'):
            cls.module = importlib.reload(sys.modules['app']) if 'app' in sys.modules else importlib.import_module('app')

    def setUp(self):
        self.module.app.config.update(TESTING=True,
            DEPARTMENT_LOADER=lambda: department_service.DEFAULT_DEPARTMENTS)
        self.client = self.module.app.test_client()

    def test_mst_page_loads_the_selected_course_and_search(self):
        resource = dict(id=1, title='Data Structures MST', branch='cse', semester=3,
            subject_name='Data Structures', uploaded_by='admin',
            blob_url='https://example.test/paper.pdf', file_name='mst.pdf', file_size=1024)
        with patch.object(self.module, 'get_resource_catalogue', return_value=([resource], 1)) as catalogue:
            response = self.client.get('/mst-papers?branch=CSE&semester=3&q=structures')
        self.assertEqual(response.status_code, 200)
        catalogue.assert_called_once_with('mst', 'cse', '3', 'structures', 1)
        self.assertIn(b'<h1>MST Papers</h1>', response.data)
        self.assertIn(b'Data Structures MST', response.data)
        self.assertIn(b'https://example.test/paper.pdf', response.data)
        self.assertIn(b'/mst-papers?branch=cse&amp;semester=3" aria-current="page"', response.data)

    def test_mst_is_reachable_from_all_four_dashboard_destinations(self):
        with patch.object(self.module, 'get_resource_catalogue', return_value=([], 0)), \
                patch.object(self.module, 'list_pyqs', return_value=([], 0)), \
                patch.object(self.module, 'get_pyq_summary', return_value={'total': 0, 'years': []}):
            for endpoint in ('notes', 'assignments', 'books', 'pyqs'):
                with self.subTest(endpoint=endpoint):
                    response = self.client.get(f'/{endpoint}?branch=ece&semester=5')
                    self.assertEqual(response.status_code, 200)
                    self.assertIn(b'/mst-papers?branch=ece&amp;semester=5', response.data)
                    self.assertIn(b'>MST Papers</a>', response.data)

    def test_mst_filters_survive_navigation_back_to_the_other_materials(self):
        with patch.object(self.module, 'get_resource_catalogue', return_value=([], 0)):
            response = self.client.get('/mst-papers?branch=it&semester=7')
        for endpoint in ('notes', 'assignments', 'books'):
            self.assertIn(f'/{endpoint}?branch=it&amp;semester=7'.encode(), response.data)
        self.assertIn(b'No mst papers found', response.data)

    def test_invalid_mst_filters_are_rejected_before_loading_papers(self):
        with patch.object(self.module, 'get_resource_catalogue') as catalogue:
            for query in ('branch=unknown', 'semester=9', 'semester=0', 'page=0', 'page=not-a-page'):
                with self.subTest(query=query):
                    self.assertEqual(self.client.get('/mst-papers?' + query).status_code, 400)
        catalogue.assert_not_called()

    def test_pyq_search_and_pagination_keep_the_course_for_the_mst_link(self):
        with patch.object(self.module, 'list_pyqs', return_value=([], 150)) as catalogue, \
                patch.object(self.module, 'get_pyq_summary', return_value={'total': 150, 'years': [2025]}):
            response = self.client.get('/pyqs?branch=cse&semester=5&q=networks&year=2025&page=2')
        self.assertEqual(response.status_code, 200)
        catalogue.assert_called_once_with('networks', 2025, 2)
        text = response.get_data(as_text=True)
        self.assertIn('name="branch" value="cse"', text)
        self.assertIn('name="semester" value="5"', text)
        self.assertIn('/mst-papers?branch=cse&amp;semester=5', text)
        pagination = re.findall(r'<a href="([^"]+)">(Previous|Next)</a>', text)
        self.assertEqual(len(pagination), 2)
        for href, label in pagination:
            params = parse_qs(urlsplit(unescape(href)).query)
            self.assertEqual(params['branch'], ['cse'])
            self.assertEqual(params['semester'], ['5'])
            self.assertEqual(params['q'], ['networks'])
            self.assertEqual(params['year'], ['2025'])
            self.assertEqual(params['page'], ['1' if label == 'Previous' else '3'])

    def test_mst_pagination_keeps_the_selected_filters(self):
        with patch.object(self.module, 'get_resource_catalogue', return_value=([], 150)):
            response = self.client.get('/mst-papers?branch=cse&semester=5&q=physics&page=2')
        text = response.get_data(as_text=True)
        pagination = re.findall(r'<a href="([^"]+)">(← Previous|Next →)</a>', text)
        self.assertEqual(len(pagination), 2)
        for href, _ in pagination:
            parts = urlsplit(unescape(href))
            self.assertEqual(parts.path, '/mst-papers')
            params = parse_qs(parts.query)
            self.assertEqual(params['branch'], ['cse'])
            self.assertEqual(params['semester'], ['5'])
            self.assertEqual(params['q'], ['physics'])

    def test_clearing_a_pyq_search_without_a_selected_course_keeps_the_original_url(self):
        with patch.object(self.module, 'list_pyqs', return_value=([], 0)), \
                patch.object(self.module, 'get_pyq_summary', return_value={'total': 0, 'years': []}):
            response = self.client.get('/pyqs?q=missing')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'class="clear-search" href="/pyqs"', response.data)
        self.assertIn(b'class="pyq-empty-reset" href="/pyqs"', response.data)

    def test_an_mst_database_outage_keeps_navigation_and_reports_unavailable(self):
        with patch.object(self.module, 'get_resource_catalogue', side_effect=RuntimeError('Unavailable')), \
                self.assertLogs('app', level='ERROR'):
            response = self.client.get('/mst-papers?branch=cse&semester=5')
        self.assertEqual(response.status_code, 503)
        self.assertIn(b'This library is temporarily unavailable.', response.data)
        self.assertIn(b'>MST Papers</a>', response.data)
        self.assertNotIn(b'0 resources', response.data)

    def test_mst_queries_only_verified_papers_and_closes_the_connection(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = {'total': 1}
        cursor.fetchall.return_value = [{'id': 1, 'title': 'MST paper'}]
        with patch.object(db_agent, 'get_connection', return_value=connection):
            rows, total = db_agent.get_resource_catalogue('mst', 'cse', '5', '50%_test', 3)
        self.assertEqual(total, 1)
        self.assertEqual(rows[0]['title'], 'MST paper')
        self.assertEqual(cursor.execute.call_count, 2)
        for call in cursor.execute.call_args_list:
            sql, params = call.args
            self.assertIn('category = %s', sql)
            self.assertIn('status = %s', sql)
            self.assertEqual(params[:4], ['mst', 'verified', 'cse', 5])
            self.assertNotIn('50%_test', sql)
            self.assertEqual(params[4:6], ['%50\\%\\_test%', '%50\\%\\_test%'])
        self.assertEqual(cursor.execute.call_args.args[1][-1], 100)
        connection.close.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
