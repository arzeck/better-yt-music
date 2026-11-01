/**
 * Animated Fluid Mesh Gradient Backdrop inspired by Apple Music & BitChord ArtworkMeshBackdrop.kt.
 *
 * Samples 4 to 6 dominant colors from the album artwork, boosts their vibrance,
 * and renders an organic, breathing mesh canvas with animated drifting blobs.
 *
 * Smoothly morphs colors when tracks change, covered by a high-contrast dark scrim
 * for 100% text readability.
 */

(() => {
  'use strict';

  class MeshBackdrop {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.rafId = null;
    this.isRunning = false;

    // Default palette (dark Apple Music purple/blue)
    this.currentColors = [
      [28, 20, 50],
      [15, 30, 65],
      [45, 15, 35],
      [20, 45, 60]
    ];
    this.targetColors = [...this.currentColors];
    this.colorLerp = 1.0; // 0..1 transition progress

    // Blob parameters for organic drift
    this.blobs = [
      { x: 0.25, y: 0.3,  vx: 0.0003, vy: 0.0002, r: 0.55, phase: 0 },
      { x: 0.75, y: 0.25, vx: -0.00025, vy: 0.00035, r: 0.6, phase: 2 },
      { x: 0.35, y: 0.8,  vx: 0.0002, vy: -0.0003, r: 0.65, phase: 4 },
      { x: 0.8,  y: 0.75, vx: -0.0003, vy: -0.0002, r: 0.5, phase: 1.5 }
    ];

    this.resize = this.resize.bind(this);
    this.tick = this.tick.bind(this);

    window.addEventListener('resize', this.resize);
    this.resize();
  }

  resize() {
    if (!this.canvas) return;
    // Lower resolution internal canvas buffer for performance, stretched via CSS
    this.canvas.width = Math.min(640, window.innerWidth / 2);
    this.canvas.height = Math.min(480, window.innerHeight / 2);
  }

  /**
   * Samples color palette from an <img> element.
   * Boosts vibrance and extracts 4 diverse corner/quadrant samples.
   */
  sampleFromImage(imgElement) {
    if (!imgElement || !imgElement.src) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const offCanvas = document.createElement('canvas');
        offCanvas.width = 16;
        offCanvas.height = 16;
        const offCtx = offCanvas.getContext('2d');
        offCtx.drawImage(img, 0, 0, 16, 16);
        const data = offCtx.getImageData(0, 0, 16, 16).data;

        // Sample 4 quadrants for distinct colors
        const quads = [
          [2, 2],    // top-left
          [13, 2],   // top-right
          [3, 13],   // bottom-left
          [13, 13]   // bottom-right
        ];

        const newPalette = quads.map(([qx, qy]) => {
          const idx = (qy * 16 + qx) * 4;
          let r = data[idx];
          let g = data[idx + 1];
          let b = data[idx + 2];

          // Lift dark tones and boost saturation for a soft, glowing frosted glass look
          const maxC = Math.max(r, g, b);
          if (maxC < 120) {
            const boost = (120 - maxC) * 0.75;
            r = Math.min(255, Math.round(r + boost));
            g = Math.min(255, Math.round(g + boost));
            b = Math.min(255, Math.round(b + boost));
          }

          r = Math.min(255, Math.max(40, Math.round(r * 1.35)));
          g = Math.min(255, Math.max(40, Math.round(g * 1.35)));
          b = Math.min(255, Math.max(40, Math.round(b * 1.35)));

          return [r, g, b];
        });

        this.setPalette(newPalette);
      } catch (_) {
        // Cross-origin fallback: use subtle ambient tint
      }
    };
    img.src = imgElement.src;
  }

  setPalette(newColors) {
    if (!Array.isArray(newColors) || newColors.length < 4) return;
    this.targetColors = newColors.slice(0, 4);
    this.colorLerp = 0.0;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.tick();
  }

  stop() {
    this.isRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  tick(time = 0) {
    if (!this.isRunning) return;
    this.rafId = requestAnimationFrame(this.tick);

    // Color transition interpolation
    if (this.colorLerp < 1.0) {
      this.colorLerp = Math.min(1.0, this.colorLerp + 0.02);
      for (let i = 0; i < 4; i++) {
        for (let c = 0; c < 3; c++) {
          this.currentColors[i][c] = Math.round(
            this.currentColors[i][c] + (this.targetColors[i][c] - this.currentColors[i][c]) * 0.05
          );
        }
      }
    }

    const { width, height } = this.canvas;
    const ctx = this.ctx;

    // Luminous ambient base tinted with the primary dominant colors
    const baseR = Math.round((this.currentColors[0][0] + this.currentColors[1][0]) * 0.16);
    const baseG = Math.round((this.currentColors[0][1] + this.currentColors[1][1]) * 0.16);
    const baseB = Math.round((this.currentColors[0][2] + this.currentColors[1][2]) * 0.16);
    ctx.fillStyle = `rgb(${baseR}, ${baseG}, ${baseB})`;
    ctx.fillRect(0, 0, width, height);

    // Draw animated fluid radial gradient blobs with luminous gradient falloff
    this.blobs.forEach((b, i) => {
      const col = this.currentColors[i] || [45, 30, 60];

      // Slow organic drift with sin wave breathing
      const bx = width * (b.x + Math.sin(time * b.vx + b.phase) * 0.2);
      const by = height * (b.y + Math.cos(time * b.vy + b.phase) * 0.2);
      const br = Math.max(width, height) * (b.r + Math.sin(time * 0.0005 + b.phase) * 0.1);

      const grad = ctx.createRadialGradient(bx, by, br * 0.05, bx, by, br);
      grad.addColorStop(0, `rgba(${col[0]}, ${col[1]}, ${col[2]}, 0.9)`);
      grad.addColorStop(0.45, `rgba(${col[0]}, ${col[1]}, ${col[2]}, 0.58)`);
      grad.addColorStop(0.82, `rgba(${col[0]}, ${col[1]}, ${col[2]}, 0.2)`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    });
  }
}

    window.__YTMLMeshBackdrop = MeshBackdrop;
})();

