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

    // Split text into characters
    const text = new SplitType(".hero-title", {
        types: "chars"
    });

    gsap.from(text.chars, {
        opacity: 0,
        y: 120,
        rotationX: -90,
        filter: "blur(20px)",
        stagger: 0.04,
        duration: 1.2,
        ease: "power4.out"
    });

}, 1500);
