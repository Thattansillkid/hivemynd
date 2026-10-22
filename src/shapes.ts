// Brain shapes: a look only. The force layout decides where each note sits; a shape
// then reshapes the whole cloud (the outline) while keeping every note in the same
// direction from the centre and at the same relative depth, so neighbourhoods and
// links stay intact. "Default" leaves the layout as it is.

export interface BrainShape { id: string; name: string; desc: string }

export const SHAPES: BrainShape[] = [
  { id: 'default', name: 'Default', desc: 'The brain as its links arrange it.' },
  { id: 'sphere', name: 'Sphere', desc: 'A perfect orb.' },
  { id: 'diamond', name: 'Diamond', desc: 'A tall four-sided diamond.' },
  { id: 'pyramid', name: 'Pyramid', desc: 'A square pyramid.' },
  { id: 'cube', name: 'Cube', desc: 'A solid block.' },
  { id: 'ring', name: 'Ring', desc: 'A torus: the brain wrapped into a donut.' },
  { id: 'galaxy', name: 'Galaxy', desc: 'A flat disc with two spiral arms and a bright core.' },
  { id: 'helix', name: 'Double helix', desc: 'Two intertwined strands, like DNA.' },
  { id: 'heart', name: 'Heart', desc: 'A 3D heart.' },
  { id: 'star', name: 'Star', desc: 'A spiky star with twelve points.' },
  { id: 'cerebrum', name: 'Cerebrum', desc: 'Two hemispheres, like a real brain.' },
];

export function shapeById(id: string | undefined) {
  return SHAPES.find((s) => s.id === id) ?? SHAPES[0];
}

type Inside = (x: number, y: number, z: number) => boolean;

const ICO: [number, number, number][] = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const v: [number, number, number][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  return v.map(([a, b, c]) => { const l = Math.hypot(a, b, c); return [a / l, b / l, c / l]; });
})();

/** Solids as "is this point inside?" tests, in units of the brain's radius. */
const SOLIDS: Record<string, Inside> = {
  sphere: (x, y, z) => x * x + y * y + z * z <= 1,
  diamond: (x, y, z) => Math.abs(x) / 0.78 + Math.abs(y) / 1.2 + Math.abs(z) / 0.78 <= 1,
  pyramid: (x, y, z) => {
    const h = (y + 0.75) / 1.7;
    if (h < 0 || h > 1) return false;
    const half = 1.0 * (1 - h);
    return Math.abs(x) <= half && Math.abs(z) <= half;
  },
  cube: (x, y, z) => Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= 0.74,
  heart: (x, y, z) => {
    // (X² + 9/4·D² + U² − 1)³ − X²·U³ − 9/80·D²·U³ ≤ 0, U up, D depth.
    const X = x * 1.15, U = y * 1.15 + 0.1, D = z * 1.15;
    const a = X * X + 2.25 * D * D + U * U - 1;
    return a * a * a - X * X * U * U * U - 0.1125 * D * D * U * U * U <= 0;
  },
  star: (x, y, z) => {
    const r = Math.hypot(x, y, z);
    if (r < 1e-6) return true;
    let m = -1;
    for (const [a, b, c] of ICO) m = Math.max(m, (a * x + b * y + c * z) / r);
    const spike = Math.max(0, (m - 0.79) / 0.21);
    return r <= 0.36 + 0.8 * Math.pow(spike, 1.6);
  },
  cerebrum: (x, y, z) => {
    const lobe = (cx: number) => ((x - cx) / 0.5) ** 2 + ((y - 0.05) / 0.72) ** 2 + (z / 0.98) ** 2 <= 1;
    // Two hemispheres with a groove between them, and a small stem below.
    const stem = (x / 0.16) ** 2 + ((y + 0.62) / 0.34) ** 2 + ((z + 0.25) / 0.2) ** 2 <= 1;
    return (Math.abs(x) > 0.035 && (lobe(0.38) || lobe(-0.38))) || stem;
  },
};

/**
 * Reshape `base` (x,y,z per note) into `out` for a shape. Each note keeps its direction
 * from the centre; its depth is measured against how far the cloud reaches in that
 * direction, so the shape is filled evenly.
 */
