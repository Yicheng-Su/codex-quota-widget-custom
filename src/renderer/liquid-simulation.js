(function exposeLiquidSimulation(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LiquidSimulation = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  class SurfaceModel {
    constructor(count = 24, options = {}) {
      this.count = Math.max(8, Math.round(count));
      this.offsets = Array(this.count).fill(0);
      this.velocities = Array(this.count).fill(0);
      this.renderOffsets = Array(this.count).fill(0);
      this.ambientScale = Math.max(0, Math.min(2, Number(options.ambientScale) || 1));
      this.tilt = 0;
      this.tiltVelocity = 0;
    }

    disturb(normalizedX, strength = 4) {
      const center = Math.max(0, Math.min(this.count - 1, Math.round(normalizedX * (this.count - 1))));
      const impulse = Math.max(-10, Math.min(10, Number(strength) || 0));
      const radius = Math.max(2.4, this.count * 0.17);
      for (let index = 0; index < this.count; index += 1) {
        const distance = (index - center) / radius;
        this.velocities[index] += impulse * Math.exp(-distance * distance * 0.5) * 0.62;
      }
      this.tiltVelocity += (0.5 - Number(normalizedX)) * impulse * 0.34;
    }

    step(deltaSeconds, elapsedSeconds = 0, idle = true) {
      const dt = Math.max(0.001, Math.min(Number(deltaSeconds) || 0.016, 0.05));
      const frame = dt * 60;
      const priorOffsets = this.offsets.slice();
      for (let index = 0; index < this.count; index += 1) {
        const left = index > 0 ? priorOffsets[index - 1] : priorOffsets[index];
        const right = index < this.count - 1 ? priorOffsets[index + 1] : priorOffsets[index];
        const pressure = (left + right - priorOffsets[index] * 2) * 0.11;
        this.velocities[index] += (-priorOffsets[index] * 0.038 + pressure) * frame;
        this.velocities[index] *= Math.pow(0.944, frame);
        this.velocities[index] = Math.max(-11, Math.min(11, this.velocities[index]));
        this.offsets[index] = Math.max(-18, Math.min(18, priorOffsets[index] + this.velocities[index] * frame));
      }

      this.tiltVelocity += -this.tilt * 0.024 * frame;
      this.tiltVelocity *= Math.pow(0.958, frame);
      this.tilt = Math.max(-10, Math.min(10, this.tilt + this.tiltVelocity * frame));

      const ambientGain = (idle ? 1 : 0.34) * this.ambientScale;
      const breathing = 0.9 + Math.sin(elapsedSeconds * 0.23) * 0.1;
      for (let index = 0; index < this.count; index += 1) {
        const x = index / Math.max(1, this.count - 1);
        const broadWave = Math.sin(elapsedSeconds * 1.08 + x * Math.PI * 2.25) * 6 * breathing;
        const crossingWave = Math.sin(elapsedSeconds * 0.71 - x * Math.PI * 1.42 + 1.2) * 0.6;
        const ambient = (broadWave + crossingWave) * ambientGain;
        const tiltOffset = this.tilt * (x - 0.5) * 2;
        this.renderOffsets[index] = Math.max(-24, Math.min(24, this.offsets[index] + tiltOffset + ambient));
      }
      return this.renderOffsets;
    }

    energy() {
      return this.offsets.reduce((sum, value, index) => sum + Math.abs(value) + Math.abs(this.velocities[index]), 0);
    }
  }

  class ParticlePool {
    constructor(limit = 28) {
      this.limit = limit;
      this.items = [];
    }

    splash(x, y, strength = 1) {
      const count = Math.max(3, Math.min(9, Math.round(4 + strength * 3)));
      for (let index = 0; index < count && this.items.length < this.limit; index += 1) {
        const spread = (index / Math.max(1, count - 1) - 0.5) * 2;
        this.items.push({
          x,
          y,
          vx: spread * (16 + strength * 10) + (Math.random() - 0.5) * 6,
          vy: -(22 + Math.random() * 18) * strength,
          radius: 0.8 + Math.random() * 1.35,
          life: 0.72 + Math.random() * 0.35
        });
      }
    }

    step(deltaSeconds) {
      const dt = Math.max(0.001, Math.min(Number(deltaSeconds) || 0.016, 0.05));
      for (const particle of this.items) {
        particle.vy += 72 * dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.life -= dt;
      }
      this.items = this.items.filter((particle) => particle.life > 0);
      return this.items;
    }
  }

  class CanvasLiquid {
    constructor(canvas, meter, options = {}) {
      this.canvas = canvas;
      this.meter = meter;
      this.context = canvas.getContext("2d", { alpha: true });
      this.surface = new SurfaceModel(options.pointCount || 24, {
        ambientScale: Number.isFinite(options.ambientScale) ? options.ambientScale : 1
      });
      this.particles = new ParticlePool(28);
      this.percent = 0;
      this.active = false;
      this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.lastFrame = performance.now();
      this.startedAt = this.lastFrame;
      this.frame = this.frame.bind(this);
      this.animationFrame = requestAnimationFrame(this.frame);
    }

    setPercent(percent) {
      this.percent = Math.max(0, Math.min(100, Number(percent) || 0));
    }

    setActive(value) {
      this.active = Boolean(value);
    }

    disturb(normalizedX, strength = 4, withParticles = false) {
      const x = Math.max(0, Math.min(1, Number(normalizedX) || 0));
      this.surface.disturb(x, strength);
      if (withParticles) {
        const metrics = this.resize();
        const surfaceY = metrics.height * (1 - this.percent / 100);
        this.particles.splash(x * metrics.width, surfaceY, Math.max(0.55, Math.abs(strength) / 5));
      }
    }

    ripple(strength = 1) {
      const scale = Math.max(0.25, Math.min(2, Number(strength) || 1));
      this.surface.disturb(0.18, 4.8 * scale);
      this.surface.disturb(0.8, -4.1 * scale);
    }

    resize() {
      const rect = this.meter.getBoundingClientRect();
      const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
        this.canvas.width = Math.round(width * ratio);
        this.canvas.height = Math.round(height * ratio);
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
      }
      this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
      return { width, height };
    }

    frame(now) {
      const delta = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
      this.lastFrame = now;
      const elapsed = (now - this.startedAt) / 1000;
      const metrics = this.resize();
      const offsets = this.reducedMotion
        ? this.surface.offsets
        : this.surface.step(delta, elapsed, !this.active);
      const particles = this.reducedMotion ? [] : this.particles.step(delta);
      this.draw(metrics, offsets, particles);
      this.animationFrame = requestAnimationFrame(this.frame);
    }

    draw({ width, height }, offsets, particles) {
      const context = this.context;
      context.clearRect(0, 0, width, height);
      const levelY = Math.max(2, Math.min(height + 2, height * (1 - this.percent / 100)));
      const rgb = getComputedStyle(this.meter).getPropertyValue("--quota-rgb").trim() || "46, 204, 151";
      const gradient = context.createLinearGradient(0, levelY, 0, height);
      gradient.addColorStop(0, `rgba(${rgb}, 0.92)`);
      gradient.addColorStop(1, `rgba(${rgb}, 0.48)`);

      const points = offsets.map((offset, index) => ({
        x: index * width / Math.max(1, offsets.length - 1),
        y: Math.max(2, Math.min(height - 2, levelY + offset))
      }));
      const traceSurface = () => {
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
          const previous = points[index - 1];
          const current = points[index];
          const midX = (previous.x + current.x) / 2;
          const midY = (previous.y + current.y) / 2;
          context.quadraticCurveTo(previous.x, previous.y, midX, midY);
        }
        const last = points[points.length - 1];
        context.quadraticCurveTo(last.x, last.y, last.x, last.y);
      };

      traceSurface();
      context.lineTo(width, height + 2);
      context.lineTo(0, height + 2);
      context.closePath();
      context.fillStyle = gradient;
      context.fill();

      traceSurface();
      context.strokeStyle = "rgba(255,255,255,0.58)";
      context.lineWidth = 1.25;
      context.stroke();

      context.fillStyle = "rgba(255,255,255,0.72)";
      for (const particle of particles) {
        context.globalAlpha = Math.max(0, Math.min(1, particle.life));
        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
    }

    destroy() {
      cancelAnimationFrame(this.animationFrame);
    }
  }

  return { CanvasLiquid, ParticlePool, SurfaceModel };
});
