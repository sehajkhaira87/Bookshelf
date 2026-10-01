document.addEventListener('DOMContentLoaded', () => {
    const stateStart = document.getElementById('state-start');
    const stateOptions = document.getElementById('state-options');
    const stateForm = document.getElementById('state-form');
    
    const startBtn = document.querySelector('.big-contribute-btn');
    const cancelOptionsBtn = document.getElementById('btn-cancel-options');
    const btnCamera = document.getElementById('btn-camera');
    const btnUpload = document.getElementById('btn-upload');
    const btnCancelFile = document.getElementById('btn-cancel-file');
    
    const nativeUpload = document.getElementById('native-upload');
    const nativeCamera = document.getElementById('native-camera');
    const fileNameDisplay = document.getElementById('file-name-display');

    startBtn.addEventListener('click', () => {
        stateStart.classList.add('hidden');
        stateOptions.classList.remove('hidden');
    });

    cancelOptionsBtn.addEventListener('click', () => {
        stateOptions.classList.add('hidden');
        stateStart.classList.remove('hidden');
    });

    btnUpload.addEventListener('click', () => nativeUpload.click());
    btnCamera.addEventListener('click', () => nativeCamera.click());

    const handleFileSelect = (event) => {
        const file = event.target.files[0];
        if (file) {
            fileNameDisplay.textContent = file.name;
            stateOptions.classList.add('hidden');
            stateForm.classList.remove('hidden');
        }
    };

    nativeUpload.addEventListener('change', handleFileSelect);
    nativeCamera.addEventListener('change', handleFileSelect);

    btnCancelFile.addEventListener('click', (e) => {
        e.preventDefault(); 
        nativeUpload.value = ''; 
        nativeCamera.value = '';
        stateForm.classList.add('hidden');
        stateOptions.classList.remove('hidden');
    });
});