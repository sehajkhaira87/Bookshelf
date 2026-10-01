document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('appearanceForm');
    const preview = document.getElementById('appearancePreview');
    if (!form || !preview) return;

    const initial = JSON.stringify(Array.from(new FormData(form)));
    const snowPreview = window.BookshelfSnowfall?.create(preview, true);
    function updatePreview() {
        document.getElementById('previewTitle').textContent = form.elements.dashboard_title.value.trim() || 'Welcome back, Alex';
        document.getElementById('previewSubtitle').textContent = form.elements.dashboard_subtitle.value;
        const banner = document.getElementById('previewBanner');
        banner.textContent = form.elements.banner_text.value.trim();
        banner.hidden = !banner.textContent;
        preview.dataset.palette = form.elements.palette.value;
        preview.dataset.shape = form.elements.card_shape.value;
        preview.dataset.density = form.elements.density.value;
        snowPreview?.setEnabled(form.elements.snowfall_enabled.value === 'on');
        document.getElementById('previewStatus').textContent = JSON.stringify(Array.from(new FormData(form))) === initial ? 'Current appearance' : 'Unpublished changes';
    }
    form.addEventListener('input', updatePreview);
    form.addEventListener('change', updatePreview);
    updatePreview();

    const departmentForm = document.getElementById('departmentForm');
    if (departmentForm) {
        const iconFile = document.getElementById('departmentIconFile');
        const iconStatus = document.getElementById('departmentIconStatus');
        const clearIcon = document.getElementById('clearDepartmentIcon');
        let uploadUrl = '';
        let uploadVersion = 0;

        function releaseUpload() {
            if (uploadUrl) URL.revokeObjectURL(uploadUrl);
            uploadUrl = '';
        }

        function previewDepartment() {
            document.getElementById('departmentPreviewCode').textContent = departmentForm.elements.code.value.trim().toUpperCase() || 'AI';
            document.getElementById('departmentPreviewName').textContent = departmentForm.elements.name.value.trim() || 'Artificial Intelligence';
            if (!iconFile.validationMessage) {
                document.getElementById('departmentPreviewIcon').src = uploadUrl || departmentForm.elements.icon.selectedOptions[0].dataset.iconUrl;
            }
        }

        function uploadError(message) {
            releaseUpload();
            iconFile.setCustomValidity(message);
            iconFile.setAttribute('aria-invalid', 'true');
            iconStatus.textContent = message;
            iconStatus.classList.add('upload-error');
            document.getElementById('departmentPreviewIcon').src = departmentForm.elements.icon.selectedOptions[0].dataset.iconUrl;
        }

        function previewUpload() {
            const version = ++uploadVersion;
            const file = iconFile.files[0];
            releaseUpload();
            iconFile.setCustomValidity('');
            iconFile.removeAttribute('aria-invalid');
            iconStatus.classList.remove('upload-error');
            clearIcon.hidden = !file;
            if (!file) {
                iconStatus.textContent = 'Using the selected built-in icon.';
                previewDepartment();
                return;
            }
            if (file.size > 2 * 1024 * 1024) {
                uploadError('Choose an image that is 2 MB or smaller.');
                return;
            }
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) &&
                !(file.type === '' && /\.(png|jpe?g|webp)$/i.test(file.name))) {
                uploadError('Choose a PNG, JPG, or WebP image.');
                return;
            }
            iconStatus.textContent = 'Loading icon preview…';
            iconFile.setCustomValidity('Wait for the icon preview to load.');
            uploadUrl = URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => {
                if (version !== uploadVersion) return;
                if (image.naturalWidth > 2048 || image.naturalHeight > 2048) {
                    uploadError('Choose an image no larger than 2048 × 2048 pixels.');
                    return;
                }
                iconFile.setCustomValidity('');
                iconStatus.textContent = `Using ${file.name}. It will be published when you add the department.`;
                previewDepartment();
            };
            image.onerror = () => {
                if (version === uploadVersion) uploadError('This image could not be read. Choose a different icon.');
            };
            image.src = uploadUrl;
        }
        departmentForm.addEventListener('input', previewDepartment);
        departmentForm.addEventListener('change', previewDepartment);
        iconFile.addEventListener('change', previewUpload);
        clearIcon.addEventListener('click', () => {
            iconFile.value = '';
            previewUpload();
        });
        previewDepartment();
    }
});
