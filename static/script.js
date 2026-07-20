gsap.registerPlugin(ScrollTrigger);
if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
}

window.scrollTo(0, 0);
const lenis = new Lenis({
    duration: 1.2,
    smoothWheel: true
});

lenis.on("scroll", ScrollTrigger.update);

gsap.ticker.add((time) => {
    lenis.raf(time * 1000);
});

gsap.ticker.lagSmoothing(0);

// ================= LOADER & HERO INTRO =================

const loader = document.getElementById("loader");

setTimeout(() => {

    loader.classList.add("hide-loader");

    // Remove loader from DOM after transition to free resources
    setTimeout(() => {
        loader.remove();
    }, 1200);

    // Animate the line
    gsap.set(".tag-line", {
        scaleX: 0,
        transformOrigin: "left center"
    });

    gsap.to(".tag-line", {
        scaleX: 1,
        duration: 1.8,
        ease: "power3.out",
        delay: 2.3
    });

    // Animate the "CURATED FOR STUDENTS" text
    gsap.from(".tag-text", {
        opacity: 0,
        x: 20,
        duration: 1.7,
        delay: 2.5,
        ease: "power3.out"
    });

    // Split the heading into characters (only once)
    const text = new SplitType(".hero-title", {
        types: "chars"
    });

    // Animate every character — no blur filter (very expensive on low-end)
    gsap.from(text.chars, {
        opacity: 0,
        y: 120,
        rotationX: -90,
        stagger: 0.03,
        duration: 1.2,
        ease: "power4.out",
        delay: 0.9
    });

}, 1500);

// ================= BULB PHYSICS & INTERACTION =================

const bulbEl      = document.querySelector(".bulb");
const bulbWrapper = document.querySelector(".bulb-wrapper");
const heroEl      = document.querySelector(".hero");
const ropeCanvas  = document.getElementById("rope-canvas");
const ropeCtx     = ropeCanvas.getContext("2d");

// Pendulum config
const ROPE_LENGTH    = 50;     // visual rope length in CSS px
const GRAVITY        = 0.004;  // stronger gravity for a heavier, glass-like feel
const DAMPING        = 0.992;  // increased air friction so it doesn't swing forever
const MOUSE_STRENGTH = 0.0001; // barely noticeable magnetic effect
const MAX_SWING      = Math.PI / 3; // cap at 60 degreesnt pendulum angle in radians
let angle         = 0;    // current pendulum angle in radians
let angleVel      = 0;    // angular velocity
let bulbRunning   = true;
let isDragging    = false;
let isLightOn     = true;

// Drag tracking
let clickStartX    = 0;
let clickStartTime = 0;
let lastDragX      = 0;
let lastDragTime   = 0;
let dragAngleVel   = 0;

// Parallax tracking
let bulbParallaxY  = 0;

// The fixed anchor point (in hero-relative coords)
let anchorX = 0;
let mouseX  = 0;

function computeAnchor() {
    const heroRect = heroEl.getBoundingClientRect();
    anchorX = heroRect.width * 0.60;
}

function sizeRopeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ropeCanvas.width  = ropeCanvas.clientWidth * dpr;
    ropeCanvas.height = ropeCanvas.clientHeight * dpr;
    ropeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

computeAnchor();
sizeRopeCanvas();
window.addEventListener("resize", () => {
    computeAnchor();
    sizeRopeCanvas();
}, { passive: true });

// ---- Compute bulb position from angle (hero-relative) ----
function getBulbPos() {
    return {
        x: anchorX + Math.sin(angle) * ROPE_LENGTH,
        y: Math.cos(angle) * ROPE_LENGTH
    };
}

// ---- Get angle from anchor to a screen point ----
function angleToPoint(px, py) {
    const heroRect = heroEl.getBoundingClientRect();
    const dx = (px - heroRect.left) - anchorX;
    const dy = (py - heroRect.top);
    return Math.atan2(dx, Math.max(10, dy));
}

// ---- Mouse tracking ----
document.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
}, { passive: true });

