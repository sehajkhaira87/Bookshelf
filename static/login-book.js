import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.getElementById('login-book-canvas');
if (canvas) initLoginBook(canvas);

function initLoginBook(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);
    camera.position.set(0, 0, 6);

    function resize() {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    scene.add(new THREE.AmbientLight(0xfff5e0, 0.6));
    const key = new THREE.DirectionalLight(0xffd590, 2.2);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ab8ff, 0.35);
    rim.position.set(-5, 2, 3);
    scene.add(rim);

    let book = null;

    new GLTFLoader().load(
        '/static/models/book.glb',
        (gltf) => {
            book = gltf.scene;

            const box = new THREE.Box3().setFromObject(book);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const sc = 2.6 / Math.max(size.x, size.y, size.z);
            book.scale.setScalar(sc);
            book.position.copy(center).multiplyScalar(-sc);
            book.rotation.set(0, 0, 0);

            scene.add(book);
        },
        undefined,
        (err) => console.error('[LoginBook] failed to load:', err)
    );

    function animate(t) {
        requestAnimationFrame(animate);
        if (book) {
            book.rotation.y = t * 0.0006;
            book.position.y = Math.sin(t * 0.0008) * 0.06;
        }
        renderer.render(scene, camera);
    }
    requestAnimationFrame(animate);
}