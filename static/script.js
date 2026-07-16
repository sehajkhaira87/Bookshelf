gsap.registerPlugin(ScrollTrigger);
if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
}

window.scrollTo(0, 0);
const lenis = new Lenis({
    duration: 1.2,
    smoothWheel: true,
    touchMultiplier: 2
});

function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
}

requestAnimationFrame(raf);
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

// Split the heading into characters
const text = new SplitType(".hero-title", {
    types: "chars"
});

// Animate every character
gsap.from(text.chars, {
    opacity: 0,
    y: 120,
    rotationX: -90,
    filter: "blur(20px)",
    stagger: 0.03,
    duration: 1.2,
    ease: "power4.out",
    delay: 0.9
});


}, 1500);
const bulb = document.querySelector(".bulb");

let targetRotation = 0;
let currentRotation = 0;
let velocity = 0;

document.addEventListener("mousemove", (e) => {

    const mouseX = e.clientX / window.innerWidth;

    targetRotation = (mouseX - 0.5) * 4;

});

function animateBulb(){


    const force = (targetRotation - currentRotation) * 0.08;

    velocity += force;

    velocity *= 0.93;

    currentRotation += velocity;
    currentRotation = Math.max(-8, Math.min(8, currentRotation));

    const xOffset = Math.sin(currentRotation * Math.PI / 180) * 18;

bulb.style.transform = `
translateX(${xOffset}px)
rotate(${currentRotation}deg)
`;
    
    requestAnimationFrame(animateBulb);

}

animateBulb();
document.querySelector(".bulb").classList.add("on");
setTimeout(() => {
    document.querySelector(".bulb").classList.add("on");
}, 1500);

new SplitType(".hero-title", {
    types: "chars"
});

gsap.from(".char", {
    opacity: 0,
    y: 120,
    rotationX: -90,
    filter: "blur(20px)",
    stagger: 0.04,
    duration: 1.2,
    ease: "power4.out"
});
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
