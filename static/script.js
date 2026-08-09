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
<<<<<<<< < Temporary merge branch 1

const bulbEl = document.querySelector(".bulb");
const bulbWrapper = document.querySelector(".bulb-wrapper");
const heroEl = document.querySelector(".hero");
const ropeCanvas = document.getElementById("rope-canvas");
const ropeCtx = ropeCanvas.getContext("2d");

// 2D Mass-Spring Pendulum Physics Config
let REST_LENGTH = 55;     // Natural resting wire length in pixels
const MIN_LENGTH = 45;     // Minimum retracted length
const MAX_LENGTH = 250;    // Maximum unspooled length
const MAX_STRETCH = 400;    // Maximum wire stretch limit in pixels
const K_SPRING = 0.25;   // Elastic Hooke's spring stiffness constant (higher = stiffer)
const GRAVITY = 0.8;    // Downward gravitational acceleration force
const DAMPING = 0.96;   // Velocity damping / air resistance factor
const MASS = 1.5;    // Bulb mass constant

// 2D State vectors
let anchorX = 0;      // Anchor X in hero coordinates
let anchorY = 0;      // Anchor Y (top ceiling = 0)
let bulbX = 0;      // Current X position of wire attachment point
let bulbY = REST_LENGTH; // Current Y position of wire attachment point
let vx = 0;      // Velocity X
let vy = 0;      // Velocity Y
let bulbAngle = 0;      // Visual bulb rotation angle in radians
let bulbAngleVel = 0;      // Bulb angular velocity for subtle wobble

let bulbRunning = true;
let isDragging = false;
let isLightOn = true;

// Interaction & Drag tracking
let isPointerDown = false;
let clickStartX = 0;
let clickStartY = 0;
let clickStartTime = 0;
let grabOffsetX = 0;
let grabOffsetY = 0;
let dragTargetX = 0;
let dragTargetY = 0;
let lastDragX = 0;
let lastDragY = 0;
let lastDragTime = 0;
let dragVx = 0;
let dragVy = 0;
const DRAG_THRESHOLD = 6; // Movement threshold in px to activate drag mode
=========

const bulbEl      = document.querySelector(".bulb");
const bulbWrapper = document.querySelector(".bulb-wrapper");
const heroEl      = document.querySelector(".hero");
const ropeCanvas  = document.getElementById("rope-canvas");
const ropeCtx     = ropeCanvas.getContext("2d");

// Pendulum config
const ROPE_LENGTH    = 50;
const GRAVITY        = 0.004;
const DAMPING        = 0.992;
const MOUSE_STRENGTH = 0.0001;
const MAX_SWING      = Math.PI / 3;
let angle         = 0;
let angleVel      = 0;
let bulbRunning   = true;
let isDragging    = false;
let isLightOn     = true;

// Drag
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

// Compute bulb position
function getBulbPos() {
    return {
        x: anchorX + Math.sin(angle) * ROPE_LENGTH,
        y: Math.cos(angle) * ROPE_LENGTH
    };
}


function angleToPoint(px, py) {
    const heroRect = heroEl.getBoundingClientRect();
    const dx = (px - heroRect.left) - anchorX;
    const dy = (py - heroRect.top);
    return Math.atan2(dx, Math.max(10, dy));
}


document.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
}, { passive: true });

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
        angleVel = dragAngleVel;
    }
});
>>>>>>>>> Temporary merge branch 2

// Parallax tracking
let bulbParallaxY    = 0;
let mouseX           = 0;

<<<<<<<<< Temporary merge branch 1
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

=========
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
        angleVel = dragAngleVel;
    }
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

>>>>>>>>> Temporary merge branch 2
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
<<<<<<<<< Temporary merge branch 1
=========

>>>>>>>>> Temporary merge branch 2
    scrollTrigger: {
        trigger: ".features",
        start: "top 80%",
        toggleActions: "play none none none"
    }
<<<<<<<<< Temporary merge branch 1
=========

>>>>>>>>> Temporary merge branch 2
});


featuresTl.from(".features-container", {
<<<<<<<<< Temporary merge branch 1
=========

>>>>>>>>> Temporary merge branch 2
    opacity: 0,
    scaleX: 0.82,

    duration: 1.35,
<<<<<<<<< Temporary merge branch 1
    ease: "power3.out"
=========

    ease: "power3.out"

>>>>>>>>> Temporary merge branch 2
})


