(function () {
    const container = document.getElementById('pageWheel');
    if (!container) return;

    const stage = document.createElement('div');
    stage.className = 'page-wheel-stage';
    container.appendChild(stage);

    const items = [
        { label: "Notes", desc: "Semester-wise, curated by toppers", num: "01" },
        { label: "PYQs", desc: "Years of previous exam papers", num: "02" },
        { label: "Syllabus", desc: "Full & up to date, every branch", num: "03" },
        { label: "Resources", desc: "Extra reading, guides & more", num: "04" }
    ];
    const N = items.length;
    const STEP = (Math.PI * 2) / N;
    const MIN_ROT = -(N - 1) * STEP;
    const MAX_ROT = 0;

    let layoutLoop = null;
    let height = container.clientHeight;
    let dirty = true;
    const writtenStyles = new WeakMap();
    function setStyle(element, property, value) {
        if (!layoutLoop?.desktop) {
            writtenStyles.delete(element);
            element.style[property] = value;
            return;
        }
        let previous = writtenStyles.get(element);
        if (!previous) { previous = {}; writtenStyles.set(element, previous); }
        if (previous[property] === value) return;
        previous[property] = value;
        element.style[property] = value;
    }

    let rotation = 0, targetRotation = 0;
    let tiltX = 0, tiltY = 0, targetTiltX = 0, targetTiltY = 0;

    // exposed so ScrollTrigger can drive this directly from scroll progress
    window.setPageWheelProgress = function (p) {
        targetRotation = MAX_ROT + (MIN_ROT - MAX_ROT) * p;
        if (layoutLoop) layoutLoop.request();
    };

    function makeContentSVG() {
        let svg = `<rect x="16" y="46" width="46" height="4" rx="2" fill="#8C6420" opacity="0.55"/>`;
        const p1 = [96, 92, 98, 54];
        p1.forEach((w, i) => {
            svg += `<rect x="16" y="${64 + i * 13}" width="${w}" height="2.2" rx="1.1" fill="#8C6420" opacity="${0.28 - i * 0.01}"/>`;
        });
        const p2 = [90, 96, 70];
        p2.forEach((w, i) => {
            svg += `<rect x="16" y="${128 + i * 13}" width="${w}" height="2.2" rx="1.1" fill="#8C6420" opacity="${0.24 - i * 0.01}"/>`;
        });
        return `<svg viewBox="0 0 132 172" style="position:absolute;inset:0;width:100%;height:100%;">${svg}</svg>`;
    }

    const cardEls = items.map((item) => {
        const card = document.createElement('div');
        card.style.cssText = `position:absolute;width:132px;height:172px;border-radius:14px;background:linear-gradient(160deg,#FBF5E7 0%,#F1E5C9 55%,#EADCB9 100%);transform-style:preserve-3d;transition:box-shadow .4s ease, border-color .4s ease;border:1px solid rgba(140,100,32,0.1);overflow:hidden;box-shadow:inset 0 1px 0 rgba(255,255,255,0.6);`;
        card.innerHTML = makeContentSVG();
        stage.appendChild(card);

        const num = document.createElement('div');
        num.style.cssText = `position:absolute;top:12px;right:14px;font-size:10.5px;color:rgba(36,27,18,0.28);font-family:"Inter",sans-serif;letter-spacing:0.06em;`;
        num.textContent = item.num;
        card.appendChild(num);

        const chip = document.createElement('div');
        chip.style.cssText = `position:absolute;top:11px;left:14px;font-size:9px;font-family:"Inter",sans-serif;font-weight:700;letter-spacing:0.1em;color:#7A5A1E;background:rgba(180,134,42,0.16);padding:3px 8px;border-radius:20px;`;
        chip.textContent = item.label.toUpperCase();
        card.appendChild(chip);

        const label = document.createElement('div');
        label.style.cssText = `position:absolute;font-family:"Canela",serif;font-size:26px;font-weight:400;color:#F4EFE3;white-space:nowrap;opacity:0;pointer-events:none;letter-spacing:0.01em;transition:opacity .5s ease;`;
        label.textContent = item.label;
        stage.appendChild(label);

        const desc = document.createElement('div');
        desc.style.cssText = `position:absolute;font-size:12.5px;font-family:"Inter",sans-serif;color:rgba(244,239,227,0.45);white-space:nowrap;opacity:0;pointer-events:none;letter-spacing:0.01em;transition:opacity .5s ease;`;
        desc.textContent = item.desc;
        stage.appendChild(desc);

        const line = document.createElement('div');
        line.style.cssText = `position:absolute;height:1px;background:linear-gradient(to right, rgba(242,193,78,0.6), transparent);opacity:0;pointer-events:none;transition:opacity .5s ease;`;
        stage.appendChild(line);

        return { card, label, desc, num, line };
    });

    container.addEventListener('mousemove', (e) => {
        const r = container.getBoundingClientRect();
        targetTiltY = ((e.clientX - r.left) / r.width - 0.5) * 8;
        targetTiltX = ((e.clientY - r.top) / r.height - 0.5) * -5;
        if (layoutLoop) layoutLoop.request();
    });

    function layout() {
        const ch = layoutLoop?.desktop ? height : container.clientHeight;
        const previousRotation = rotation, previousTiltX = tiltX, previousTiltY = tiltY;
        const cx = -60, cy = ch / 2, R = Math.min(260, ch * 0.42);

        rotation += (targetRotation - rotation) * 0.09;
        tiltX += (targetTiltX - tiltX) * 0.06;
        tiltY += (targetTiltY - tiltY) * 0.06;
        const unchanged = previousRotation === rotation && previousTiltX === tiltX && previousTiltY === tiltY;
        if (layoutLoop?.desktop && unchanged && !dirty) return;
        setStyle(stage, 'transform', `rotateX(${tiltX}deg) rotateY(${tiltY}deg)`);

        const sorted = [];
        for (let i = 0; i < N; i++) {
            const angle = rotation + (i / N) * Math.PI * 2;
            const x = cx + Math.cos(angle) * R;
            const y = cy + Math.sin(angle) * R;
            const front = Math.cos(angle);
            sorted.push({ i, angle, x, y, front });
        }
        sorted.sort((a, b) => a.front - b.front);

        sorted.forEach(({ i, angle, x, y, front }) => {
            const { card, label, desc, line } = cardEls[i];
            const visible = front > -0.25;
            const easedFront = Math.sign(front) * Math.pow(Math.abs(front), 0.85);
            const scale = 0.5 + Math.max(0, easedFront) * 0.62;
            const blur = Math.max(0, (1 - Math.max(0, (front + 0.2))) * 5.5);
            const opacity = visible ? Math.max(0.08, (front + 0.25) / 1.15) : 0;

            let wrapped = angle % (Math.PI * 2);
            if (wrapped > Math.PI) wrapped -= Math.PI * 2;
            if (wrapped < -Math.PI) wrapped += Math.PI * 2;
            const rotY = -wrapped * (180 / Math.PI) * 0.85;

            setStyle(card, 'left', (x - 66) + 'px');
            setStyle(card, 'top', (y - 86) + 'px');
            setStyle(card, 'transform', `translateZ(${front * 40}px) scale(${scale}) rotateY(${rotY}deg)`);
            setStyle(card, 'opacity', opacity);
            setStyle(card, 'filter', `blur(${blur}px)`);
            setStyle(card, 'zIndex', Math.round(front * 1000) + 2000);

            const isFront = front > 0.9;
            const frontT = Math.max(0, (front - 0.9) / 0.1);
            setStyle(card, 'boxShadow', isFront
                ? `inset 0 1px 0 rgba(255,255,255,0.6), 0 30px 70px rgba(0,0,0,0.5), 0 0 0 1px rgba(242,193,78,${0.5 * frontT}), 0 0 45px rgba(242,193,78,${0.3 * frontT})`
                : `inset 0 1px 0 rgba(255,255,255,0.6), 0 20px 40px rgba(0,0,0,0.35)`);
            setStyle(card, 'borderColor', isFront ? `rgba(242,193,78,${0.5 * frontT})` : 'rgba(140,100,32,0.1)');

            setStyle(label, 'left', (x + 100) + 'px'); setStyle(label, 'top', (y - 18) + 'px');
            setStyle(label, 'opacity', isFront ? frontT : 0);
            setStyle(desc, 'left', (x + 100) + 'px'); setStyle(desc, 'top', (y + 16) + 'px');
            setStyle(desc, 'opacity', isFront ? frontT * 0.9 : 0);
            setStyle(line, 'left', (x + 100) + 'px'); setStyle(line, 'top', (y + 2) + 'px'); setStyle(line, 'width', '70px');
            setStyle(line, 'opacity', isFront ? frontT * 0.7 : 0);
        });

        dirty = false;
        if (layoutLoop) {
            if (!layoutLoop.desktop || !unchanged) layoutLoop.request();
        } else requestAnimationFrame(layout);
    }
    layoutLoop = window.createDesktopAnimationLoop?.(container, layout);
    if (layoutLoop) {
        new ResizeObserver(() => {
            height = container.clientHeight;
            dirty = true;
            layoutLoop.request();
        }).observe(container);
        layoutLoop.request();
    } else layout();
})();