// ---- DRAG: MOUSE ----
bulbWrapper.addEventListener("mousedown", (e) => {
    isDragging     = true;
    clickStartX    = e.clientX;
    clickStartTime = Date.now();
    lastDragX      = e.clientX;
    lastDragTime   = Date.now();
    dragAngleVel   = 0;
    document.body.style.userSelect = "none";
    e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const now = Date.now();
    const dt  = Math.max(1, now - lastDragTime);

    const prevAngle = angle;
    angle = angleToPoint(e.clientX, e.clientY);
    angle = Math.max(-1.2, Math.min(1.2, angle));
    dragAngleVel = (angle - prevAngle) / dt * 16;

    lastDragX    = e.clientX;
    lastDragTime = now;
    angleVel     = 0;
}, { passive: true });

document.addEventListener("mouseup", (e) => {
    if (!isDragging) return;
    isDragging = false;
    document.body.style.userSelect = "";
    const elapsed = Date.now() - clickStartTime;
    const moved   = Math.abs(e.clientX - clickStartX);
    if (elapsed < 300 && moved < 8) {
        toggleLight();
    } else {
        angleVel = dragAngleVel; // preserve full throw momentum
    }
});

// ---- DRAG: TOUCH ----
bulbWrapper.addEventListener("touchstart", (e) => {
    const t        = e.touches[0];
    isDragging     = true;
    clickStartX    = t.clientX;
    clickStartTime = Date.now();
    lastDragX      = t.clientX;
    lastDragTime   = Date.now();
    dragAngleVel   = 0;
    e.preventDefault();
}, { passive: false });

document.addEventListener("touchmove", (e) => {
    if (!isDragging) return;
    const t   = e.touches[0];
    const now = Date.now();
    const dt  = Math.max(1, now - lastDragTime);

    const prevAngle = angle;
    angle = angleToPoint(t.clientX, t.clientY);
    angle = Math.max(-1.2, Math.min(1.2, angle));
    dragAngleVel = (angle - prevAngle) / dt * 16;

    lastDragX    = t.clientX;
    lastDragTime = now;
    angleVel     = 0;
}, { passive: true });

document.addEventListener("touchend", (e) => {
    if (!isDragging) return;
    isDragging = false;
    const t       = e.changedTouches[0];
    const elapsed = Date.now() - clickStartTime;
    const moved   = Math.abs(t.clientX - clickStartX);
    if (elapsed < 300 && moved < 8) {
        toggleLight();
    } else {
        angleVel = dragAngleVel; // preserve full throw momentum
    }
});

// ---- LIGHT TOGGLE ----
function toggleLight() {
    isLightOn = !isLightOn;
    if (isLightOn) {
        heroEl.classList.remove("lights-off");
        bulbEl.classList.add("on");
        bulbEl.classList.add("flicker");
        setTimeout(() => bulbEl.classList.remove("flicker"), 700);
    } else {
        heroEl.classList.add("lights-off");
        bulbEl.classList.remove("on");
    }
}

// ---- DRAW FLEXIBLE ROPE ----
function drawRope() {
    const cw = ropeCanvas.clientWidth;
    const ch = ropeCanvas.clientHeight;
    ropeCtx.clearRect(0, 0, cw, ch);

    const bulbPos  = getBulbPos();
    const startX   = anchorX;
    const startY   = 0;
    const endX     = bulbPos.x;
    const endY     = bulbPos.y;

    // Control point: placed at ~40% along the rope with dynamic sag
    const t = 0.4;
    let sagTotal = 0;
    if (isDragging) {
        // Bend noticeably when dragging the heavy bulb against the cord
        const sagVel = Math.abs(dragAngleVel) * 150;
        const sagDir = dragAngleVel > 0 ? -1 : 1;
        sagTotal = (2 + sagVel) * sagDir;
    } else {
        // Bend very slightly due to air resistance when free-swinging
        const sagVel = Math.abs(angleVel) * 30;
        const sagDir = angleVel > 0 ? -1 : 1;
        sagTotal = sagVel * sagDir;
    }

    // The "straight" midpoint along the rope
    const midX = startX + (endX - startX) * t;
    const midY = startY + (endY - startY) * t;

    // Perpendicular to the rope direction for the sag
    const ropeAngle = Math.atan2(endY - startY, endX - startX);
    const cpX = midX + Math.cos(ropeAngle + Math.PI/2) * sagTotal;
    const cpY = midY + Math.sin(ropeAngle + Math.PI/2) * sagTotal;

    ropeCtx.beginPath();
    ropeCtx.moveTo(startX, startY);
    ropeCtx.quadraticCurveTo(cpX, cpY, endX, endY);
    ropeCtx.strokeStyle = "#1a1a1a";
    ropeCtx.lineWidth   = 2.5;
    ropeCtx.lineCap     = "round";
    ropeCtx.stroke();
}

