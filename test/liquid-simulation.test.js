const test = require("node:test");
const assert = require("node:assert/strict");
const { ParticlePool, SurfaceModel } = require("../src/renderer/liquid-simulation");

test("surface disturbance propagates and decays without unstable values", () => {
  const surface = new SurfaceModel(18);
  surface.disturb(0.5, 5);
  const initialEnergy = surface.energy();
  assert.ok(initialEnergy > 0);

  for (let frame = 0; frame < 600; frame += 1) surface.step(1 / 60, frame / 60, false);
  assert.ok(surface.offsets.every(Number.isFinite));
  assert.ok(surface.velocities.every(Number.isFinite));
  assert.ok(surface.energy() < initialEnergy);
});

test("idle surface keeps a visible but bounded water-like wave", () => {
  const surface = new SurfaceModel(24);
  let widestRange = 0;
  let narrowestRange = Infinity;
  for (let frame = 0; frame < 720; frame += 1) {
    const offsets = surface.step(1 / 60, frame / 60, true);
    if (frame > 60) {
      const range = Math.max(...offsets) - Math.min(...offsets);
      widestRange = Math.max(widestRange, range);
      narrowestRange = Math.min(narrowestRange, range);
    }
  }
  assert.ok(narrowestRange >= 10, `idle peak-to-trough range fell to ${narrowestRange}`);
  assert.ok(widestRange <= 15, `idle peak-to-trough range was too large: ${widestRange}`);
});

test("compact idle wave keeps the same visible proportion at half scale", () => {
  const surface = new SurfaceModel(18, { ambientScale: 0.5 });
  let widestRange = 0;
  let narrowestRange = Infinity;
  for (let frame = 0; frame < 720; frame += 1) {
    const offsets = surface.step(1 / 60, frame / 60, true);
    if (frame > 60) {
      const range = Math.max(...offsets) - Math.min(...offsets);
      widestRange = Math.max(widestRange, range);
      narrowestRange = Math.min(narrowestRange, range);
    }
  }
  assert.ok(narrowestRange >= 5, `compact peak-to-trough range fell to ${narrowestRange}`);
  assert.ok(widestRange <= 8, `compact peak-to-trough range was too large: ${widestRange}`);
});

test("particle pool caps droplets and expires them", () => {
  const particles = new ParticlePool(12);
  for (let index = 0; index < 10; index += 1) particles.splash(20, 30, 2);
  assert.ok(particles.items.length <= 12);
  for (let frame = 0; frame < 180; frame += 1) particles.step(1 / 60);
  assert.equal(particles.items.length, 0);
});
