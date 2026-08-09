import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const bookCanvas = document.getElementById('book-canvas');
const page2El = document.querySelector('.page2');
if (bookCanvas && page2El) initBook3D(bookCanvas, page2El);

function initBook3D(canvas, container) {

 container.style.backgroundColor = '#16100c';

 const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
 renderer.setClearColor(0x16100c, 1);
 renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
 renderer.shadowMap.enabled = true;
 renderer.shadowMap.type = THREE.PCFSoftShadowMap;
 renderer.outputColorSpace = THREE.SRGBColorSpace;
 renderer.toneMapping = THREE.ACESFilmicToneMapping;
 renderer.toneMappingExposure = 0.9;

 const scene = new THREE.Scene();
 scene.background = new THREE.Color(0x16100c);

 const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
 camera.position.set(0, 0, 6);

 function resize() {
 const w = container.clientWidth;
 const h = container.clientHeight || window.innerHeight;
 renderer.setSize(w, h, false);
 camera.aspect = w / h;
 camera.updateProjectionMatrix();
 }
 resize();
 window.addEventListener('resize', resize, { passive: true });

 
 const ambient = new THREE.AmbientLight(0xfff5e0, 0.4);
 scene.add(ambient);

 const key = new THREE.DirectionalLight(0xffd590, 2.5); 
 key.position.set(3, 5, 4); 
 key.castShadow = true; 
 key.shadow.mapSize.width = 1024;
 key.shadow.mapSize.height = 1024;
 key.shadow.bias = -0.0001;
 scene.add(key);

 const rim = new THREE.DirectionalLight(0x9ab8ff, 0.4);
 rim.position.set(-5, 2, 3); 
 scene.add(rim);

 //  INVISIBLE SHADOW RECEIVER PLANE 
 const shadowPlaneGeo = new THREE.PlaneGeometry(10, 10);
 const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.35 });
 const shadowReceiver = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
 shadowReceiver.rotation.x = -Math.PI / 2;
 shadowReceiver.position.set(2.3, -1.2, 0); 
 shadowReceiver.receiveShadow = true;
 scene.add(shadowReceiver);

 //  COMPACT SPOTLIGHT AURA 
 const auraGeo = new THREE.PlaneGeometry(4.5, 4.5);
 const auraCanvas = document.createElement('canvas');
 auraCanvas.width = 256; auraCanvas.height = 256;
 const actx = auraCanvas.getContext('2d');
 const agrad = actx.createRadialGradient(128, 128, 0, 128, 128, 128);
 agrad.addColorStop(0, 'rgba(255, 190, 110, 0.45)'); 
 agrad.addColorStop(0.45, 'rgba(90, 55, 30, 0.25)'); 
 agrad.addColorStop(1, 'rgba(22, 16, 12, 0)'); 
 actx.fillStyle = agrad;
 actx.fillRect(0, 0, 256, 256);

 const auraTexture = new THREE.CanvasTexture(auraCanvas);
 const auraMat = new THREE.MeshBasicMaterial({
 map: auraTexture,
 transparent: true,
 blending: THREE.AdditiveBlending,
 depthWrite: false
 });
 const auraMesh = new THREE.Mesh(auraGeo, auraMat);
 auraMesh.position.set(2.3, 0, -0.5); 
 auraMesh.scale.set(0, 0, 0);
 scene.add(auraMesh);

 //  SLOW MOTION FALLING LIGHT MOLECULE 
 const particleGeo = new THREE.SphereGeometry(0.06, 16, 16);
 const particleMat = new THREE.MeshBasicMaterial({ color: 0xffd590, transparent: true, opacity: 0.95 });
 const lightMolecule = new THREE.Mesh(particleGeo, particleMat);
 lightMolecule.position.set(0, 5.0, 0);
 scene.add(lightMolecule);

 //  LOAD GLB 
 let bookPivot = null;
 let introPlayed = false;
 let idleStartTime = 0;
 let startYOffset = 0;

 const loader = new GLTFLoader();
 loader.load(
 '/static/models/book.glb',
 (gltf) => {
 const bookGroup = gltf.scene;

 const box = new THREE.Box3().setFromObject(bookGroup);
 const center = box.getCenter(new THREE.Vector3());
 const size = box.getSize(new THREE.Vector3());
 const sc = 2.5 / Math.max(size.x, size.y, size.z);
 bookGroup.scale.setScalar(sc);
 bookGroup.position.copy(center.multiplyScalar(-sc));
 bookGroup.rotation.x = Math.PI / 2;
 bookGroup.rotation.y = 0.0;

 bookGroup.traverse(child => {
 if (child.isMesh) {
 child.castShadow = true;
 child.receiveShadow = true;
 
 if (child.material) {
 child.material.roughness = Math.max(child.material.roughness || 0, 0.5);
 child.material.metalness = Math.min(child.material.metalness || 0, 0.2);
 }
 }
 });
 initScrollCueBook(bookGroup);

 bookPivot = new THREE.Group();
 bookPivot.add(bookGroup);
 scene.add(bookPivot);

 renderer.compile(scene, camera);

 bookPivot.scale.setScalar(0); 
 bookPivot.position.set(0, 0, 0); 
 bookPivot.rotation.set(0.3, 0, 0.1); 

 //  CINEMATIC SEQUENCE 
 if (typeof gsap !== 'undefined') {
 ScrollTrigger.create({
 trigger: container,
 start: 'top 78%',
 once: true,
 onEnter: () => {
 const dropTl = gsap.timeline();

 dropTl.to(lightMolecule.position, {
 y: 0,
 duration: 2.8,
 ease: 'power1.in',
 })
 .to(lightMolecule.scale, {
 x: 4, y: 4, z: 4,
 duration: 0.4,
 ease: 'power2.out'
 }, '-=0.3')
 .to(lightMolecule.material, {
 opacity: 0,
 duration: 0.4
 }, '-=0.4')
 
 .to(auraMesh.scale, {
 x: 1, y: 1, z: 1,
 duration: 1.0,
 ease: 'back.out(1.7)'
 }, '-=0.3')
 .to(bookPivot.scale, {
 x: 1.5, y: 1.5, z: 1.5,
 duration: 1.0,
 ease: 'back.out(1.5)',
 onComplete: () => {
 const mainTl = gsap.timeline({
 onComplete: () => {
 idleStartTime = performance.now() * 0.001;
 startYOffset = bookPivot.rotation.y;
 introPlayed = true;
 
 }
 });

 mainTl.to(bookPivot.position, {
 x : 2.3, 
 y : 0,
 duration: 4.8,
 ease : 'power2.inOut',
 }, 0)

 .to(auraMesh.position, {
 x : 2.3,
 duration: 4.8,
 ease : 'power2.inOut',
 }, 0)

 .to(bookPivot.rotation, {
 y : `+=${Math.PI * 2.5}`, 
 x : -0.10,
 z : 0,
 duration: 4.8,
 ease : 'power2.inOut',
 }, 0)

 .to(bookPivot.scale, {
 x : 1,
 y : 1,
 z : 1,
 duration: 4.8,
 ease : 'power2.inOut',
 }, 0);
 }
 }, '-=0.8');
 }
 });
 }
 },
 (xhr) => { if (xhr.total) console.log(`[Book3D] ${Math.round(xhr.loaded/xhr.total*100)}%`); },
 (err) => { console.error('[Book3D] ❌', err); }
 );

 // MOUSE HOVER 
 let mx = 0, my = 0, hov = false;
 container.style.cursor = 'grab';
 container.addEventListener('mousemove', e => {
 const r = container.getBoundingClientRect();
 mx = ((e.clientX - r.left) / r.width) * 2 - 1;
 my = -((e.clientY - r.top) / r.height) * 2 + 1;
 hov = true;
 }, { passive: true });
 container.addEventListener('mouseleave', () => { hov = false; });

 // RENDER LOOP 
 let running = true;
 let baseX = 2.3;

 function animate(t) {
 if (!running) return;
 requestAnimationFrame(animate);
 const e = t * 0.001;

 if (auraMesh && introPlayed) {
 const scalePulse = 1 + Math.sin(e * 1.5) * 0.04;
 auraMesh.scale.set(scalePulse, scalePulse, 1);
 }

 if (bookPivot && introPlayed) {
 const it = e - idleStartTime;

 if (hov) {
 let targetX = -my * Math.PI * 0.35;
 let targetY = mx * Math.PI * 0.45 + startYOffset + (it * 0.12); 
 bookPivot.rotation.x += (targetX - bookPivot.rotation.x) * 0.06;
 bookPivot.rotation.y += (targetY - bookPivot.rotation.y) * 0.06;
 } else {
 bookPivot.rotation.y = startYOffset + (it * 0.12); 
 bookPivot.rotation.x = -0.10 + Math.sin(it * 0.4) * 0.03;
 bookPivot.rotation.z = Math.sin(it * 0.31) * 0.025;
 }

 bookPivot.position.y = Math.sin(it * 0.55) * 0.07;
 bookPivot.position.x = baseX + Math.sin(it * 0.2) * 0.025;
 
 shadowReceiver.position.x = bookPivot.position.x;
 }

 renderer.render(scene, camera);
 }
 requestAnimationFrame(animate);

 new IntersectionObserver(es => {
 es.forEach(e => { running = e.isIntersecting; if (running) requestAnimationFrame(animate); });
 }, { threshold: 0.05 }).observe(container);
}

