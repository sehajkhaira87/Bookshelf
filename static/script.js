// Effects share a single-flight scheduler. Visibility also applies after resizing
// to tablet/mobile, where the second section may be hidden by the existing CSS.
window.createDesktopAnimationLoop = function (element, render, isEnabled = () => true) {
 const desktop = window.matchMedia('(min-width: 961px) and (hover: hover) and (pointer: fine)');
 let frame = null;
 let visible = false;
 const active = () => visible && !document.hidden && isEnabled();
 function request() {
  if (frame !== null || !active()) return;
  frame = requestAnimationFrame(time => {
   frame = null;
   if (active()) render(time);
  });
 }
 function cancel() {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
 }
 function sync() {
  if (active()) request(); else cancel();
 }
 new IntersectionObserver(entries => {
  visible = entries[0].isIntersecting;
  sync();
 }).observe(element);
 document.addEventListener('visibilitychange', sync);
 desktop.addEventListener('change', sync);
 return { request, cancel, get desktop() { return desktop.matches; } };
};

gsap.registerPlugin(ScrollTrigger);
if ("scrollRestoration" in history) {
 history.scrollRestoration = "manual";
}

window.addEventListener("load", () => {

 requestAnimationFrame(() => {
 window.scrollTo(0, 0);

 lenis.scrollTo(0, {
 immediate: true
 });

 ScrollTrigger.refresh();
 });

});
const lenis = new Lenis({
 duration: 1.2,
 smoothWheel: true
});

lenis.on("scroll", ScrollTrigger.update);

gsap.ticker.add((time) => {
 lenis.raf(time * 1000);
});

gsap.ticker.lagSmoothing(0);

// Prepare the heading and critical assets behind the loader, then reveal once.
window.bookshelfIntro.start({ gsap, SplitType, refresh: () => ScrollTrigger.refresh() });

// BULB PHYSICS & INTERACTION
const bulbEl = document.querySelector('.bulb');
const bulbWrapper = document.querySelector('.bulb-wrapper');
const heroEl = document.querySelector('.hero');
const ropeCanvas = document.getElementById('rope-canvas');
const ropeCtx = ropeCanvas.getContext('2d');
const reducedBulbMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const ROPE_LENGTH = 50;
const SOCKET_Y = 44;
const bulbPhysics = new BulbCord();
bulbWrapper.setAttribute('aria-label', 'Toggle hanging light; grab to lift or swing; arrow keys to swing');
let bulbRunning = true, bulbAvailable = false;
let isLightOn = true;
let bulbParallaxY = 0;
let anchorX = 0, geometryKey = '';
let ropeSize = { width: 0, height: 0 };
let bulbLoop = null, bulbFrame = null, lastBulbTime = null;
let activePointer = null, dragDistance = 0;
let pointerStart = { x: 0, y: 0, time: 0 };

function bulbPoint(event) {
 const rect = heroEl.getBoundingClientRect();
 return { x: event.clientX - rect.left, y: event.clientY - rect.top - bulbParallaxY };
}

function renderBulb() {
 if (!bulbAvailable) return;
 const socket = bulbPhysics.getSocket(), body = bulbPhysics.body;
 bulbWrapper.style.transform = `translateX(calc(-50% + ${socket.x - anchorX}px)) translateY(${bulbParallaxY}px)`;
 bulbWrapper.style.top = `${socket.y - SOCKET_Y}px`;
 bulbEl.style.transform = `rotate(${body.a}rad)`;
 ropeCtx.clearRect(0, 0, ropeSize.width, ropeSize.height);
 const points = [...bulbPhysics.nodes, socket];
 ropeCtx.beginPath();
 ropeCtx.moveTo(points[0].x, points[0].y);
 for (let i = 1; i < points.length - 1; i++) {
  ropeCtx.quadraticCurveTo(points[i].x, points[i].y,
   (points[i].x + points[i + 1].x) / 2, (points[i].y + points[i + 1].y) / 2);
 }
 ropeCtx.lineTo(socket.x, socket.y);
 ropeCtx.strokeStyle = '#1a1a1a';
 ropeCtx.lineWidth = 2.5;
 ropeCtx.lineCap = 'round';
 ropeCtx.lineJoin = 'round';
 ropeCtx.stroke();
 ropeCanvas.style.transform = `translateY(${bulbParallaxY}px)`;
}