// ---- ANIMATION LOOP ----
function animateBulb() {
    if (!bulbRunning) return;

    if (!isDragging) {
        // Gravity: restoring force toward angle=0 (hanging straight down)
        const gravityForce = -GRAVITY * Math.sin(angle);
        angleVel += gravityForce;

        // Gentle mouse follow
        const heroRect = heroEl.getBoundingClientRect();
        const relMouse = (mouseX - heroRect.left) / heroRect.width;
        const targetAngle = (relMouse - 0.6) * 0.06;
        const mouseForce = (targetAngle - angle) * MOUSE_STRENGTH;
        angleVel += mouseForce;

        angleVel *= DAMPING;
        angle    += angleVel;
        angle     = Math.max(-1.2, Math.min(1.2, angle));
    }

    // Position the wrapper from the pendulum math
    const bulbPos = getBulbPos();
    const offsetX = bulbPos.x - anchorX;
    bulbWrapper.style.transform = `translateX(calc(-50% + ${offsetX}px)) translateY(${bulbParallaxY}px)`;
    bulbWrapper.style.top = `${bulbPos.y - 44}px`;

    // Rotate the inner bulb to follow the swing
    const angleDeg = angle * (180 / Math.PI);
    bulbEl.style.transform = `rotate(${angleDeg}deg)`;

    // Draw the flexible rope
    drawRope();

    // Apply parallax to canvas
    ropeCanvas.style.transform = `translateY(${bulbParallaxY}px)`;

    requestAnimationFrame(animateBulb);
}

animateBulb();

// Turn on glow
bulbEl.classList.add("on");

// ================= SCROLL PARALLAX =================
// Consolidate all hero-section parallax into fewer ScrollTriggers

ScrollTrigger.create({
    trigger: ".hero",
    start: "top top",
    end: "bottom top",
    scrub: 2,

    onUpdate: self => {
        const p = self.progress;
        gsap.set(".hero-text", { y: p * -180 });
        gsap.set(".hero-image", { y: p * -100 });
        gsap.set(".features-container", { y: p * -60 });
        bulbParallaxY = p * -40; // Use variable to pass to physics loop
        gsap.set(".cat", { y: p * -100 });
    }
});

// ================= FEATURES TIMELINE =================

const featuresTl = gsap.timeline({

    scrollTrigger: {
        trigger: ".features",
        start: "top 80%",
        toggleActions: "play none none none"
    }

});

// Glass panel appears — no blur filter animation
featuresTl.from(".features-container", {

    opacity: 0,
    scaleX: 0.82,

    duration: 1.35,

    ease: "power3.out"

})

// Draw dividers
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

// ================= FRAME SEQUENCE (OPTIMIZED) =================

const canvas = document.getElementById("sequence-canvas");
const context = canvas.getContext("2d", { alpha: false });


const frameCount = 120;

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

});

// ================= CLEANUP =================
// Pause bulb animation when it's off-screen to save CPU

ScrollTrigger.create({
    trigger: ".hero",
    start: "top bottom",
    end: "bottom top",
    onEnter: () => { bulbRunning = true; animateBulb(); },
    onLeave: () => { bulbRunning = false; },
    onEnterBack: () => { bulbRunning = true; animateBulb(); },
    onLeaveBack: () => { bulbRunning = false; }
});