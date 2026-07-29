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

// BULB PHYSICS & INTERACTION

const bulbEl      = document.querySelector(".bulb");
const bulbWrapper = document.querySelector(".bulb-wrapper");
const heroEl      = document.querySelector(".hero");
const ropeCanvas  = document.getElementById("rope-canvas");
const ropeCtx     = ropeCanvas.getContext("2d");

// 2D Mass-Spring Pendulum Physics Config
let REST_LENGTH      = 55;     // Natural resting wire length in pixels
const MIN_LENGTH     = 45;     // Minimum retracted length
const MAX_LENGTH     = 250;    // Maximum unspooled length
const MAX_STRETCH    = 400;    // Maximum wire stretch limit in pixels
const K_SPRING       = 0.25;   // Elastic Hooke's spring stiffness constant (higher = stiffer)
const GRAVITY        = 0.8;    // Downward gravitational acceleration force
const DAMPING        = 0.96;   // Velocity damping / air resistance factor
const MASS           = 1.5;    // Bulb mass constant

// 2D State vectors
let anchorX          = 0;      // Anchor X in hero coordinates
let anchorY          = 0;      // Anchor Y (top ceiling = 0)
let bulbX            = 0;      // Current X position of wire attachment point
let bulbY            = REST_LENGTH; // Current Y position of wire attachment point
let vx               = 0;      // Velocity X
let vy               = 0;      // Velocity Y
let bulbAngle        = 0;      // Visual bulb rotation angle in radians
let bulbAngleVel     = 0;      // Bulb angular velocity for subtle wobble

let bulbRunning      = true;
let isDragging       = false;
let isLightOn        = true;

// Interaction & Drag tracking
let isPointerDown    = false;
let clickStartX      = 0;
let clickStartY      = 0;
let clickStartTime   = 0;
let grabOffsetX      = 0;
let grabOffsetY      = 0;
let dragTargetX      = 0;
let dragTargetY      = 0;
let lastDragX        = 0;
let lastDragY        = 0;
let lastDragTime     = 0;
let dragVx           = 0;
let dragVy           = 0;
const DRAG_THRESHOLD = 6; // Movement threshold in px to activate drag mode

// Parallax tracking
let bulbParallaxY    = 0;
let mouseX           = 0;

function computeAnchor() {
    const heroRect = heroEl.getBoundingClientRect();
    anchorX = heroRect.width * 0.60;
    anchorY = 0;
    if (!isDragging && Math.abs(vx) < 0.01 && Math.abs(vy) < 0.01) {
        bulbX = anchorX;
    }
}

function sizeRopeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ropeCanvas.width  = ropeCanvas.clientWidth * dpr;
    ropeCanvas.height = ropeCanvas.clientHeight * dpr;
    ropeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

computeAnchor();
sizeRopeCanvas();
bulbX = anchorX;
bulbY = REST_LENGTH;

window.addEventListener("resize", () => {
    const oldAnchor = anchorX;
    computeAnchor();
    sizeRopeCanvas();
    bulbX += (anchorX - oldAnchor);
}, { passive: true });

document.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
}, { passive: true });

// Mouse Drag handlers
bulbWrapper.addEventListener("mousedown", (e) => {
    isPointerDown  = true;
    isDragging     = false;
    clickStartX    = e.clientX;
    clickStartY    = e.clientY;
    clickStartTime = Date.now();
    
    const heroRect   = heroEl.getBoundingClientRect();
    const mouseHeroX = e.clientX - heroRect.left;
    const mouseHeroY = e.clientY - heroRect.top;

    // Grab offset relative to bulb position
    grabOffsetX  = mouseHeroX - bulbX;
    grabOffsetY  = mouseHeroY - bulbY;

    lastDragX    = mouseHeroX - grabOffsetX;
    lastDragY    = mouseHeroY - grabOffsetY;
    lastDragTime = Date.now();
    dragVx       = 0;
    dragVy       = 0;

    document.body.style.userSelect = "none";
    e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
    if (!isPointerDown) return;

    const heroRect   = heroEl.getBoundingClientRect();
    const mouseHeroX = e.clientX - heroRect.left;
    const mouseHeroY = e.clientY - heroRect.top;

    const distMoved  = Math.hypot(e.clientX - clickStartX, e.clientY - clickStartY);

    if (!isDragging) {
        if (distMoved >= DRAG_THRESHOLD) {
            isDragging = true;
        } else {
            return;
        }
    }

    const curTargetX = mouseHeroX - grabOffsetX;
    const curTargetY = mouseHeroY - grabOffsetY;

    const now = Date.now();
    const dt  = Math.max(1, now - lastDragTime);

    dragVx = (curTargetX - lastDragX) / dt * 16;
    dragVy = (curTargetY - lastDragY) / dt * 16;

    dragTargetX  = curTargetX;
    dragTargetY  = curTargetY;
    lastDragX    = curTargetX;
    lastDragY    = curTargetY;
    lastDragTime = now;
}, { passive: true });