function stopBulb() {
 finishBulbDrag(null, true);
 if (bulbLoop) bulbLoop.cancel();
 if (bulbFrame !== null) cancelAnimationFrame(bulbFrame);
 bulbFrame = lastBulbTime = null;
 bulbPhysics.freeze();
}

function startBulb() {
 if (!bulbRunning || !bulbAvailable || document.hidden) return;
 if (bulbLoop) bulbLoop.request();
 else if (bulbFrame === null) bulbFrame = requestAnimationFrame(animateBulb);
}

function refreshBulbGeometry() {
 const image = bulbEl.querySelector('img');
 const imageHeight = image.clientHeight, imageWidth = image.clientWidth;
 const width = ropeCanvas.clientWidth, height = ropeCanvas.clientHeight;
 // Respect the existing mobile layout, where the hanging bulb is hidden.
 bulbAvailable = imageHeight > SOCKET_Y && width > 0 && height > 0;
 if (!bulbAvailable) { stopBulb(); return; }
 anchorX = heroEl.clientWidth * 0.60;
 const dpr = Math.min(window.devicePixelRatio || 1, 2);
 const nextKey = [width, height, imageWidth, imageHeight, anchorX, dpr].join(':');
 if (nextKey !== geometryKey) {
  finishBulbDrag(null, true);
  geometryKey = nextKey;
  const centreY = imageHeight * 0.78;
  bulbPhysics.configure({
   anchorX, anchorY: 0, length: ROPE_LENGTH,
   socketDistance: Math.max(15, centreY - SOCKET_Y),
   halfWidth: imageWidth / 2,
   bodyTop: centreY - imageHeight * 0.35,
   bodyBottom: imageHeight - centreY, width, height
  });
  lastBulbTime = null;
  ropeSize = { width, height };
  ropeCanvas.width = Math.round(width * dpr);
  ropeCanvas.height = Math.round(height * dpr);
  ropeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
 }
 renderBulb();
 startBulb();
}

bulbWrapper.addEventListener('pointerdown', event => {
 if (event.button !== 0 || activePointer !== null || !event.isPrimary || !bulbAvailable) return;
 activePointer = event.pointerId;
 pointerStart = { x: event.clientX, y: event.clientY, time: performance.now() };
 dragDistance = 0;
 // The hand holds the exact point clicked, including while the bulb rotates.
 bulbPhysics.beginDrag(bulbPoint(event), pointerStart.time);
 bulbWrapper.setPointerCapture(event.pointerId);
 event.preventDefault();
 startBulb();
});

bulbWrapper.addEventListener('pointermove', event => {
 if (event.pointerId !== activePointer) return;
 dragDistance = Math.max(dragDistance, Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y));
 bulbPhysics.moveDrag(bulbPoint(event), performance.now(), reducedBulbMotion.matches);
 if (reducedBulbMotion.matches) renderBulb();
 event.preventDefault();
 startBulb();
});

function finishBulbDrag(event, cancelled = false) {
 if (activePointer === null || (event && event.pointerId !== activePointer)) return;
 const pointer = activePointer;
 activePointer = null;
 if (event) dragDistance = Math.max(dragDistance, Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y));
 bulbPhysics.endDrag(performance.now(), cancelled);
 if (bulbWrapper.hasPointerCapture(pointer)) bulbWrapper.releasePointerCapture(pointer);
 if (reducedBulbMotion.matches) { bulbPhysics.reset(); renderBulb(); }
 if (!cancelled && dragDistance < 8 && performance.now() - pointerStart.time < 300) toggleLight();
 if (!cancelled) startBulb();
 return true;
}

bulbWrapper.addEventListener('pointerup', event => finishBulbDrag(event));
bulbWrapper.addEventListener('pointercancel', event => { if (finishBulbDrag(event, true)) startBulb(); });
bulbWrapper.addEventListener('lostpointercapture', event => { if (finishBulbDrag(event, true)) startBulb(); });
window.addEventListener('blur', stopBulb);
window.addEventListener('focus', startBulb);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopBulb(); else startBulb(); });
bulbWrapper.addEventListener('keydown', event => {
 if (event.key === 'Enter' || event.key === ' ') {
  event.preventDefault();
  if (!event.repeat) toggleLight();
 } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
  event.preventDefault();
  if (!reducedBulbMotion.matches && activePointer === null) {
   bulbPhysics.nudge(event.key === 'ArrowRight' ? 1 : -1);
   startBulb();
  }
 }
});