.from(".divider", {
<<<<<<<<< Temporary merge branch 1
    scaleY: 0,
    transformOrigin: "top center",
    duration: 0.65,
    stagger: 0.07,
    ease: "power2.out"
=========

    scaleY: 0,

    transformOrigin: "top center",

    duration: 0.65,

    stagger: 0.07,

    ease: "power2.out"

>>>>>>>>> Temporary merge branch 2
}, "-=0.5")

// Icons
.from(".feature-icon", {
<<<<<<<<< Temporary merge branch 1
    opacity: 0,
    scale: 0.88,
    duration: 0.55,
    stagger: 0.1,
    ease: "back.out(1.7)"
=========

    opacity: 0,

    scale: 0.88,

    duration: 0.55,

    stagger: 0.1,

    ease: "back.out(1.7)"

>>>>>>>>> Temporary merge branch 2
}, "-=0.25")

// Headings
.from(".feature-text h3", {
<<<<<<<<< Temporary merge branch 1
    opacity: 0,
    y: 181,
    duration: 1.45,
    stagger: 0.08,
    ease: "power2.out"
=========

    opacity: 0,

    y: 181,

    duration: 1.45,

    stagger: 0.08,

    ease: "power2.out"

>>>>>>>>> Temporary merge branch 2
}, "-=0.35")

// Paragraphs
.from(".feature-text p", {
<<<<<<<<< Temporary merge branch 1
    opacity: 0,
    y: 12,
    duration: 0.7,
    stagger: 0.08,
    ease: "power2.out"
=========

    opacity: 0,

    y: 12,

    duration: 0.7,

    stagger: 0.08,

    ease: "power2.out"

>>>>>>>>> Temporary merge branch 2
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
<<<<<<<<< Temporary merge branch 1
    current: frameCount - 1,
    snap: "current",
    ease: "none",
    scrollTrigger: {
        trigger: ".sequence-section",
        start: "top top",
        end: "bottom bottom",
        scrub: 1,
        pin: true
=========

    current: frameCount - 1,

    snap: "current",

    ease: "none",

    scrollTrigger: {

        trigger: ".sequence-section",

        start: "top top",

        end: "bottom bottom",

        scrub: 1,

        pin: true

>>>>>>>>> Temporary merge branch 2
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
<<<<<<<<< Temporary merge branch 1
=========

// ================= PAGE 2 LOADER/CURTAIN EFFECT =================

ScrollTrigger.create({
    trigger: ".page1",
    start: "top top",
    // It stays pinned until the bottom of page1 is reached by the scrolling page2
    end: "bottom top",
    pin: true,
    pinSpacing: false // This is the magic part! It lets page2 scroll OVER the pinned page1
});

// Optional: Parallax fade out Page 1 as Page 2 slides over it
gsap.to(".page1", {
    opacity: 0.3,
    filter: "blur(5px)", // Dims and blurs Page 1 as the loader slides up
    ease: "none",
    scrollTrigger: {
        trigger: ".page2",
        start: "top bottom",
        end: "top top",
        scrub: true
    }
});



// ================= SCROLL CUE (jumping book) =================

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

    // Fade the cue out once the user actually starts scrolling past the
    // hero, so it doesn't linger awkwardly once they're already past it
    ScrollTrigger.create({
        trigger: ".hero",
        start: "top top",
        end: "60% top",
        scrub: true,
        onUpdate: (self) => {
            scrollCue.style.opacity = 1 - self.progress;
            scrollCue.style.pointerEvents = self.progress > 0.8 ? "none" : "auto";
        }
    });
}

// ================= PAGE 2 NAVBAR REVEAL (paper style) =================
(function () {
  const navbarWrap = document.querySelector(".page2-navbar-wrap");
  if (!navbarWrap) return;

  ScrollTrigger.create({
    trigger: ".page2",
    start: "top 40%",
    once: true,
    onEnter: () => {
      setTimeout(() => navbarWrap.classList.add("is-visible"), 1800);
    }
  });
})();


>>>>>>>>> Temporary merge branch 2