document.addEventListener("mouseup", (e) => {
    if (!isPointerDown) return;

    const elapsed = Date.now() - clickStartTime;
    const moved   = Math.hypot(e.clientX - clickStartX, e.clientY - clickStartY);

    if (!isDragging || (elapsed < 300 && moved < DRAG_THRESHOLD)) {
        toggleLight();
    } else {
        vx = Math.max(-25, Math.min(25, dragVx * 0.85));
        vy = Math.max(-25, Math.min(25, dragVy * 0.85));
    }

    isDragging     = false;
    isPointerDown  = false;
    document.body.style.userSelect = "";
});

// Touch Drag handlers
bulbWrapper.addEventListener("touchstart", (e) => {
    const t        = e.touches[0];
    isPointerDown  = true;
    isDragging     = false;
    clickStartX    = t.clientX;
    clickStartY    = t.clientY;
    clickStartTime = Date.now();

    const heroRect   = heroEl.getBoundingClientRect();
    const touchHeroX = t.clientX - heroRect.left;
    const touchHeroY = t.clientY - heroRect.top;

    grabOffsetX  = touchHeroX - bulbX;
    grabOffsetY  = touchHeroY - bulbY;

    lastDragX    = touchHeroX - grabOffsetX;
    lastDragY    = touchHeroY - grabOffsetY;
    lastDragTime = Date.now();
    dragVx       = 0;
    dragVy       = 0;

    e.preventDefault();
}, { passive: false });

document.addEventListener("touchmove", (e) => {
    if (!isPointerDown) return;
    const t = e.touches[0];

    const heroRect   = heroEl.getBoundingClientRect();
    const touchHeroX = t.clientX - heroRect.left;
    const touchHeroY = t.clientY - heroRect.top;

    const distMoved  = Math.hypot(t.clientX - clickStartX, t.clientY - clickStartY);

    if (!isDragging) {
        if (distMoved >= DRAG_THRESHOLD) {
            isDragging = true;
        } else {
            return;
        }
    }

    const curTargetX = touchHeroX - grabOffsetX;
    const curTargetY = touchHeroY - grabOffsetY;

    const now = Date.now();
    const dt  = Math.max(1, now - lastDragTime);

    dragVx = (curTargetX - lastDragX) / dt * 16;
    dragVy = (curTargetY - lastDragY) / dt * 16;

    dragTargetX  = curTargetX;
    dragTargetY  = curTargetY;
    lastDragX    = curTargetX;
    lastDragY    = curTargetY;
    lastDragTime = now;
}, { passive: true });

document.addEventListener("touchend", (e) => {
    if (!isPointerDown) return;

    const t       = e.changedTouches[0];
    const elapsed = Date.now() - clickStartTime;
    const moved   = Math.hypot(t.clientX - clickStartX, t.clientY - clickStartY);

    if (!isDragging || (elapsed < 300 && moved < DRAG_THRESHOLD)) {
        toggleLight();
    } else {
        vx = Math.max(-25, Math.min(25, dragVx * 0.85));
        vy = Math.max(-25, Math.min(25, dragVy * 0.85));
    }

    isDragging    = false;
    isPointerDown = false;
});

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

// Draw flexible stretchable cable
function drawRope() {
    const cw = ropeCanvas.clientWidth;
    const ch = ropeCanvas.clientHeight;
    ropeCtx.clearRect(0, 0, cw, ch);

    const startX = anchorX;
    const startY = anchorY;
    const endX   = bulbX;
    const endY   = bulbY;

    const dx   = endX - startX;
    const dy   = endY - startY;
    const len  = Math.hypot(dx, dy);
    const stretchRatio = len / REST_LENGTH;

    // Dynamic line width: thins out noticeably when wire is stretched under high tension
    const baseWidth = 2.5;
    const currentLineWidth = stretchRatio > 1 
        ? Math.max(1.2, baseWidth / Math.sqrt(stretchRatio)) 
        : baseWidth;

    // Cable Curve / Sag math
    let cpX = (startX + endX) / 2;
    let cpY = (startY + endY) / 2;

    if (stretchRatio < 0.95) {
        // Slack rope: sags downwards dynamically
        const slackAmount = (1 - stretchRatio) * REST_LENGTH * 0.85;
        cpY += slackAmount;
        cpX += vx * 2;
    } else {
        // Taut / Stretched rope: slight curve perpendicular to rope vector based on velocity
        const angle = Math.atan2(dy, dx);
        const normalX = -Math.sin(angle);
        const normalY =  Math.cos(angle);
        const flex = (vx * normalX + vy * normalY) * 1.5;
        cpX += normalX * flex;
        cpY += normalY * flex;
    }

    ropeCtx.beginPath();
    ropeCtx.moveTo(startX, startY);
    ropeCtx.quadraticCurveTo(cpX, cpY, endX, endY);
    ropeCtx.strokeStyle = "#1a1a1a";
    ropeCtx.lineWidth   = currentLineWidth;
    ropeCtx.lineCap     = "round";
    ropeCtx.stroke();
}