function initScrollCueBook(sourceBookGroup) {
 const cueCanvas = document.getElementById('scrollCueCanvas');
 if (!cueCanvas) return;

 const cueRenderer = new THREE.WebGLRenderer({
 canvas: cueCanvas,
 antialias: true,
 alpha: true,
 });
 cueRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
 cueRenderer.setSize(64, 68, false);
 cueRenderer.outputColorSpace = THREE.SRGBColorSpace;
 cueRenderer.toneMapping = THREE.ACESFilmicToneMapping;
 cueRenderer.toneMappingExposure = 1.0;

 const cueScene = new THREE.Scene();
 const cueCamera = new THREE.PerspectiveCamera(35, 64 / 68, 0.1, 20);
 cueCamera.position.set(0, 0, 4);

 cueScene.add(new THREE.AmbientLight(0xfff5e0, 1.1));
 const cueKey = new THREE.DirectionalLight(0xffd590, 1.8);
 cueKey.position.set(2, 3, 3);
 cueScene.add(cueKey);

 const cueBook = sourceBookGroup.clone(true);

 const box = new THREE.Box3().setFromObject(cueBook);
 const center = box.getCenter(new THREE.Vector3());
 const size = box.getSize(new THREE.Vector3());
 const sc = 1.7 / Math.max(size.x, size.y, size.z);
 cueBook.scale.setScalar(sc);
 cueBook.position.copy(center).multiplyScalar(-sc);
 cueBook.rotation.x = 0.35;

 cueScene.add(cueBook);

 function animateCue(t) {
 requestAnimationFrame(animateCue);
 cueBook.rotation.y = t * 0.0005;
 cueRenderer.render(cueScene, cueCamera);
 }
 requestAnimationFrame(animateCue);
} 