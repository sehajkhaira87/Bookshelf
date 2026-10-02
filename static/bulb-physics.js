// Angles are radians from vertical; velocities are radians per second.
// A fixed simulation step makes the same pendulum behave alike at 30/60/144 Hz.
globalThis.BulbPendulum = class BulbPendulum {
    constructor({ length = 80, angle = 0.1 } = {}) {
        this.length = length;
        this.angle = angle;
        this.velocity = 0;
        this.target = angle;
        this.dragging = false;
        this.accumulator = 0;
    }

    beginDrag() {
        this.dragging = true;
        this.target = this.angle;
    }

    moveDrag(target) {
        this.target = Math.max(-1.05, Math.min(1.05, target));
    }

    endDrag() {
        // Release the simulated mass with its actual momentum, not the last
        // pointer-event delta (which can be stale after holding the bulb still).
        this.dragging = false;
    }

    resetClock() {
        this.accumulator = 0;
    }

    advance(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return;
        // Discard long pauses rather than fast-forwarding a hidden tab.
        this.accumulator += Math.min(seconds, 0.05);
        const step = 1 / 120;
        while (this.accumulator + 1e-10 >= step) {
            const gravity = -(9.81 * 120 / this.length) * Math.sin(this.angle);
            const hand = this.dragging ? 180 * (this.target - this.angle) - 24 * this.velocity : 0;
            this.velocity += (gravity + hand) * step;
            // Air/pivot friction dissipates energy, independently of frame rate.
            this.velocity *= Math.exp(-0.48 * step);
            this.velocity = Math.max(-5, Math.min(5, this.velocity));
            this.angle += this.velocity * step;
            // A gentle safety stop keeps extreme throws clear of the ceiling.
            if (Math.abs(this.angle) > 1.35) {
                this.angle = Math.sign(this.angle) * 1.35;
                this.velocity *= -0.12;
            }
            if (!this.dragging && Math.abs(this.angle) < 0.00015 && Math.abs(this.velocity) < 0.0006) {
                this.angle = this.velocity = 0;
            }
            this.accumulator = Math.max(0, this.accumulator - step);
        }
    }
};
