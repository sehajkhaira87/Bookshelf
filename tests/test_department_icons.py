"""Custom icon validation, atomic storage, and authorized multipart uploads."""
from io import BytesIO
from unittest import TestCase
from unittest.mock import MagicMock, patch

from PIL import Image
from PIL.PngImagePlugin import PngInfo
from werkzeug.datastructures import FileStorage

from test_pyqs import website
import department_service as service
import ui_settings_service


DETAILS = {'code': 'AI', 'name': 'Artificial Intelligence', 'icon': 'chip'}


def image_bytes(format='PNG', size=(32, 20), **options):
    image = Image.new('RGB' if format == 'JPEG' else 'RGBA', size, (90, 150, 210))
    buffer = BytesIO()
    image.save(buffer, format=format, **options)
    return buffer.getvalue()


def upload(content, filename='custom.png'):
    return FileStorage(stream=BytesIO(content), filename=filename)


class IconValidationTests(TestCase):
    def test_supported_formats_are_decoded_resized_and_encoded_as_png(self):
        for format in ('PNG', 'JPEG', 'WEBP'):
            with self.subTest(format=format):
                icon = service.prepare_icon(upload(image_bytes(format, (512, 256))))
                with Image.open(BytesIO(icon)) as image:
                    self.assertEqual(image.format, 'PNG')
                    self.assertEqual(image.size, (256, 128))
                    self.assertEqual(image.mode, 'RGBA')

    def test_transparency_survives_but_metadata_is_removed(self):
        original = Image.new('RGBA', (20, 20), (30, 80, 150, 100))
        metadata = PngInfo()
        metadata.add_text('Comment', 'Metadata should not be published')
        buffer = BytesIO()
        original.save(buffer, format='PNG', pnginfo=metadata)
        with Image.open(BytesIO(service.prepare_icon(upload(buffer.getvalue())))) as cleaned:
            self.assertEqual(cleaned.getpixel((0, 0)), (30, 80, 150, 100))
            self.assertNotIn('Comment', cleaned.info)

    def test_invalid_oversized_and_active_formats_are_rejected(self):
        invalid = (
            b'', b'<svg xmlns="http://www.w3.org/2000/svg"><script>test</script></svg>',
            b'<html>fake png</html>', image_bytes()[:35],
            b'x' * (service.MAX_ICON_BYTES + 1), image_bytes(size=(2049, 1)),
            image_bytes('GIF'),
        )
        for content in invalid:
            with self.subTest(length=len(content)), self.assertRaises(ValueError):
                service.prepare_icon(upload(content))

    def test_animated_images_are_rejected(self):
        first, second = Image.new('RGBA', (20, 20), 'red'), Image.new('RGBA', (20, 20), 'blue')
        buffer = BytesIO()
        first.save(buffer, format='WEBP', save_all=True, append_images=[second], duration=100, loop=0)
        with self.assertRaisesRegex(ValueError, 'still image'):
            service.prepare_icon(upload(buffer.getvalue(), 'animated.webp'))


class IconPersistenceTests(TestCase):
    def setUp(self):
        self.connection, self.cursor = MagicMock(), MagicMock()
        self.connection.cursor.return_value.__enter__.return_value = self.cursor
        patcher = patch.object(service, 'get_connection', return_value=self.connection)
        self.connect = patcher.start()
        self.addCleanup(patcher.stop)

    def test_image_and_department_share_one_transaction(self):
        self.cursor.fetchone.return_value = {'code': 'AI'}
        service.add_department(DETAILS, 'editor@example.test', icon_file=upload(image_bytes()))
        sql, params = self.cursor.execute.call_args.args
        self.assertIn('icon_png', sql)
        self.assertEqual(params[:4], ('AI', 'Artificial Intelligence', 'chip', 'editor@example.test'))
        self.assertTrue(params[4].startswith(b'\x89PNG\r\n\x1a\n'))
        self.assertEqual(self.cursor.execute.call_count, 1)
        self.connection.__exit__.assert_called_once_with(None, None, None)

    def test_duplicate_or_failed_insert_does_not_leave_a_separate_upload(self):
        for side_effect, result, exception in ((None, None, ValueError), (RuntimeError('offline'), None, service.DepartmentUnavailable)):
            with self.subTest(exception=exception):
                self.cursor.execute.side_effect = side_effect
                self.cursor.fetchone.return_value = result
                with self.assertRaises(exception):
                    service.add_department(DETAILS, 'editor@example.test', icon_file=upload(image_bytes()))
                self.assertIsNotNone(self.connection.__exit__.call_args.args[0])

    def test_invalid_upload_is_rejected_before_database_access(self):
        with self.assertRaises(ValueError):
            service.add_department(DETAILS, 'editor@example.test', icon_file=upload(b'not a picture'))
        self.connect.assert_not_called()

    def test_list_loads_only_icon_presence_and_icon_read_is_bounded_to_code(self):
        self.cursor.fetchall.return_value = [{**DETAILS, 'has_custom_icon': True}]
        self.assertTrue(service.list_departments()[0]['has_custom_icon'])
        self.assertIn('(icon_png IS NOT NULL)', self.cursor.execute.call_args.args[0])
        self.cursor.fetchone.return_value = {'icon_png': memoryview(b'png data')}
        self.assertEqual(service.get_department_icon('ai'), b'png data')
        self.assertEqual(self.cursor.execute.call_args.args[1], ('AI',))
        self.connect.reset_mock()
        self.assertIsNone(service.get_department_icon('../secret'))
        self.connect.assert_not_called()


