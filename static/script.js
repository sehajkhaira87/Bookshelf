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

// ================= LOADER =================
const loader = document.getElementById("loader");

setTimeout(() => {

    loader.classList.add("hide-loader");

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

    // Split the heading into characters — single instance only
    const text = new SplitType(".hero-title", {
        types: "chars"
    });

    // Animate every character (no filter:blur — too expensive per-char)
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

// ================= BULB SWING =================
// Stops looping when hero scrolls off-screen via IntersectionObserver

const bulb = document.querySelector(".bulb");
const heroSection = document.querySelector(".hero");

let targetRotation = 0;
let currentRotation = 0;
let velocity = 0;
let bulbVisible = true;
let bulbRAF = null;

document.addEventListener("mousemove", (e) => {
    const mouseX = e.clientX / window.innerWidth;
    targetRotation = (mouseX - 0.5) * 4;
});

function animateBulb() {
    if (!bulbVisible) {
        bulbRAF = null;
        return;
    }

    const force = (targetRotation - currentRotation) * 0.08;
    velocity += force;
    velocity *= 0.93;
    currentRotation += velocity;
    currentRotation = Math.max(-8, Math.min(8, currentRotation));

    const xOffset = Math.sin(currentRotation * Math.PI / 180) * 18;

    bulb.style.transform = `translateX(${xOffset}px) rotate(${currentRotation}deg)`;

    bulbRAF = requestAnimationFrame(animateBulb);
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
bulb.classList.add("on");

// ================= HERO SCROLL PARALLAX =================

ScrollTrigger.create({
    trigger: ".hero",
    start: "top top",
    end: "+=800",
    scrub: true,
    onUpdate: self => {
        gsap.set(".hero-title-line", {
            y: self.progress * -180
        });
        gsap.set(".hero-title-line--2", {
            y: self.progress * -260
        });
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

// Glass panel appears — no filter:blur (expensive)
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

// ================= PARALLAX SCROLL =================

// Hero Text
gsap.to(".hero-text", {
    y: -180,
    ease: "none",
    scrollTrigger: {
        trigger: ".hero",
        start: "top top",
        end: "bottom top",
        scrub: 2
    }
});

// Bookshelf
gsap.to(".hero-image", {
    y: -100,
    ease: "none",
    scrollTrigger: {
        trigger: ".hero",
        start: "top top",
        end: "bottom top",
        scrub: 2
    }
});

// Features
gsap.to(".features-container", {
    y: -60,
    ease: "none",
    scrollTrigger: {
        trigger: ".hero",
        start: "top top",
        end: "bottom top",
        scrub: 2
    }
});

// Bulb
gsap.to(".bulb", {
    y: -40,
    ease: "none",
    scrollTrigger: {
        trigger: ".hero",
        start: "top top",
        end: "bottom top",
        scrub: 2
    }
});

// Cat
gsap.to(".cat", {
    y: -100,
    ease: "none",
    scrollTrigger: {
        trigger: ".hero",
        start: "top top",
        end: "bottom top",
        scrub: 2
    }
});

// ================= FRAME SEQUENCE (LAZY-LOADED) =================

const canvas = document.getElementById("sequence-canvas");
const context = canvas.getContext("2d");

const frameCount = 120;

// Adaptive canvas resolution — smaller on low-DPI / low-end screens
const dpr = window.devicePixelRatio || 1;
if (dpr <= 1) {
    canvas.width = 960;
    canvas.height = 540;
} else {
    canvas.width = 1280;
    canvas.height = 720;
}

const currentFrame = (index) =>
    `/static/frames/frame_${String(index + 1).padStart(4, "0")}.png`;

// Sparse array — slots filled progressively as images load
const images = new Array(frameCount);
const loadedFlags = new Array(frameCount).fill(false);

const frame = { current: 0 };

// Load a single frame by index
function loadFrame(i) {
    if (i < 0 || i >= frameCount || loadedFlags[i]) return;
    loadedFlags[i] = true;
    const img = new Image();
    img.src = currentFrame(i);
    img.onload = () => {
        images[i] = img;
        if (i === frame.current) render();
    };
}

// Preload frames around the current scroll position
function preloadAround(index) {
    const AHEAD = 12;
    const BEHIND = 4;
    for (let i = index - BEHIND; i <= index + AHEAD; i++) {
        loadFrame(i);
    }
}

// Eagerly load first 15 frames so the canvas isn't blank on arrival
for (let i = 0; i < 15; i++) {
    loadFrame(i);
}

function render() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const img = images[frame.current];
    if (img) {
        context.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
}

// Start lazy-loading the rest when the sequence section nears the viewport
const seqSection = document.querySelector(".sequence-section");
const seqObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            let batch = 0;
            for (let i = 0; i < frameCount; i++) {
                if (!loadedFlags[i]) {
                    setTimeout(() => loadFrame(i), batch * 30);
                    batch++;
                }
            }
            seqObserver.disconnect();
        }
    });
}, { rootMargin: "200px 0px" });

seqObserver.observe(seqSection);

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
    onUpdate: () => {
        preloadAround(frame.current);
        render();
    }
});