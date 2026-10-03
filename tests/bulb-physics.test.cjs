const test = require('node:test');
const assert = require('node:assert/strict');
require('../static/bulb-physics.js');
const BulbCord = globalThis.BulbCord;

const homeGeometry = {
    anchorX: 768, anchorY: 0, length: 50, socketDistance: 26.98,
    halfWidth: 12.75, bodyTop: 39.13, bodyBottom: 20.02, width: 1280, height: 720
};
function run(model, seconds, hz = 60, start = 0) {
    for (let i = 1; i <= Math.round(seconds * hz); i++) model.advance(1 / hz, start + i * 1000 / hz);
}
function handPosition(model) {
    const r = BulbCord.rotate(model.grab.local, model.body.a);
    return { x: model.body.x + r.x, y: model.body.y + r.y };
}
function assertAtRest(model) {
    assert.ok(Math.hypot(model.body.x - model.rest.x, model.body.y - model.rest.y) < 0.2);
    assert.ok(Math.abs(model.body.a) < 0.002);
    assert.equal(model.awake, false, 'the animation should stop after settling');
}

test('grabbing an edge preserves the point clicked without a position jump', () => {
    const model = new BulbCord(homeGeometry);
    const before = { ...model.body };
    model.beginDrag({ x: before.x + 7, y: before.y + 8 }, 0);
    assert.deepEqual(model.body, before);
    model.moveDrag({ x: before.x + 22, y: before.y - 7 }, 100);
    run(model, 1, 60, 100);
    const point = handPosition(model);
    assert.ok(Math.hypot(point.x - model.grab.x, point.y - model.grab.y) < 1);
});

test('the homepage bulb can lift vertically with a slack cord, then return under gravity', () => {
    const model = new BulbCord(homeGeometry);
    const rest = { ...model.rest };
    model.beginDrag(rest, 0);
    model.moveDrag({ x: rest.x + 18, y: rest.y - 20 }, 100);
    run(model, 0.5, 60, 100);
    assert.ok(model.body.y < rest.y - 18);
    const socket = model.getSocket();
    assert.ok(Math.hypot(socket.x - model.anchor.x, socket.y - model.anchor.y) < model.length - 5);
    model.endDrag(700);
    run(model, 30, 60, 700);
    assertAtRest(model);
});

test('a moving hand transfers release momentum, but holding still does not create a throw', () => {
    function release(hold) {
        const model = new BulbCord();
        model.beginDrag(model.rest, 0);
        for (let t = 10; t <= 100; t += 10) {
            model.moveDrag({ x: model.rest.x + t * 0.8, y: model.rest.y - t * 0.3 }, t);
            model.advance(0.01, t);
        }
        if (hold) run(model, 0.5, 60, 100);
        model.endDrag(hold ? 600 : 100);
        return Math.hypot(model.body.x - model.body.oldX, model.body.y - model.body.oldY) / model.step;
    }
    assert.ok(release(false) > 200);
    assert.equal(release(true), 0);
});

test('gravity returns the approved preview to rest after a release', () => {
    const model = new BulbCord();
    model.nudge(1);
    run(model, 0.3);
    assert.ok(model.body.x - model.rest.x > 30);
    run(model, 30);
    assertAtRest(model);
});

test('motion is consistent at 30, 60 and 144 frames per second', () => {
    const poses = [30, 60, 144].map(hz => {
        const model = new BulbCord(homeGeometry);
        model.nudge(1);
        run(model, 2, hz);
        return model.body;
    });
    for (const pose of poses.slice(1)) {
        assert.ok(Math.hypot(pose.x - poses[0].x, pose.y - poses[0].y) < 0.05);
        assert.ok(Math.abs(pose.a - poses[0].a) < 0.0001);
    }
});

test('extreme pulls stay finite and inside the ceiling and release safely', () => {
    const model = new BulbCord(homeGeometry);
    model.beginDrag(model.rest, 0);
    model.moveDrag({ x: -10000, y: -10000 }, 100);
    run(model, 0.5, 60, 100);
    assert.ok(Number.isFinite(model.body.x + model.body.y + model.body.a));
    assert.ok(model.body.y >= model.anchor.y + 2);
    assert.ok(model.body.x >= 0 && model.body.x <= model.width);
    model.endDrag(600, true);
    run(model, 30, 60, 600);
    assertAtRest(model);
});

test('suspending the clock clears momentum without moving the bulb', () => {
    const model = new BulbCord(homeGeometry);
    model.nudge(1);
    run(model, 0.2);
    const before = { x: model.body.x, y: model.body.y, a: model.body.a };
    model.freeze();
    assert.deepEqual({ x: model.body.x, y: model.body.y, a: model.body.a }, before);
    assert.equal(model.body.oldX, before.x);
    assert.equal(model.body.oldY, before.y);
    assert.equal(model.body.oldA, before.a);
    assert.equal(model.accumulator, 0);
});