class IconRouteTests(TestCase):
    def setUp(self):
        self.client = website.app.test_client()
        self.profile = dict(id=20, email='editor@example.test', preferred_name='Alex',
                            profile_completed=True, roles=['ui_editor'], is_banned=False)
        self.departments = [{**DETAILS, 'icon_path': service.ICONS['chip'][1], 'has_custom_icon': True}]
        config = patch.dict(website.app.config, TESTING=True, DEPARTMENT_LOADER=lambda: self.departments)
        config.start()
        self.addCleanup(config.stop)
        for module, name, value in (
            (website, 'get_user_by_email', self.profile),
            (website, 'list_warnings', []),
            (website.communications_service, 'announcement', None),
            (ui_settings_service, 'get_settings', dict(ui_settings_service.DEFAULT_SETTINGS)),
        ):
            patcher = patch.object(module, name, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        with self.client.session_transaction() as signed:
            signed.update(user={'email': self.profile['email']}, _csrf_token='token')

    def data(self, csrf=True):
        return {**DETAILS, **({'_csrf_token': 'token'} if csrf else {}),
                'icon_file': (BytesIO(image_bytes()), 'custom.png')}

    def test_multipart_file_passes_to_service_with_authenticated_actor(self):
        with patch.object(service, 'add_department', return_value=DETAILS) as add:
            response = self.client.post('/dashboard/appearance/departments', data=self.data())
        self.assertEqual(response.status_code, 302)
        self.assertEqual(add.call_args.args[1], self.profile['email'])
        self.assertEqual(add.call_args.kwargs['icon_file'].filename, 'custom.png')
        page = self.client.get('/dashboard/appearance')
        self.assertIn(b'enctype="multipart/form-data"', page.data)
        self.assertIn(b'Upload your own icon', page.data)

    def test_uploaded_icons_still_require_role_and_csrf(self):
        with patch.object(service, 'add_department') as add:
            self.assertEqual(self.client.post('/dashboard/appearance/departments', data=self.data(False)).status_code, 400)
            self.profile['roles'] = ['user_manager']
            self.assertEqual(self.client.post('/dashboard/appearance/departments', data=self.data()).status_code, 403)
            add.assert_not_called()

    def test_custom_icon_appears_in_dashboard_and_editor(self):
        for path in ('/dashboard', '/dashboard/appearance'):
            page = self.client.get(path)
            self.assertEqual(page.status_code, 200)
            self.assertIn(b'src="/departments/AI/icon.png"', page.data)

    def test_public_icon_is_png_cacheable_and_unknown_or_missing_icon_is_404(self):
        icon = image_bytes()
        with self.client.session_transaction() as signed:
            signed.clear()
        with patch.object(service, 'get_department_icon', return_value=icon):
            response = self.client.get('/departments/AI/icon.png')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data, icon)
            self.assertEqual(response.mimetype, 'image/png')
            self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')
            self.assertIn('max-age=86400', response.headers['Cache-Control'])
            cached = self.client.get('/departments/AI/icon.png', headers={'If-None-Match': response.headers['ETag']})
            self.assertEqual(cached.status_code, 304)
        with patch.object(service, 'get_department_icon', return_value=None):
            self.assertEqual(self.client.get('/departments/AI/icon.png').status_code, 404)

    def test_bad_upload_preserves_text_and_asks_to_reselect_image(self):
        with patch.object(service, 'add_department', side_effect=ValueError('Invalid icon')):
            response = self.client.post('/dashboard/appearance/departments', data=self.data())
        self.assertEqual(response.status_code, 400)
        self.assertIn(b'value="Artificial Intelligence"', response.data)
        self.assertIn(b'Choose the image again', response.data)
