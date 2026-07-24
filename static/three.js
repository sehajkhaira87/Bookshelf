import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const bookCanvas = document.getElementById('book-canvas');
const page2El    = document.querySelector('.page2');
if (!bookCanvas || !page2El) {
    console.warn('[Book3D] Elements not found');
} else {
    initBook3D(bookCanvas, page2El);
}

function initBook3D(canvas, container) {

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled   = true;
    renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace    = THREE.SRGBColorSpace;
    renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
    camera.position.set(0, 0, 5.6);

    function resize() {
        const w = container.clientWidth;
        const h = container.clientHeight || window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    // ── LIGHTS ──────────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0xfff5e0, 0.7));

    const keyLight = new THREE.DirectionalLight(0xffd590, 2.5);
    keyLight.position.set(3.5, 5, 5);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x8fb8ff, 0.5);
    rimLight.position.set(-5, 1, 2);
    scene.add(rimLight);

    const fillLight = new THREE.PointLight(0xff6020, 0.8, 14);
    fillLight.position.set(0.5, -3.5, 3);
    scene.add(fillLight);

    // ── LOAD GLB ────────────────────────────────────────────────────────────
    let bookGroup = null;
    let bookPivot = null;   // wrapper — mouse animation goes on this
    let mixer     = null;

    const loader = new GLTFLoader();
    loader.load(
        '/static/models/book.glb',

        (gltf) => {
            bookGroup = gltf.scene;

            // Auto-center and scale to fit screen nicely
            const box    = new THREE.Box3().setFromObject(bookGroup);
            const center = box.getCenter(new THREE.Vector3());
            const size   = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale  = 3.2 / maxDim;

            bookGroup.scale.setScalar(scale);
            bookGroup.position.copy(center.multiplyScalar(-scale));

            // ── FIX ORIENTATION ─────────────────────────────────────────────
            // Blender exports the book lying flat (cover facing up).
            // Rotate -90° on X so the cover faces the camera.
            bookGroup.rotation.x = -Math.PI / 2;

            // Shadows on every mesh
            bookGroup.traverse(child => {
                if (child.isMesh) {
                    child.castShadow    = true;
                    child.receiveShadow = true;
                    // Fix white material — keep original color but boost it
                    if (child.material) {
                        child.material.needsUpdate = true;
                    }
                }
            });

            // Wrap in a pivot group so mouse rotation doesn't fight the fix
            bookPivot = new THREE.Group();
            bookPivot.add(bookGroup);

            // Starting angle — nice 3/4 view
            bookPivot.rotation.y =  0.4;
            bookPivot.rotation.x = -0.1;

            scene.add(bookPivot);

            // Animations (if your GLB has page-flip etc.)
            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(bookGroup);
                gltf.animations.forEach(clip => {
                    mixer.clipAction(clip).play();
                });
            }

            console.log('[Book3D] ✅ Loaded!');
        },

        (xhr) => {
            if (xhr.total) {
                console.log(`[Book3D] ${Math.round(xhr.loaded / xhr.total * 100)}%`);
            }
        },

        (err) => {
            console.error('[Book3D] ❌ Load error:', err);
        }
    );

    // ── PARTICLES ───────────────────────────────────────────────────────────
    const COUNT = 200;
    const pPos  = new Float32Array(COUNT * 3);
    const pSeed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
        pPos[i*3]   = (Math.random() - 0.5) * 10;
        pPos[i*3+1] = (Math.random() - 0.5) * 7;
        pPos[i*3+2] = (Math.random() - 0.5) * 6 - 2;
        pSeed[i]    = Math.random() * Math.PI * 2;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos.slice(), 3));
    const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
        color        : 0xFFB050,
        size         : 0.06,
        transparent  : true,
        opacity      : 0.4,
        depthWrite   : false,
        blending     : THREE.AdditiveBlending,
        sizeAttenuation: true,
    }));
    scene.add(particles);

    // ── MOUSE ───────────────────────────────────────────────────────────────
    let mouseNX = 0, mouseNY = 0, inPage2 = false;

    container.addEventListener('mousemove', (e) => {
        const r = container.getBoundingClientRect();
        mouseNX =  ((e.clientX - r.left) / r.width)  * 2 - 1;
        mouseNY = -((e.clientY - r.top)  / r.height) * 2 + 1;
        inPage2 = true;
    }, { passive: true });

    container.addEventListener('mouseleave', () => { inPage2 = false; });

    // ── ANIMATE ─────────────────────────────────────────────────────────────
    let tgtRotX = -0.1, tgtRotY = 0.4;
    let curRotX = -0.1, curRotY = 0.4;
    let running = true;
    const clock = new THREE.Clock();

    function animate(t) {
        if (!running) return;
        requestAnimationFrame(animate);

        const elapsed = t * 0.001;
        const delta   = clock.getDelta();

        // Update animation mixer (page-flip clip)
        if (mixer) mixer.update(delta);

        if (bookPivot) {
            if (inPage2) {
                // Full free rotation — follow cursor in any direction
                tgtRotY =  mouseNX * Math.PI * 0.72;
                tgtRotX = -mouseNY * Math.PI * 0.42;
            } else {
                // Gentle idle swing
                tgtRotY = Math.sin(elapsed * 0.42) * 0.38 + 0.15;
                tgtRotX = Math.sin(elapsed * 0.27) * 0.07 - 0.05;
            }

            const speed = inPage2 ? 0.09 : 0.04;
            curRotX += (tgtRotX - curRotX) * speed;
            curRotY += (tgtRotY - curRotY) * speed;

            bookPivot.rotation.x = curRotX;
            bookPivot.rotation.y = curRotY;

            // Levitation
            bookPivot.position.y = Math.sin(elapsed * 0.55) * 0.09;
        }

        // Drift particles upward
        const pos = pGeo.attributes.position;
        for (let i = 0; i < COUNT; i++) {
            pos.array[i*3+1] += 0.004 + Math.sin(elapsed + pSeed[i]) * 0.001;
            pos.array[i*3]   += Math.sin(elapsed * 0.3 + pSeed[i]) * 0.002;
            if (pos.array[i*3+1] > 4) {
                pos.array[i*3+1] = -4;
                pos.array[i*3]   = (Math.random() - 0.5) * 10;
            }
        }
        pos.needsUpdate      = true;
        particles.rotation.y = elapsed * 0.04;

        renderer.render(scene, camera);
    }

    requestAnimationFrame(animate);

    // Pause render when page2 is off-screen (saves GPU)
    new IntersectionObserver((entries) => {
        entries.forEach(e => {
            running = e.isIntersecting;
            if (running) requestAnimationFrame(animate);
        });
    }, { threshold: 0.05 }).observe(container);
}