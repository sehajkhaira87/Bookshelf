const test = require('node:test');
const assert = require('node:assert/strict');
require('../static/bulb-physics.js');
const Pendulum = globalThis.BulbPendulum;
const run = (p, seconds, hz = 60) => {
    for (let i = 0; i < Math.round(seconds * hz); i++) p.advance(1 / hz);
    return p;
};

test('motion is consistent across common display refresh rates', () => {
    const results = [30, 60, 144].map(hz => run(new Pendulum({ angle: 0.7 }), 4, hz));
    for (const p of results.slice(1)) {
        assert.ok(Math.abs(p.angle - results[0].angle) < 1e-9);
        assert.ok(Math.abs(p.velocity - results[0].velocity) < 1e-9);
    }
});

test('gravity pulls toward vertical and friction removes energy', () => {
    const p = new Pendulum({ angle: 0.7 });
    const energy = () => p.velocity ** 2 / 2 + 9.81 * 120 / p.length * (1 - Math.cos(p.angle));
    const initial = energy();
    p.advance(1 / 60);
    assert.ok(p.velocity < 0);
    run(p, 5);
    assert.ok(energy() < initial * 0.15);
    run(p, 35);
    assert.equal(p.angle, 0);
    assert.equal(p.velocity, 0);
});

test('moving release carries momentum; holding before release removes stale throws', () => {
    const moving = new Pendulum({ angle: 0 });
    moving.beginDrag(); moving.moveDrag(0.8); run(moving, 0.15, 120);
    assert.ok(moving.velocity > 1);
    moving.endDrag();
    const before = moving.angle; moving.advance(1 / 60);
    assert.ok(moving.angle > before);
    const held = new Pendulum({ angle: 0 });
    held.beginDrag(); held.moveDrag(0.8); run(held, 2);
    assert.ok(Math.abs(held.velocity) < 0.001);
    held.endDrag(); held.advance(1 / 60);
    assert.ok(held.velocity < 0, 'release falls under gravity instead of using old mouse velocity');
});

test('a longer pendulum accelerates more slowly; extreme inputs stay bounded', () => {
    const short = new Pendulum({ length: 60, angle: 0.5 });
    const long = new Pendulum({ length: 100, angle: 0.5 });
    short.advance(1 / 60); long.advance(1 / 60);
    assert.ok(Math.abs(short.velocity) > Math.abs(long.velocity));
    short.beginDrag(); short.moveDrag(1000); run(short, 5);
    assert.ok(short.angle <= 1.35);
    short.endDrag(); short.velocity = 1000; run(short, 5);
    assert.ok(Number.isFinite(short.angle) && Math.abs(short.angle) <= 1.35);
});

test('a resumed clock cannot fast-forward a hidden-tab gap', () => {
    const p = new Pendulum({ angle: 0.5 });
    const expected = new Pendulum({ angle: 0.5 });
    p.advance(60); expected.advance(0.05);
    assert.equal(p.angle, expected.angle);
    assert.equal(p.velocity, expected.velocity);
});