function toggleLight() {
 isLightOn = !isLightOn;
 bulbWrapper.setAttribute('aria-pressed', String(isLightOn));
 heroEl.classList.toggle('lights-off', !isLightOn);
 bulbEl.classList.toggle('on', isLightOn);
 if (isLightOn && !reducedBulbMotion.matches) {
  bulbEl.classList.add('flicker');
  setTimeout(() => bulbEl.classList.remove('flicker'), 700);
 }
}

function animateBulb(time) {
 bulbFrame = null;
 if (!bulbRunning || !bulbAvailable || document.hidden) { lastBulbTime = null; return; }
 // Hidden/offscreen time cannot become a large impulse on returning.
 const elapsed = lastBulbTime === null || time - lastBulbTime > 250 ? 0 : (time - lastBulbTime) / 1000;
 lastBulbTime = time;
 if (!reducedBulbMotion.matches) bulbPhysics.advance(elapsed, time);
 renderBulb();
 if (!reducedBulbMotion.matches && bulbPhysics.awake) startBulb();
 else lastBulbTime = null;
}

bulbLoop = window.createDesktopAnimationLoop(heroEl, animateBulb, () => bulbRunning && bulbAvailable);
new ResizeObserver(refreshBulbGeometry).observe(heroEl);
new ResizeObserver(refreshBulbGeometry).observe(bulbEl);
window.addEventListener('resize', refreshBulbGeometry, { passive: true });
ScrollTrigger.addEventListener('refresh', refreshBulbGeometry);
reducedBulbMotion.addEventListener('change', () => {
 stopBulb();
 bulbPhysics.reset();
 renderBulb();
 startBulb();
});
refreshBulbGeometry();
bulbEl.classList.add('on');

//SCROLL PARALLAX 

// Reuse setters instead of constructing four new tweens on every scroll update.
const setHeroTextY = gsap.quickSetter('.hero-text', 'y', 'px');
const setHeroImageY = gsap.quickSetter('.hero-image', 'y', 'px');
const setFeaturesY = gsap.quickSetter('.features-container', 'y', 'px');
const setCatY = gsap.quickSetter('.cat', 'y', 'px');

ScrollTrigger.create({
 trigger: ".hero",
 start: "top top",
 end: "bottom top",
 scrub: 2,

 onUpdate: self => {
 const p = self.progress;
 setHeroTextY(p * -180);
 setHeroImageY(p * -100);
 setFeaturesY(p * -60);
 bulbParallaxY = p * -40; // Keep the socket and cord together during parallax.
 startBulb();
 setCatY(p * -100);
 }
});

// FEATURES TIMELINE 

const featuresTl = gsap.timeline({

 scrollTrigger: {
 trigger: ".features",
 start: "top 80%",
 toggleActions: "play none none none"
 }

});

featuresTl.from(".features-container", {

 opacity: 0,
 scaleX: 0.82,

 duration: 1.35,

 ease: "power3.out"

})

.from(".divider", {

 scaleY: 0,

 transformOrigin: "top center",

 duration: 0.65,

 stagger: 0.07,

 ease: "power2.out"

}, "-=0.5")

// Icons
.from(".feature-icon", {

 opacity: 0,

 scale: 0.88,

 duration: 0.55,

 stagger: 0.1,

 ease: "back.out(1.7)"

}, "-=0.25")

// Headings
.from(".feature-text h3", {

 opacity: 0,

 y: 181,

 duration: 1.45,

 stagger: 0.08,

 ease: "power2.out"

}, "-=0.35")

// Paragraphs
.from(".feature-text p", {

 opacity: 0,

 y: 12,

 duration: 0.7,

 stagger: 0.08,

 ease: "power2.out"

}, "-=0.3");

//  FRAME SEQUENCE (OPTIMIZED) 

//const canvas = document.getElementById("sequence-canvas");
//const context = canvas.getContext("2d", { alpha: false });//