// 2D Mass-Spring Pendulum Animation Loop
function animateBulb() {
    if (!bulbRunning) return;

    if (isDragging) {
        // Smoothly pull bulb towards drag target with elastic dampening
        const dx = dragTargetX - bulbX;
        const dy = dragTargetY - bulbY;

        bulbX += dx * 0.45;
        bulbY += dy * 0.45;

        // Apply stretch constraint limit during drag
        const fromAnchorX = bulbX - anchorX;
        const fromAnchorY = bulbY - anchorY;
        const dist = Math.hypot(fromAnchorX, fromAnchorY);

        if (dist > MAX_STRETCH) {
            const scale = MAX_STRETCH / dist;
            bulbX = anchorX + fromAnchorX * scale;
            bulbY = anchorY + fromAnchorY * scale;
        }

        vx = dragVx;
        vy = dragVy;
    } else {
        // --- 2D PHYSICS SIMULATION ---
        const dx   = bulbX - anchorX;
        const dy   = bulbY - anchorY;
        const dist = Math.hypot(dx, dy);

        let fx = 0;
        let fy = GRAVITY * MASS; // Gravity force pulling down

        if (dist > 0.001) {
            const unitX = dx / dist;
            const unitY = dy / dist;

            // Hooke's Elastic Spring restoring tension force
            if (dist > REST_LENGTH) {
                const stretch = dist - REST_LENGTH;
                
                // Unspool mechanic: if pulled hard, the resting length increases
                if (stretch > 60 && REST_LENGTH < MAX_LENGTH) {
                    REST_LENGTH += (stretch - 60) * 0.08;
                }
                
                const springForce = -K_SPRING * stretch;
                fx += unitX * springForce;
                fy += unitY * springForce;
            } else {
                // Cord is slack. Real strings don't push back! They just go limp.
                // Retract mechanic: slowly reel back in when slack
                if (REST_LENGTH > MIN_LENGTH) {
                    REST_LENGTH -= 0.6;
                }
            }

            // Gentle ambient mouse attraction
            const heroRect = heroEl.getBoundingClientRect();
            if (heroRect.width > 0) {
                const relMouse = (mouseX - heroRect.left) / heroRect.width;
                const targetMouseX = anchorX + (relMouse - 0.6) * 60;
                fx += (targetMouseX - bulbX) * 0.0015;
            }
        }

        // Integrate acceleration into velocity
        vx += fx / MASS;
        vy += fy / MASS;

        // Apply velocity damping (air resistance)
        vx *= DAMPING;
        vy *= DAMPING;

        // Update 2D position
        bulbX += vx;
        bulbY += vy;

        // Stretch limit constraint hard ceiling to prevent numerical explosion
        const newDx = bulbX - anchorX;
        const newDy = bulbY - anchorY;
        const newDist = Math.hypot(newDx, newDy);
        if (newDist > MAX_STRETCH) {
            const scale = MAX_STRETCH / newDist;
            bulbX = anchorX + newDx * scale;
            bulbY = anchorY + newDy * scale;
            vx *= -0.3;
            vy *= -0.3;
        }
    }

    // Position wrapper element
    const offsetX = bulbX - anchorX;
    bulbWrapper.style.transform = `translateX(calc(-50% + ${offsetX}px)) translateY(${bulbParallaxY}px)`;
    bulbWrapper.style.top = `${bulbY - 44}px`;

    // Rotate bulb graphics matching wire direction with rotational inertia
    const ropeDx = bulbX - anchorX;
    const ropeDy = bulbY - anchorY;
    const targetAngle = Math.atan2(ropeDx, Math.max(1, ropeDy));

    // Damped rotational wobble
    const angleDiff = targetAngle - bulbAngle;
    bulbAngleVel += angleDiff * 0.15;
    bulbAngleVel *= 0.82;
    bulbAngle += bulbAngleVel;

    const angleDeg = bulbAngle * (180 / Math.PI);
    bulbEl.style.transform = `rotate(${angleDeg}deg)`;

    // Render stretch cable on canvas
    drawRope();

    // Scroll parallax translation on canvas
    ropeCanvas.style.transform = `translateY(${bulbParallaxY}px)`;

    requestAnimationFrame(animateBulb);
}

// Pause bulb rAF when hero is not visible
const heroObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        bulbVisible = entry.isIntersecting;
        if (bulbVisible && !bulbRAF) {
            bulbRAF = requestAnimationFrame(animateBulb);
        }
    });
}, { threshold: 0 });

heroObserver.observe(heroSection);

// Start bulb animation and glow
animateBulb();

// Turn on glow
bulbEl.classList.add("on");

//SCROLL PARALLAX 


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

//  FEATURES TIMELINE 

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

// ================= FRAME SEQUENCE (OPTIMIZED) =================

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



// ================= PENCIL DRAW TRAIL (page2) =================
(function () {
  const page2 = document.querySelector(".page2");
  if (!page2) return;

  const svg    = page2.querySelector("#trail-svg");
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
})();