export function shapeCloud(id: string, base: Float32Array, out: Float32Array) {
  const n = base.length / 3;
  if (id === 'default' || !n) { out.set(base); return; }
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += base[i * 3]; cy += base[i * 3 + 1]; cz += base[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) dist[i] = Math.hypot(base[i * 3] - cx, base[i * 3 + 1] - cy, base[i * 3 + 2] - cz);
  const sorted = Float32Array.from(dist).sort();
  const R = Math.max(1, sorted[Math.floor(n * 0.95)]);

  // Notes are grouped by direction (lat/long bins).
  const LAT = 14, LON = 28;
  const binOf = (ux: number, uy: number, uz: number) => {
    const la = Math.min(LAT - 1, Math.floor(((Math.asin(Math.max(-1, Math.min(1, uy))) / Math.PI) + 0.5) * LAT));
    const lo = Math.min(LON - 1, Math.floor(((Math.atan2(uz, ux) / (2 * Math.PI)) + 0.5) * LON));
    return la * LON + lo;
  };
  const dir = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const d = dist[i] || 1;
    const ux = (base[i * 3] - cx) / d, uy = (base[i * 3 + 1] - cy) / d, uz = (base[i * 3 + 2] - cz) / d;
    dir[i * 3] = ux; dir[i * 3 + 1] = uy; dir[i * 3 + 2] = uz;
  }
  // Depth within the shape: each note's rank by distance among the notes in its
  // direction, spread evenly through the volume (cube root), so every shape fills
  // out its whole outline. A little of the original depth is kept for texture.
  const members: number[][] = Array.from({ length: LAT * LON }, () => []);
  for (let i = 0; i < n; i++) members[binOf(dir[i * 3], dir[i * 3 + 1], dir[i * 3 + 2])].push(i);
  const depth = new Float32Array(n);
  for (const list of members) {
    list.sort((a, c) => dist[a] - dist[c]);
    list.forEach((i, k) => {
      const even = Math.cbrt((k + 0.5) / list.length);
      depth[i] = Math.min(1.05, 0.8 * even + 0.2 * Math.min(1, dist[i] / R));
    });
  }

  const put = (i: number, x: number, y: number, z: number) => { out[i * 3] = cx + x * R; out[i * 3 + 1] = cy + y * R; out[i * 3 + 2] = cz + z * R; };

  if (id === 'ring') {
    for (let i = 0; i < n; i++) {
      const ux = dir[i * 3], uy = dir[i * 3 + 1], uz = dir[i * 3 + 2], r = depth[i];
      const th = Math.atan2(uz, ux), phi = Math.asin(Math.max(-1, Math.min(1, uy))) * 2;
      const m = 0.34 * Math.pow(r, 0.7), big = 0.74 + m * Math.cos(phi);
      put(i, big * Math.cos(th), m * Math.sin(phi), big * Math.sin(th));
    }
    return;
  }
  if (id === 'galaxy') {
    for (let i = 0; i < n; i++) {
      const ux = dir[i * 3], uy = dir[i * 3 + 1], uz = dir[i * 3 + 2], r = depth[i] * 1.15;
      const th = Math.atan2(uz, ux), k = 3.4;
      const arm = Math.round((th - k * r) / Math.PI) * Math.PI + k * r;
      const pull = 0.6 * Math.min(1, r / 0.18);
      const t2 = th + (arm - th) * pull;
      const thick = r < 0.2 ? 0.3 * (1 - r / 0.2) + 0.06 : 0.06 * (1.2 - r * 0.6);
      put(i, r * Math.cos(t2), uy * thick, r * Math.sin(t2));
    }
    return;
  }
  if (id === 'helix') {
    // Order notes bottom to top; two strands winding around a common axis.
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => base[a * 3 + 1] - base[b * 3 + 1]);
    order.forEach((i, rank) => {
      const u = rank / Math.max(1, n - 1);
      const strand = base[i * 3] - cx >= 0 ? 0 : Math.PI;
      const phi = u * Math.PI * 2 * 2.5 + strand;
      const j = 0.1 * depth[i];
      put(i, 0.42 * Math.cos(phi) + dir[i * 3] * j, (u - 0.5) * 2.3, 0.42 * Math.sin(phi) + dir[i * 3 + 2] * j);
    });
    return;
  }
  const inside = SOLIDS[id];
  if (!inside) { out.set(base); return; }
  fillSolid(inside, base, out, n, cx, cy, cz, R);
}

/**
 * Solid shapes: one evenly spread target point inside the shape per note, then notes
 * and targets are paired by splitting both sets in half again and again (x, y, z in
 * turn), so notes that were close stay close. Seeded, so the same vault always gets
 * the same picture.
 */
function fillSolid(inside: Inside, base: Float32Array, out: Float32Array, n: number, cx: number, cy: number, cz: number, R: number) {
  let seed = 0x9e3779b9;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const tgt = new Float32Array(n * 3);
  let k = 0, guard = 0;
  while (k < n && guard++ < n * 400) {
    const x = rnd() * 2.6 - 1.3, y = rnd() * 2.6 - 1.3, z = rnd() * 2.6 - 1.3;
    if (!inside(x, y, z)) continue;
    tgt[k * 3] = x; tgt[k * 3 + 1] = y; tgt[k * 3 + 2] = z;
    k++;
  }
  for (; k < n; k++) { tgt[k * 3] = 0; tgt[k * 3 + 1] = 0; tgt[k * 3 + 2] = 0; }
  const src = Array.from({ length: n }, (_, i) => i);
  const dst = Array.from({ length: n }, (_, i) => i);
  const match = (a: number[], b: number[], axis: number) => {
    if (a.length === 1) { const i = a[0], j = b[0]; out[i * 3] = cx + tgt[j * 3] * R; out[i * 3 + 1] = cy + tgt[j * 3 + 1] * R; out[i * 3 + 2] = cz + tgt[j * 3 + 2] * R; return; }
    if (!a.length) return;
    a.sort((p, q) => base[p * 3 + axis] - base[q * 3 + axis]);
    b.sort((p, q) => tgt[p * 3 + axis] - tgt[q * 3 + axis]);
    const h = a.length >> 1, nx = (axis + 1) % 3;
    match(a.slice(0, h), b.slice(0, h), nx);
    match(a.slice(h), b.slice(h), nx);
  };
  match(src, dst, 1);
}