/*const frameCount = 120;

// Scale canvas to actual viewport — avoids drawing at unnecessarily high resolution
function sizeCanvas() {
 const dpr = Math.min(window.devicePixelRatio || 1, 2);
 const w = canvas.clientWidth;
 const h = canvas.clientHeight;
 canvas.width = w * dpr;
 canvas.height = h * dpr;
 context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

sizeCanvas();
window.addEventListener("resize", () => {
 sizeCanvas();
 render();
}, { passive: true });

// Use WebP frames (~45KB each vs ~800KB PNGs)
const currentFrame = (index) =>
 `/static/frames/webp/frame_${String(index + 1).padStart(4, "0")}.webp`;

const images = new Array(frameCount);
let loadedCount = 0;
const frame = { current: 0 };

// Lazy-load in batches to avoid saturating the network and memory
const BATCH_SIZE = 10;

function loadBatch(startIdx) {
 const end = Math.min(startIdx + BATCH_SIZE, frameCount);
 for (let i = startIdx; i < end; i++) {
 const img = new Image();
 img.decoding = "async";
 img.src = currentFrame(i);
 img.onload = () => {
 loadedCount++;
 if (loadedCount === 1) render(); // render first frame as soon as it's ready
 };
 images[i] = img;
 }
 if (end < frameCount) {
 // Schedule next batch on next idle callback or after a short delay
 if ("requestIdleCallback" in window) {
 requestIdleCallback(() => loadBatch(end));
 } else {
 setTimeout(() => loadBatch(end), 50);
 }
 }
}

loadBatch(0);

let renderPending = false;

function render() {
 if (renderPending) return;
 renderPending = true;

 requestAnimationFrame(() => {
 renderPending = false;
 const img = images[frame.current];
 if (!img || !img.complete) return;

 const cw = canvas.clientWidth;
 const ch = canvas.clientHeight;
 context.clearRect(0, 0, cw, ch);
 context.drawImage(img, 0, 0, cw, ch);
 });
}

gsap.to(frame, {

 current: frameCount - 1,

 snap: "current",

 ease: "none",

 scrollTrigger: {

 trigger: ".sequence-section",

 start: "top top",

 end: "bottom bottom",

 scrub: 1,

 pin: true

 },

 onUpdate: render

});*/



ScrollTrigger.create({
 trigger: ".hero",
 start: "top bottom",
 end: "bottom top",
 onEnter: () => { bulbRunning = true; startBulb(); },
 onLeave: () => { bulbRunning = false; stopBulb(); },
 onEnterBack: () => { bulbRunning = true; startBulb(); },
 onLeaveBack: () => { bulbRunning = false; stopBulb(); }
});

//  PENCIL DRAW TRAIL (page2) //
/*(function () {
 const page2 = document.querySelector(".page2");
 if (!page2) return;

 const svg = page2.querySelector("#trail-svg");
 const pencil = page2.querySelector("#pencil");
 if (!svg || !pencil) return;

 const TRAIL_LIFETIME = 1000;
 const MAX_POINTS = 200;
 let points = [];
 let lastX = null, lastY = null, lastAngle = -45;
 let active = false;

 function addPoint(x, y) {
 points.push({ x, y, t: performance.now() });
 if (points.length > MAX_POINTS) points.shift();
 }

 function updatePencil(x, y) {
 pencil.style.transform = `translate(${x - 23}px, ${y - 23}px)`;
 if (lastX !== null) {
 const dx = x - lastX, dy = y - lastY;
 if (Math.hypot(dx, dy) > 1) lastAngle = Math.atan2(dy, dx) * 180 / Math.PI;
 }
 pencil.querySelector("g").setAttribute("transform", `rotate(${lastAngle + 45} 32 32)`);
 lastX = x; lastY = y;
 }

 page2.addEventListener("mousemove", (e) => {
 const rect = page2.getBoundingClientRect();
 const x = e.clientX - rect.left, y = e.clientY - rect.top;
 active = true;
 updatePencil(x, y);
 addPoint(x, y);
 });

 page2.addEventListener("mouseenter", () => { pencil.style.opacity = "1"; });
 page2.addEventListener("mouseleave", () => { pencil.style.opacity = "0"; });

 function render() {
 const now = performance.now();
 while (points.length && now - points[0].t > TRAIL_LIFETIME) points.shift();

 let markup = "";
 for (let i = 1; i < points.length; i++) {
 const p0 = points[i - 1], p1 = points[i];
 const life = 1 - Math.min((now - p1.t) / TRAIL_LIFETIME, 1);
 const opacity = Math.max(life, 0) * 0.85;
 if (opacity <= 0.01) continue;
 const width = 1.5 + life * 2.2;
 markup += `<line x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}"
 stroke="#F2C14E" stroke-width="${width.toFixed(2)}" stroke-linecap="round"
 opacity="${opacity.toFixed(3)}" />`;
 }
 svg.innerHTML = markup;
 requestAnimationFrame(render);
 }
 requestAnimationFrame(render);
})();*/

