// Small canvas-drawn textures: signs, plaques and noisy surfaces.
// Everything is drawn at low resolution and filtered with nearest-neighbour,
// which is what gives text and surfaces their pixel look.
import * as THREE from 'three';

const HAS_DOM = typeof document !== 'undefined';

export const FONTS = {
  display: '"Barlow Condensed", "Arial Narrow", Impact, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace',
};

export function makeCanvas(w, h) {
  if (!HAS_DOM) return null; // lets the world code run in Node for testing
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function canvasTexture(c, { repeat = null, pixel = true } = {}) {
  if (!c) return null;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (pixel) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapLinearFilter;
  }
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// Seeded random so the placeholder looks the same on every visit.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// A tiny tile of coloured noise, optionally with grout lines along two edges.
export function noiseTexture({ size = 16, base = '#999999', spread = 10, seed = 1, grout = null, repeat = [1, 1] }) {
  const c = makeCanvas(size, size);
  if (!c) return null;
  const g = c.getContext('2d');
  const r = rng(seed);
  const [br, bg, bb] = rgb(base);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (r() - 0.5) * spread;
    img.data[i * 4] = br + n;
    img.data[i * 4 + 1] = bg + n;
    img.data[i * 4 + 2] = bb + n;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  if (grout) {
    g.fillStyle = grout;
    g.fillRect(0, 0, size, 1);
    g.fillRect(0, 0, 1, size);
  }
  return canvasTexture(c, { repeat });
}

// A signboard: centred lines of text on a flat colour.
// lines: [{ text, size, font: 'display' | 'mono', weight, color, tracking, gap }]
export function signTexture({ w = 256, h = 64, bg = '#1e2b31', border = null, lines = [] }) {
  const c = makeCanvas(w, h);
  if (!c) return null;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = 2;
    g.strokeRect(4, 4, w - 8, h - 8);
  }
  const total = lines.reduce((s, l) => s + l.size * (l.gap ?? 1.1), 0);
  let y = (h - total) / 2;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (const l of lines) {
    g.font = `${l.weight ?? 700} ${l.size}px ${FONTS[l.font ?? 'display']}`;
    g.fillStyle = l.color ?? '#f2f0e8';
    if ('letterSpacing' in g) g.letterSpacing = `${l.tracking ?? 0}px`;
    g.fillText(l.text, w / 2, y, w - 20);
    y += l.size * (l.gap ?? 1.1);
  }
  return canvasTexture(c);
}

// The little placard on the front of each plinth. Drawn from exhibits.json,
// so renaming a project in the JSON renames it in the 3D world too.
export function plaqueTexture(entry, index) {
  const no = `EXH. ${String(index + 1).padStart(2, '0')}`;
  const wing = entry.wing ? ` / ${entry.wing.toUpperCase()}` : '';
  return signTexture({
    w: 200,
    h: 64,
    bg: '#f0ede7',
    border: '#98532a',
    lines: [
      { text: no + wing, size: 10, font: 'mono', weight: 600, color: '#98532a', tracking: 1, gap: 1.6 },
      { text: entry.title.toUpperCase(), size: 24, weight: 700, color: '#22272a', tracking: 0.5 },
    ],
  });
}
