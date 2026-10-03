// Flexible cord and rigid bulb, using the approved preview's fixed-step solver.
// Distances are CSS pixels, angles are radians, and velocities use seconds.
globalThis.BulbCord = class BulbCord {
    constructor(geometry = {}) {
        this.step = 1 / 240;
        this.nodeCount = 14;
        this.air = 0.62;
        this.configure(geometry);
    }

    static clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
    static rotate(point, angle) {
        const c = Math.cos(angle), s = Math.sin(angle);
        return { x: point.x * c - point.y * s, y: point.x * s + point.y * c };
    }

    configure({ anchorX = 250, anchorY = 32, length = 180, socketDistance = 72,
        halfWidth = 29, bodyTop = 72, bodyBottom = 60, width = 500, height = 460 } = {}) {
        this.anchor = { x: anchorX, y: anchorY };
        Object.assign(this, { length, socketDistance, halfWidth, bodyTop, bodyBottom, width, height });
        this.scale = Math.max(0.25, (bodyTop + bodyBottom) / 132);
        this.invInertia = 1 / (1550 * this.scale * this.scale);
        this.gravity = 1380 * this.scale;
        this.reset();
    }

    reset() {
        const { x, y } = this.anchor;
        this.grab = null;
        this.nodes = Array.from({ length: this.nodeCount }, (_, i) => ({
            x, y: y + this.length * i / this.nodeCount,
            oldX: x, oldY: y + this.length * i / this.nodeCount
        }));
        const bodyY = y + this.length + this.socketDistance;
        this.body = { x, y: bodyY, oldX: x, oldY: bodyY, a: 0, oldA: 0 };
        // Settle the cord's tiny elastic stretch before the first paint.
        for (let i = 0; i < 480; i++) this.simulate(this.step);
        this.rest = { x: this.body.x, y: this.body.y };
        this.freeze();
        this.awake = false;
        this.quietTime = 0;
        this.samples = [];
    }

    freeze() {
        const b = this.body;
        b.oldX = b.x; b.oldY = b.y; b.oldA = b.a;
        this.nodes.forEach(p => { p.oldX = p.x; p.oldY = p.y; });
        this.resetClock();
    }

    resetClock() { this.accumulator = 0; this.poses = []; }

    getSocket() {
        const r = BulbCord.rotate({ x: 0, y: -this.socketDistance }, this.body.a);
        return { x: this.body.x + r.x, y: this.body.y + r.y };
    }

    beginDrag(point, time) {
        this.grab = { ...point, local: BulbCord.rotate({
            x: point.x - this.body.x, y: point.y - this.body.y
        }, -this.body.a) };
        this.samples = [{ ...point, time }];
        this.poses = [{ a: this.body.a, time }];
        this.awake = true;
        this.quietTime = 0;
    }

    moveDrag(point, time, immediate = false) {
        if (!this.grab) return;
        let { x, y } = point;
        const dx = x - this.anchor.x, dy = y - this.anchor.y, d = Math.hypot(dx, dy);
        const reach = this.length + this.socketDistance + Math.hypot(this.grab.local.x, this.grab.local.y) - 2 * this.scale;
        if (d > reach) { x = this.anchor.x + dx * reach / d; y = this.anchor.y + dy * reach / d; }
        this.grab.x = x;
        this.grab.y = Math.max(this.anchor.y + 2 * this.scale, y);
        this.samples.push({ x: this.grab.x, y: this.grab.y, time });
        this.samples = this.samples.filter(p => time - p.time <= 110);
        if (immediate) {
            const r = BulbCord.rotate(this.grab.local, this.body.a);
            this.body.x = this.grab.x - r.x; this.body.y = this.grab.y - r.y;
            this.solveContacts();
            this.freeze();
        }
    }

    static recentVelocity(points, time, field) {
        const recent = points.filter(p => time - p.time <= 90);
        if (recent.length < 2 || time - recent[recent.length - 1].time > 70) return 0;
        const origin = recent[0].time;
        let mt = 0, mv = 0;
        recent.forEach(p => { mt += (p.time - origin) / 1000; mv += p[field]; });
        mt /= recent.length; mv /= recent.length;
        let numerator = 0, denominator = 0;
        recent.forEach(p => {
            const t = (p.time - origin) / 1000 - mt;
            numerator += t * (p[field] - mv); denominator += t * t;
        });
        return denominator > 1e-6 ? numerator / denominator : 0;
    }

    endDrag(time, cancelled = false) {
        if (!this.grab) return;
        const velocity = field => cancelled ? 0 : BulbCord.clamp(
            BulbCord.recentVelocity(this.samples, time, field), -1250 * this.scale, 1250 * this.scale);
        const omega = cancelled ? 0 : BulbCord.clamp(BulbCord.recentVelocity(this.poses, time, 'a'), -12, 12);
        const r = BulbCord.rotate(this.grab.local, this.body.a);
        this.body.oldX = this.body.x - (velocity('x') + omega * r.y) * this.step;
        this.body.oldY = this.body.y - (velocity('y') - omega * r.x) * this.step;
        this.body.oldA = this.body.a - omega * this.step;
        this.grab = null;
        if (cancelled) this.freeze();
        this.awake = true;
        this.quietTime = 0;
    }

    nudge(direction) {
        this.body.oldX = this.body.x - direction * 340 * this.scale * this.step;
        this.awake = true; this.quietTime = 0;
    }

    solveRope(a, b, pinned) {
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), limit = this.length / this.nodeCount;
        // Only maximum length is constrained: a lifted cord can go slack.
        if (d <= limit || d < 1e-8) return;
        const wa = pinned ? 0 : 70, wb = 70, s = (d - limit) / (d * (wa + wb));
        a.x += dx * s * wa; a.y += dy * s * wa;
        b.x -= dx * s * wb; b.y -= dy * s * wb;
    }

    solveAttachment() {
        const p = this.nodes[this.nodeCount - 1], b = this.body;
        const r = BulbCord.rotate({ x: 0, y: -this.socketDistance }, b.a);
        const dx = b.x + r.x - p.x, dy = b.y + r.y - p.y, d = Math.hypot(dx, dy), limit = this.length / this.nodeCount;
        if (d <= limit || d < 1e-8) return;
        const nx = dx / d, ny = dy / d, angular = r.x * ny - r.y * nx;
        const impulse = -(d - limit) / (71 + this.invInertia * angular * angular);
        p.x -= 70 * nx * impulse; p.y -= 70 * ny * impulse;
        b.x += nx * impulse; b.y += ny * impulse; b.a += this.invInertia * angular * impulse;
    }

    solveGrab() {
        if (!this.grab) return;
        const b = this.body, r = BulbCord.rotate(this.grab.local, b.a);
        const ex = b.x + r.x - this.grab.x, ey = b.y + r.y - this.grab.y;
        const jx = -r.y, jy = r.x, inertia = this.invInertia;
        const kxx = 1 + inertia * jx * jx, kyy = 1 + inertia * jy * jy, kxy = inertia * jx * jy;
        const det = kxx * kyy - kxy * kxy;
        const lx = (-kyy * ex + kxy * ey) / det, ly = (kxy * ex - kxx * ey) / det;
        b.x += lx; b.y += ly; b.a += inertia * (jx * lx + jy * ly);
    }

    solveContacts() {
        const b = this.body, c = Math.cos(b.a), s = Math.sin(b.a), w = this.halfWidth;
        const left = Math.min(-w * c + this.bodyTop * s, w * c + this.bodyTop * s,
            -w * c - this.bodyBottom * s, w * c - this.bodyBottom * s);
        const right = Math.max(-w * c + this.bodyTop * s, w * c + this.bodyTop * s,
            -w * c - this.bodyBottom * s, w * c - this.bodyBottom * s);
        const top = Math.min(-w * s - this.bodyTop * c, w * s - this.bodyTop * c,
            -w * s + this.bodyBottom * c, w * s + this.bodyBottom * c);
        const bottom = Math.max(-w * s - this.bodyTop * c, w * s - this.bodyTop * c,
            -w * s + this.bodyBottom * c, w * s + this.bodyBottom * c);
        b.x = BulbCord.clamp(b.x, 2 - left, this.width - 2 - right);
        b.y = BulbCord.clamp(b.y, this.anchor.y + 2 - top, this.height - 2 - bottom);
        for (let i = 1; i < this.nodeCount; i++) {
            this.nodes[i].x = BulbCord.clamp(this.nodes[i].x, 2, this.width - 2);
            this.nodes[i].y = Math.max(this.anchor.y, this.nodes[i].y);
        }
    }

    simulate(dt) {
        const ropeDrag = Math.exp(-0.45 * dt), bodyDrag = Math.exp(-this.air * dt), angularDrag = Math.exp(-0.9 * dt);
        const gravity = this.gravity * dt * dt;
        for (let i = 1; i < this.nodeCount; i++) {
            const p = this.nodes[i], x = p.x, y = p.y;
            p.x += (p.x - p.oldX) * ropeDrag; p.y += (p.y - p.oldY) * ropeDrag + gravity;
            p.oldX = x; p.oldY = y;
        }
        const b = this.body, x = b.x, y = b.y, a = b.a;
        b.x += (b.x - b.oldX) * bodyDrag; b.y += (b.y - b.oldY) * bodyDrag + gravity;
        b.a += (b.a - b.oldA) * angularDrag;
        b.oldX = x; b.oldY = y; b.oldA = a;
        for (let pass = 0; pass < 32; pass++) {
            this.nodes[0].x = this.anchor.x; this.nodes[0].y = this.anchor.y;
            for (let i = 1; i < this.nodeCount; i++) this.solveRope(this.nodes[i - 1], this.nodes[i], i === 1);
            this.solveAttachment(); this.solveGrab(); this.solveContacts();
        }
    }

    advance(seconds, time = 0) {
        if (!this.awake || !Number.isFinite(seconds) || seconds <= 0) return;
        this.accumulator += Math.min(seconds, 0.04);
        while (this.accumulator + 1e-10 >= this.step) {
            this.simulate(this.step);
            const b = this.body;
            if (!Number.isFinite(b.x + b.y + b.a)) { this.reset(); return; }
            const speed = Math.hypot(b.x - b.oldX, b.y - b.oldY) / this.step;
            const rotation = Math.abs(b.a - b.oldA) / this.step;
            this.quietTime = !this.grab && speed < 0.65 * this.scale && rotation < 0.018 ? this.quietTime + this.step : 0;
            this.accumulator = Math.max(0, this.accumulator - this.step);
            if (this.quietTime > 1.1) { this.reset(); return; }
        }
        this.poses.push({ a: this.body.a, time });
        this.poses = this.poses.filter(p => time - p.time <= 100);
    }
};