//  PAGE 2 LOADER/CURTAIN EFFECT //

window.addEventListener('load', () => {

    if (window.innerWidth > 820) {
        ScrollTrigger.create({
            trigger: ".page1",
            start: "top top",
            end: "bottom top",
            pin: true,
            pinSpacing: false
        });
    }

    if (window.innerWidth > 820) {
        gsap.to(".page1", {
            opacity: 0.3,
            filter: "blur(5px)",
            ease: "none",
            scrollTrigger: {
                trigger: ".page2",
                start: "top bottom",
                end: "top top",
                scrub: true
            }
        });
    }
     if (window.innerWidth > 960) {
        ScrollTrigger.create({
            trigger: ".page2",
            start: "top top",
            end: "+=2200",
            pin: true,
            pinSpacing: true,
            scrub: 0.4,
            onUpdate: (self) => {
                if (window.setPageWheelProgress) {
                    window.setPageWheelProgress(self.progress);
                }
            }
        });
    }


    ScrollTrigger.refresh();

});
// SCROLL CUE (jumping book) 

const scrollCue = document.getElementById("scrollCue");

if (scrollCue) {
 const goToPage2 = () => {
 const page2 = document.querySelector(".page2");
 if (page2) lenis.scrollTo(page2, { offset: 0, duration: 1.4 });
 };

 scrollCue.addEventListener("click", goToPage2);
 scrollCue.addEventListener("keydown", (e) => {
 if (e.key === "Enter" || e.key === " ") {
 e.preventDefault();
 goToPage2();
 }
 });

 
 ScrollTrigger.create({
 trigger: ".hero",
 start: "top top",
 end: "60% top",
 scrub: true,
 onUpdate: (self) => {
 scrollCue.style.opacity = 1 - self.progress;
 scrollCue.style.pointerEvents = self.progress > 0.8 ? "none" : "auto";
 if (window.requestScrollCueRender) window.requestScrollCueRender();
 }
 });
}

//  PAGE 2 NAVBAR REVEAL
(function () {
  const navbarWrap = document.querySelector(".page2-navbar-wrap");
  if (!navbarWrap) return;

  let showTimeout;

  ScrollTrigger.create({
    trigger: ".page2",
    start: "top 40%",
    onEnter: () => {
      showTimeout = setTimeout(() => navbarWrap.classList.add("is-visible"), 1800);
    },
    onLeaveBack: () => {
      clearTimeout(showTimeout);
      navbarWrap.classList.remove("is-visible");
    }
  });
})();






window.addEventListener('load', () => {
    ScrollTrigger.refresh();
    setTimeout(() => ScrollTrigger.refresh(), 300);
});



// ==========================================
// MOBILE LOGIC SANDBOX
// ==========================================
const isMobileDevice = window.matchMedia("(max-width: 820px)").matches;

if (isMobileDevice) {
    console.log("Mobile layout initialized");

    // 2. Feature Card Swiping Logic
    const fcTrack = document.getElementById('featuresTrack');
    const fcItems = fcTrack ? Array.from(fcTrack.querySelectorAll('.feature-item')) : [];
    const fcDots  = document.querySelectorAll('.f-dot');
    let fcIndex = 0;

    function fcRender() {
        fcItems.forEach((item, i) => {
            item.classList.remove('card-active', 'card-next', 'card-hidden');
            if (i === fcIndex) item.classList.add('card-active');
            else if (i === (fcIndex + 1) % fcItems.length) item.classList.add('card-next');
            else item.classList.add('card-hidden');
        });
        fcDots.forEach((d, i) => d.classList.toggle('is-active', i === fcIndex));
    }

    if (fcTrack && fcItems.length) {
        fcRender();
        fcDots.forEach((d, i) => d.addEventListener('click', () => { fcIndex = i; fcRender(); }));

        let touchStartX = 0, touchStartY = 0;
        fcTrack.addEventListener('touchstart', e => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });

        fcTrack.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - touchStartX;
            const dy = e.changedTouches[0].clientY - touchStartY;
            if (Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy)) return;
            fcIndex = dx < 0 ? (fcIndex + 1) % fcItems.length : (fcIndex - 1 + fcItems.length) % fcItems.length;
            fcRender();
        }, { passive: true });
    }
}
