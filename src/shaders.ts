// GLSL for the Plexus renderer. Every geometry that sits on a node (sprites, link
// lines, triangle fills, travelling sparks) runs the same driftOf() so the whole
// network breathes together without any per-frame CPU work.

export const COMMON = /* glsl */ `
uniform float uTime;
uniform float uDrift;
uniform float uFocus;
uniform float uAperture;
uniform float uPixelScale;
uniform float uMaxBlurPx;
uniform float uFar;
uniform float uLinkFade; // links stay faint while the layout is still moving
uniform float uHeatMode; // 0 normal, 1 heat & decay overlay (animated between)
uniform float uFocusMode; // 0 normal, 1 task focus: only the task's notes stay lit
uniform float uAudioBeat; // music: kick envelope 0..1 (0 when off)
uniform float uAudioExpand; // music: whole-brain expansion on bass hits (fraction of radius)
uniform float uGrowth; // 1 while the growth time-lapse runs
uniform float uMeaning; // 1 in the meaning map (layout by topic, links are secondary)
uniform float uReveal; // time-lapse playhead: notes with aBorn above it aren't born yet
uniform vec3 uCenter;

// Mycelium theme: how far a point on a link (u = 0..1 from a to b) bends off the
// straight line, so links read as fungal threads. Pinned at both ends. Sparks use the
// same bend, so they still run along the thread.
uniform float uMycelium;
uniform float uSharp; // 1 in Matrix: notes stay almost in focus (no blur discs)
vec3 tendrilOffset(vec3 a, vec3 b, float u, float sa, float sb, float strand) {
  vec3 d = b - a;
  float len = length(d);
  if (len < 1e-3) return vec3(0.0);
  vec3 dir = d / len;
  vec3 up = abs(dir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 n1 = normalize(cross(dir, up));
  vec3 n2 = cross(dir, n1);
  float s = fract(sa * 13.17 + sb * 7.31) + strand * 0.37;
  float env = sin(3.14159 * u);
  float w1 = sin(u * 6.2831 * (1.3 + s * 1.4) + s * 20.0 + uTime * 0.25) + 0.45 * sin(u * 6.2831 * (4.0 + s * 3.0) + s * 9.0 - uTime * 0.18);
  float w2 = cos(u * 6.2831 * (1.1 + s) + s * 31.0) + 0.4 * sin(u * 6.2831 * (5.5 + s * 2.0) + s * 3.0 + uTime * 0.22);
  float amp = min(len * 0.07, 40.0) * (1.0 - 0.45 * strand);
  return (n1 * w1 + n2 * w2) * env * amp;
}

vec3 driftOf(vec3 p, float s) {
  float t = uTime;
  // Bass hits: the whole brain swells outward from its centre and settles back.
  return (p - uCenter) * uAudioExpand + uDrift * vec3(
    sin(t * 0.23 + s * 6.2831 + p.y * 0.004) + 0.5 * sin(t * 0.51 + s * 31.0),
    sin(t * 0.19 + s * 12.566 + p.z * 0.004) + 0.5 * sin(t * 0.43 + s * 17.0),
    sin(t * 0.17 + s * 18.849 + p.x * 0.004) + 0.5 * sin(t * 0.37 + s * 23.0));
}

// 0 = on the focal plane, 1 = fully out of focus.
float blurOf(float dist) { return clamp(abs(dist - uFocus) * uAperture, 0.0, 1.0); }

// Fades both far notes and ones right against the lens (which would otherwise be huge bokeh).
float depthFade(float dist) { return clamp(1.25 - dist / uFar, 0.12, 1.0) * smoothstep(0.05, 0.35, dist / uFocus); }
`;

export const COLORS = /* glsl */ `
uniform vec3 uFireColor;
uniform vec3 uAgentColors[8];
uniform vec3 uMusicColors[8];

// Pulse kind: 0 = spontaneous firing, 1-8 = agent slots (Claude, Codex, ...),
// 9-16 = music light show (9-12 mids palette, 13-16 highs palette).
vec3 kindColor(float k) {
  if (k < 0.5) return uFireColor;
  if (k > 8.5) return uMusicColors[int(clamp(k - 9.0, 0.0, 7.0) + 0.5)];
  return uAgentColors[int(clamp(k - 1.0, 0.0, 7.0) + 0.5)];
}
`;

// Shared by nodes and sparks: a crisp core with a halo when in focus, morphing into
// a soft bokeh disc with a faint bright rim when out of focus.
export const SPRITE_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vBlur;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float sharp = exp(-r2 * 16.0) + 0.22 * exp(-r2 * 3.5);
  float disc = (1.0 - smoothstep(0.72, 1.0, r2)) * (0.5 + 0.35 * smoothstep(0.3, 0.95, r2));
  float a = mix(sharp, disc * 0.6, vBlur);
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

// Notes. Dark theme: a small lit glass sphere with a soft halo while in focus, melting
// into a bokeh disc as it leaves the focal plane; up close (big on screen) it turns
// into a marble: a cat's-eye swirl, a tiny galaxy, a nebula or a banded planet, picked
// per note. Light theme: a small wobbling oil blob with a rainbow sheen at its edge.
export const NODE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLightMode;
uniform float uDetail; // 0 in low-latency mode: no marbles
uniform float uMarbles; // 1 in Multiverse: close-up notes become galaxies
uniform float uDew; // 1 in Mycelium: notes are drawn as dew drops
uniform float uGlyph; // 1 in Matrix: notes are glowing code glyphs
uniform sampler2D uGlyphAtlas; // 8x8 Matrix characters (white on transparent)

// One Matrix character from the atlas; q = 0..1 inside the cell (y down).
float matrixChar(float idx, vec2 q) {
  float col = mod(idx, 8.0), row = floor(idx / 8.0);
  return texture2D(uGlyphAtlas, vec2((col + q.x) / 8.0, 1.0 - (row + q.y) / 8.0)).a;
}
varying vec3 vColor;
varying float vBlur;
varying float vPx;
varying float vSeed;

float h11(float n) { return fract(sin(n) * 43758.5453); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec3 pal(float t) { return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67))); }

// What you see inside a marble, looking along the sphere normal n: a galaxy that turns
// steadily. Smooth everywhere (no twinkling, no hard star cells), so it never flickers.
vec3 marbleCore(vec3 n, float seed, float t) {
  vec3 c1 = pal(h11(seed * 13.1));
  vec3 c2 = pal(h11(seed * 7.3) + 0.35);
  float dir = h11(seed * 5.7) < 0.5 ? -1.0 : 1.0;
  vec2 p = rot(dir * t * 0.35 + seed * 6.2831) * n.xy;
  vec2 ip = p / (0.45 + 0.75 * n.z);
  float r = length(ip);
  float ang = atan(ip.y, ip.x);
  float wind = 4.0 + 2.0 * h11(seed * 2.9);
  float arms = pow(0.5 + 0.5 * cos(2.0 * ang - log(r + 0.04) * wind), 2.5) * exp(-r * 2.2);
  float dust = smoothstep(0.45, 0.85, fbm(ip * 5.0 + seed * 11.0)) * exp(-r * 1.6);
  float core = exp(-r * r * 22.0);
  float glow = exp(-r * 3.0) * 0.35;
  return vec3(0.015, 0.015, 0.04)
       + mix(c1, c2, smoothstep(0.0, 0.6, r)) * (arms * 1.7 + glow)
       + vec3(1.0, 0.93, 0.82) * (core * 1.5 + dust * 0.35);
}

// Mycelium: each note is a dew drop beaded on the threads. Mostly clear (the threads
// show through), with a bright fresnel rim, a soft caustic where light focuses through
// it, and a window glint. Steady: nothing here follows the node's firing.
vec4 dewDrop(vec2 c, float px) {
  vec2 q = c / vec2(0.84, 0.78); // a slightly squashed bead
  float r = length(q);
  float aa = clamp(2.0 / max(px, 1.0), 0.02, 0.3);
  float body = 1.0 - smoothstep(1.0 - aa, 1.0, r);
  if (body <= 0.0) return vec4(0.0);
  vec3 n = vec3(q, sqrt(max(1.0 - r * r, 0.0)));
  float fres = pow(1.0 - n.z, 3.0);
  // The drop lenses the dark ground: dim reflection, a little lighter toward the top.
  vec3 env = mix(vec3(0.04, 0.05, 0.05), vec3(0.16, 0.2, 0.21), smoothstep(-0.6, 0.8, n.y));
  // Light focused through the drop: a soft crescent low inside the rim.
  float caustic = exp(-pow((r - 0.62) * 5.0, 2.0)) * smoothstep(0.1, -0.6, q.y);
  // Window glint top-left and a softer counter-glint; faded out while the drop is
  // small, so distant drops can't twinkle.
  vec3 L = normalize(vec3(-0.5, 0.6, 0.65));
  float sharp = smoothstep(8.0, 26.0, px);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), mix(14.0, 60.0, sharp)) * mix(0.5, 1.5, sharp);
  float spec2 = pow(max(dot(reflect(-normalize(vec3(0.5, -0.4, 0.75)), n), vec3(0.0, 0.0, 1.0)), 0.0), 18.0) * 0.22;
  vec3 col = env * (0.6 + 0.8 * fres) + vec3(0.85, 0.95, 1.0) * fres * 0.42
           + vec3(0.6, 1.0, 0.8) * caustic * 0.3 + vec3(1.0) * (spec * 0.8 + spec2);
  float alpha = body * (0.16 + 0.45 * fres);
  return vec4(col * body, alpha);
}

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float disc = (1.0 - smoothstep(0.72, 1.0, r2)) * (0.5 + 0.35 * smoothstep(0.3, 0.95, r2));

  if (uGlyph > 0.5) {
    // Far: a soft green point. Close: a glowing code character (a 4x6 grid of bits fixed
    // per note) in a faint cell. Steady: nothing here follows the node's firing.
    vec2 q = c * 0.5 + 0.5;
    float inside = 1.0 - smoothstep(0.85, 1.0, max(abs(c.x), abs(c.y)));
    // A real digital-rain character per note (mirrored katakana, digits, symbols), fixed.
    float on = matrixChar(floor(h11(vSeed * 37.7) * 64.0), q);
    float detail = smoothstep(6.0, 16.0, vPx) * (1.0 - vBlur);
    float dotA = exp(-r2 * 6.0);
    vec3 green = vec3(0.0, 1.0, 0.25);
    // Glow cut ~75% (user, 2026-10-21): the glyphs read, the bloom stays quiet.
    vec3 glyph = green * on * 0.13 + green * 0.01 * inside + vec3(0.7, 1.0, 0.8) * on * 0.02;
    vec3 body = mix(green * dotA * 0.05, glyph, detail);
    float cover = mix(dotA * 0.3, max(on, inside * 0.15), detail) * (1.0 - vBlur);
    gl_FragColor = vec4(mix(body, green * disc * 0.03, vBlur), cover);
    return;
  }

  if (uDew > 0.5) {
    // Far away: a steady soft glint. Closer: the drop itself.
    vec4 d = dewDrop(c, vPx);
    float detail = smoothstep(4.0, 14.0, vPx);
    float glintA = exp(-r2 * 10.0);
    vec3 glint = vec3(0.8, 0.92, 0.95) * glintA * 0.55;
    // Half the glow (user, 2026-10-20).
    vec3 body = mix(glint, d.rgb, detail) * 0.5;
    float cover = mix(glintA * 0.25, d.a, detail) * (1.0 - vBlur);
    gl_FragColor = vec4(mix(body, vec3(0.6, 0.7, 0.72) * disc * 0.3, vBlur), cover);
    return;
  }

  if (uLightMode > 0.5) {
    // Oil blob: the outline wobbles and morphs, the body is glossy, the rim carries a
    // thin-film rainbow and a small glint. (The light theme turns brightness into ink:
    // bright = dark ink, saturated colour = coloured ink, dark = bare paper.)
    float ang = atan(c.y, c.x);
    float t = uTime;
    float edge = 0.6 + 0.09 * sin(3.0 * ang + t * 1.1 + vSeed * 40.0)
                     + 0.06 * sin(5.0 * ang - t * 0.8 + vSeed * 17.0)
                     + 0.04 * sin(2.0 * ang + t * 0.55 + vSeed * 9.0);
    float r = sqrt(r2);
    float body = 1.0 - smoothstep(edge - 0.07, edge, r);
    float rr = clamp(r / edge, 0.0, 1.0);
    vec3 n = vec3(c / edge, sqrt(max(1.0 - rr * rr, 0.0)));
    float fres = pow(1.0 - n.z, 1.6);
    // Thin-film rainbow that slides around the rim as the blob moves.
    vec3 film = pal(fres * 1.8 + vSeed * 3.0 + t * 0.06 + 0.15 * sin(ang * 2.0 + t * 0.7));
    vec3 L = normalize(vec3(-0.5, 0.6, 0.7));
    float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 9.0);
    float glint = smoothstep(0.55, 0.9, spec);
    float rimBand = smoothstep(0.15, 0.75, fres);
    // Ink space: the deep body stays near-black, the rim thins out to a saturated
    // rainbow (coloured ink), and the glint drops to bare paper.
    vec3 blob = vColor * mix(1.0, 0.0, smoothstep(0.1, 0.6, rimBand)) + film * rimBand * 0.55;
    blob *= 1.0 - 0.97 * glint;
    float cover = body * 0.9 * (1.0 - vBlur);
    gl_FragColor = vec4(mix(blob * body, vColor * disc * 0.6, vBlur), cover);
    return;
  }

  vec2 q = c / 0.6;
  float q2 = dot(q, q);
  vec3 n = vec3(q, sqrt(max(1.0 - q2, 0.0)));
  vec3 L = normalize(vec3(-0.45, 0.55, 0.75));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
  float rim = pow(1.0 - n.z, 2.2);
  float inside = 1.0 - smoothstep(0.82, 1.0, q2);
  float halo = exp(-r2 * 4.5) * 0.3;
  vec3 orb = vColor * ((0.28 + 0.6 * diff + 0.55 * rim) * inside + halo)
           + mix(vColor, vec3(1.0), 0.65) * spec * 0.9 * inside;

  // Close up (the note is big on screen and in focus) the orb becomes a marble.
  float near = smoothstep(18.0, 60.0, vPx) * (1.0 - vBlur) * uDetail * uMarbles;
  if (near > 0.002) {
    // Steady: the galaxy's brightness doesn't follow the node's firing flashes; only the
    // glass rim keeps a hint of the node's colour.
    vec3 tint = normalize(vColor + 1e-4) * 0.55;
    vec3 core = marbleCore(n, vSeed, uTime);
    vec3 glass = core * (0.6 + 0.4 * n.z) * inside
               + tint * rim * 0.6 * inside
               + vec3(1.0) * spec * 0.9 * inside
               + tint * halo * 0.6;
    orb = mix(orb, glass, near);
  }

  // Premultiplied output: the sphere body occludes what's behind it, the halo and
  // out-of-focus bokeh only add light. Dense clusters stay blue instead of going white.
  float cover = inside * 0.85 * (1.0 - vBlur);
  gl_FragColor = vec4(mix(orb, vColor * disc * 0.6, vBlur), cover);
}
`;

export const NODE_VERT = /* glsl */ `
attribute float aSize;
attribute float aSeed;
attribute float aFire;
attribute float aAI;
attribute float aAICode;
attribute float aIdx;
attribute vec3 aTint;
attribute float aHeat;
attribute float aDecay;
attribute float aFocus; // 1 = part of the focused task
attribute float aAlert; // time a watched note was touched (red flash)
attribute float aBorn; // time-lapse: 0..1 order in which the note appeared in the vault

uniform vec3 uHeatColor;
uniform vec3 uFocusColor;
uniform vec3 uAlertColor;
uniform float uBaseSize;
uniform float uNodeScale;
uniform float uHover;
uniform float uGain;

varying vec3 vColor;
varying float vBlur;
varying float vPx;
varying float vSeed;

void main() {
  vSeed = aSeed;
  vec3 p = position + driftOf(position, aSeed);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = max(-mv.z, 0.001);

  float fire = step(aFire, uTime) * exp(-max(uTime - aFire, 0.0) * 3.2);
  float adt = uTime - aAI;
  float on = step(0.0, adt);
  float aiFlash = on * exp(-adt * 1.4);
  float aiGlow = on * exp(-adt / 50.0);
  // aAICode = agent slot * 4 + mode (0 read, 1 scan, 2 write). Scans glow dimmer
  // than real reads; writes flare hardest.
  float slot = floor(aAICode / 4.0);
  float mode = aAICode - slot * 4.0;
  vec3 aiCol = kindColor(slot + 1.0);
  float aiW = mode < 0.5 ? 1.0 : (mode < 1.5 ? 0.3 : 1.25);
  float hover = 1.0 - step(0.5, abs(aIdx - uHover));
  float breathe = 0.8 + 0.2 * sin(uTime * 1.1 + aSeed * 40.0);

  // Heat & decay overlay: used notes warm toward gold and swell, untouched ones go dark.
  vec3 heatTint = mix(aTint * mix(1.0, 0.1, aDecay), uHeatColor * (1.0 + aHeat * 1.4), aHeat);
  vec3 tint = mix(aTint, heatTint, uHeatMode);
  float heatSize = mix(1.0, (1.0 + aHeat * 1.8) * mix(1.0, 0.55, aDecay), uHeatMode);

  // Task focus: the task's notes glow in the agent's colour, everything else recedes.
  tint = mix(tint, mix(tint * 0.07, mix(tint, uFocusColor, 0.75) * 1.6, aFocus), uFocusMode);
  heatSize *= mix(1.0, mix(0.6, 1.9, aFocus), uFocusMode);
  float alertDt = uTime - aAlert;
  float alert = step(0.0, alertDt) * exp(-alertDt / 2.5);

  vec3 col = tint * breathe;
  col += tint * uAudioBeat * 0.6;
  col += uAlertColor * alert * 3.0;
  col += uFireColor * fire * 1.4;
  col += aiCol * aiW * (aiFlash * 3.5 + aiGlow * 1.8);
  col += tint * 0.6 * hover;

  float pulse = uAudioBeat * 0.25 + alert * 2.5 + fire * 0.6 + aiW * (aiFlash * 3.0 + aiGlow * 1.4);
  // Mycelium: mushrooms keep a steady size (no flashing); agent-touched ones swell a little, slowly.
  pulse = mix(pulse, aiW * aiGlow * 0.35, uMycelium);
  // Mycelium: dew drops are a third of a normal note's size (user, 2026-10-20).
  float size = uBaseSize * uNodeScale * aSize * heatSize * (1.0 + pulse + hover * 0.25) * mix(1.0, 0.33, uMycelium);
  // Agent-touched notes get a screen-space minimum size so a trail reads across the
  // whole brain, even from far away, and they resist depth-of-field blur.
  float res = uPixelScale / 1000.0;
  float aiFloor = aiW * (aiGlow * 7.0 + aiFlash * 12.0 * (1.0 - uMycelium)) * res;
  float px = max(max(size * uPixelScale / dist, 2.5), aiFloor);
  // Mycelium keeps notes nearly in focus, so the mushrooms keep their shape.
  float blurPx = blurOf(dist) * uMaxBlurPx * (1.0 - 0.75 * min(aiGlow * aiW, 1.0)) * (1.0 - 0.85 * max(uMycelium, uSharp));
  vBlur = blurPx / (px + blurPx);
  float energy = pow(px / (px + blurPx), 1.6);
  // Gain only tames the resting network; firing and agent highlights stay full strength.
  vec3 rest = tint * breathe * uGain;
  vColor = (rest + (col - tint * breathe)) * max(energy, 0.03) * depthFade(dist);
  // Time-lapse: notes not born yet vanish; the newest flare briefly as they appear.
  // The flare spans the newest ~0.3% of notes, so a big import day doesn't white out.
  float newborn = uGrowth * step(aBorn, uReveal) * exp(-max(uReveal - aBorn, 0.0) * 350.0);
  vColor += vec3(0.75, 1.0, 0.98) * newborn * 0.9 * (1.0 - vBlur);
  gl_PointSize = min(px * (1.0 + newborn * 0.6) + blurPx, 160.0);
  vPx = px;
  gl_Position = projectionMatrix * mv;
  if (uGrowth > 0.5 && aBorn > uReveal) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
}
`;

export const SPARK_VERT = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec2 aSeeds;
attribute vec2 aTiming;
attribute float aKind;

uniform float uBaseSize;

varying vec3 vColor;
varying float vBlur;

void main() {
  float prog = (uTime - aTiming.x) / aTiming.y;
  if (prog < 0.0 || prog > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    vBlur = 0.0;
    return;
  }
  vec3 a = aA + driftOf(aA, aSeeds.x);
  vec3 b = aB + driftOf(aB, aSeeds.y);
  vec3 sp = mix(a, b, prog) + uMycelium * tendrilOffset(a, b, prog, aSeeds.x, aSeeds.y, 0.0);
  vec4 mv = modelViewMatrix * vec4(sp, 1.0);
  float dist = max(-mv.z, 0.001);

  float ai = step(0.5, aKind) * step(aKind, 8.5); // agent pulses are big; music sparks medium
  float music = step(8.5, aKind);
  float size = uBaseSize * mix(1.1, 3.2, ai) * (1.0 + music * 0.9);
  float px = max(size * uPixelScale / dist, mix(2.0, 9.0 * uPixelScale / 1000.0, ai));
  float blurPx = blurOf(dist) * uMaxBlurPx;
  vBlur = blurPx / (px + blurPx);
  float energy = pow(px / (px + blurPx), 1.6);
  vColor = (1.0 - 0.9 * uGrowth) * kindColor(aKind) * (mix(1.4, 4.0, ai) + music * 2.8) * max(energy, 0.25 * ai + 0.1) * mix(depthFade(dist), 1.0, ai * 0.6);
  gl_PointSize = min(px + blurPx, 160.0);
  gl_Position = projectionMatrix * mv;
}
`;

export const EDGE_VERT = /* glsl */ `
attribute float aSeed;
attribute float aT;
attribute float aKind;
attribute vec3 aPulse;
attribute float aPulseKind;
attribute vec2 aTrail; // when an agent last travelled this link, and which agent
attribute float aFocusEdge; // both ends belong to the focused task
attribute float aBornEdge; // time-lapse: the later-born end of the link
attribute float aSpan; // link length as a fraction of the brain's radius (at settle)

uniform float uLinkAlpha;
uniform float uProxAlpha;

varying float vT;
varying float vAlpha;
varying vec3 vPulse;
varying float vPK;
varying vec2 vTrail;
varying float vFlow;
varying float vStrand;

void main() {
  vTrail = aTrail;
  vFlow = fract(aSeed * 7.13);
  vStrand = 0.0;
  vec3 p = position + driftOf(position, aSeed);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = max(-mv.z, 0.001);
  vAlpha = (aKind < 0.0 ? uProxAlpha : uLinkAlpha * aKind) * mix(1.0, 0.4, blurOf(dist)) * mix(0.5, 1.0, depthFade(dist)) * uLinkFade * (1.0 - 0.6 * uHeatMode) * mix(1.0, mix(0.04, 3.5, aFocusEdge), uFocusMode);
  vAlpha *= 1.0 - uGrowth * step(uReveal, aBornEdge - 1e-6);
  // Meaning map: links that cross the map join unrelated topics; only short ones stay.
  vAlpha *= mix(1.0, 0.04 + 0.96 * smoothstep(0.45, 0.12, aSpan), uMeaning * step(0.0, aKind));
  vT = aT;
  vPulse = aPulse;
  vPK = aPulseKind;
  gl_Position = projectionMatrix * mv;
}
`;

export const EDGE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uLinkColor;
uniform float uBlood;
uniform float uHeart; // Lifeblood + music: seconds since the last kick (-1 = own clock)
uniform float uData; // 1 in Matrix: short bright data packets stream along the links

varying float vT;
varying float vAlpha;
varying vec3 vPulse; // start time, direction (+1 a->b, -1 b->a), duration
varying float vPK;
varying vec2 vTrail;
varying float vFlow;
varying float vStrand;

void main() {
  float prog = (uTime - vPulse.x) / vPulse.z;
  float head = vPulse.y > 0.0 ? prog : 1.0 - prog;
  float behind = (vT - head) * -vPulse.y;
  float live = step(0.0, prog) * (1.0 - smoothstep(1.0, 1.6, prog));
  float glow = exp(-pow((vT - head) * 9.0, 2.0)) * 1.6 + step(0.0, behind) * exp(-behind * 3.5) * 0.7;
  // An agent's path stays lit behind it and fades over ~40 s, so you can follow the trail.
  float tdt = uTime - vTrail.x;
  float trail = step(0.0, tdt) * exp(-tdt / 40.0) * step(0.5, vTrail.y);
  // Lifeblood: each link is an artery (bright red, flowing a to b) and a vein (dark,
  // bluish, flowing back). Boluses of blood travel along them, swelling on each
  // "lub-dub" of a heartbeat; every link is a little out of phase with the others.
  vec3 line = uLinkColor * vAlpha;
  if (uBlood > 0.5) {
    float dir = vStrand < 0.5 ? 1.0 : -1.0;
    float ph = fract(vT * 2.5 * dir - uTime * 0.8 + vFlow);
    float bolus = smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(0.12, 0.5, ph));
    // Own clock (~66 bpm), or with music one lub-dub per kick, rippling out over ~0.1 s.
    float hb = uHeart < 0.0 ? fract(uTime * 1.1 + vFlow * 0.15) : uHeart * 1.1 - vFlow * 0.1;
    float beat = 0.45 + exp(-pow((hb - 0.08) * 16.0, 2.0)) + 0.55 * exp(-pow((hb - 0.3) * 16.0, 2.0));
    vec3 vessel = vStrand < 0.5 ? uLinkColor : vec3(0.36, 0.09, 0.26);
    line = vessel * vAlpha * (0.4 + 1.6 * bolus * beat);
  }
  if (uData > 0.5) {
    float ph = fract(vT * 3.0 - uTime * 0.45 + vFlow);
    float packet = smoothstep(0.86, 0.9, ph) * (1.0 - smoothstep(0.96, 1.0, ph));
    line = uLinkColor * vAlpha * 0.7 + vec3(0.7, 1.0, 0.78) * packet * vAlpha * 1.6;
  }
  // Premultiplied: the line itself is solid (alpha = vAlpha), pulses add on top.
  vec3 col = line + kindColor(vPK) * glow * live * (0.35 + vAlpha * 2.0) * mix(1.0, 3.0, step(0.5, vPK))
           + kindColor(vTrail.y) * trail * 1.6;
  gl_FragColor = vec4(col, min(1.0, vAlpha + trail * 0.8));
}
`;

export const TRI_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTriAlpha;
varying float vA;

void main() {
  vec3 p = position + driftOf(position, aSeed);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = max(-mv.z, 0.001);
  vA = uTriAlpha * mix(1.0, 0.25, blurOf(dist)) * depthFade(dist) * uLinkFade * (1.0 - 0.8 * uHeatMode) * (1.0 - 0.9 * uFocusMode) * (1.0 - uGrowth) * (1.0 - uMeaning);
  gl_Position = projectionMatrix * mv;
}
`;

export const TRI_FRAG = /* glsl */ `
uniform vec3 uLinkColor;
varying float vA;
void main() { gl_FragColor = vec4(uLinkColor * vA, vA); }
`;

export const NEBULA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export const NEBULA_FRAG = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
uniform vec3 uNebula;
uniform vec2 uCam;
uniform float uAmount;
uniform vec3 uBg; // the theme's background colour (black in Multiverse)
uniform float uRain; // 1 in Matrix: falling code rain behind the brain
uniform sampler2D uGlyphAtlas;
// Screen position in units of the main screen's height, centred on it (y up): xy is this
// canvas's bottom-left corner, zw its size. Lets several monitors share one background.
uniform vec4 uSpan;
uniform vec2 uVig;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}

void main() {
  vec2 s = uSpan.xy + vUv * uSpan.zw;
  vec2 p = s * 1.8 + uCam;
  vec2 q = vec2(fbm(p + uTime * 0.012), fbm(p + vec2(5.2, 1.3) - uTime * 0.009));
  float n = fbm(p * 0.9 + q * 1.6 + uTime * 0.004);
  float cloud = pow(smoothstep(0.38, 0.9, n), 2.2);
  float vig = 1.0 - smoothstep(0.2, 1.05, length(s / uVig.y));
  vec3 col = uBg * (0.75 + 0.25 * vig) + uNebula * cloud * (0.35 + 0.65 * vig) * uAmount;
  if (uRain > 0.5) {
    // Matrix code rain: columns of glyph cells, each column with its own falling head
    // and fading trail. Glyphs are fixed per cell (no flicker); only the rain moves.
    // Uses the spanned-screen coordinates, so it runs on across monitors.
    vec2 cell = vec2(s.x * 42.0, s.y * 28.0);
    vec2 id = floor(cell);
    vec2 f = fract(cell);
    float colSeed = hash(vec2(id.x, 7.0));
    float speed = 0.35 + 0.5 * colSeed;
    float head = fract(-uTime * speed * 0.18 + colSeed * 9.0) * 3.0 - 1.0; // in s.y units
    float behind = head - s.y;
    float trail = step(0.0, -behind) * 0.0 + step(behind, 0.0) * exp(behind * 5.0) * step(-1.2, behind);
    trail = s.y >= head ? exp(-(s.y - head) * 4.0) : 0.0;
    // A real Matrix character per cell (fixed), from the same atlas as the notes.
    float gi = floor(hash(id * 1.37 + 3.0) * 64.0);
    float on = texture2D(uGlyphAtlas, vec2((mod(gi, 8.0) + f.x) / 8.0, 1.0 - (floor(gi / 8.0) + (1.0 - f.y)) / 8.0)).a;
    float isHead = exp(-pow((s.y - head) * 28.0, 2.0));
    vec3 rain = mix(vec3(0.0, 0.55, 0.18), vec3(0.75, 1.0, 0.82), isHead) * on * (trail * 0.16 + isHead * 0.35);
    col += rain * step(0.25, colSeed); // some columns stay dark
  }
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

// Final lens pass: slight chromatic fringing toward the edges, vignette, film grain.
export const FINISH_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const FINISH_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uGrain;
uniform vec2 uRes;
uniform float uLight; // 1 = light theme: glow becomes ink on paper
uniform vec3 uPaper;
uniform vec4 uSpan; // see NEBULA_FRAG
uniform vec2 uVig;  // whole picture size in the same units: the vignette spans every monitor
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 c = vUv - 0.5;
  vec2 off = c * dot(c, c) * 0.014;
  vec2 cv = (uSpan.xy + vUv * uSpan.zw) / uVig;
  float r2 = dot(cv, cv);
  vec3 col = vec3(
    texture2D(tDiffuse, vUv + off).r,
    texture2D(tDiffuse, vUv).g,
    texture2D(tDiffuse, vUv - off).b);
  float grain = (hash(vUv * uRes + fract(uTime * 7.0) * 113.0) - 0.5) * uGrain * 0.02;
  if (uLight > 0.5) {
    // Light theme: the scene is drawn exactly as in dark mode, then how bright each
    // pixel glows becomes how much ink it gets, in the same hue but darker. Faint
    // links stay a pale tint; node bodies and agent trails come out strong.
    // Monochrome structure: the network itself is drawn white in light mode, so it
    // inks to grey-black (thin dark threads, near-black nodes). Coloured light
    // (agent trails, satellites, music) keeps its hue at a readable depth.
    float m = max(max(col.r, col.g), col.b);
    float ink = 1.0 - exp(-m * 14.0);
    vec3 hue = col / max(m, 1e-4);
    float sat = (m - min(min(col.r, col.g), col.b)) / max(m, 1e-4);
    col = mix(uPaper, hue * mix(0.02, 0.45, sat), ink);
    col *= mix(0.93, 1.0, smoothstep(0.62, 0.05, r2 * 1.5));
    gl_FragColor = vec4(clamp(col - grain * 0.6, 0.0, 1.0), 1.0);
    return;
  }
  col *= mix(0.62, 1.0, smoothstep(0.62, 0.05, r2 * 1.5));
  col += grain;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

// Bridge message arcs between agent satellites: a bright head travels the curve,
// leaving a fading trail, then the whole arc fades out.
export const ARC_VERT = /* glsl */ `
attribute float aT;
varying float vT;
void main() {
  vT = aT;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ARC_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStart;
uniform vec3 uColor;
varying float vT;
void main() {
  float age = uTime - uStart;
  float head = clamp(age / 1.4, 0.0, 1.2);
  float glow = exp(-pow((vT - head) * 10.0, 2.0)) * 2.5;
  float trail = step(vT, head) * 0.55 * exp(-(head - vT) * 1.5);
  float fade = 1.0 - smoothstep(3.0, 6.0, age);
  float a = (glow + trail + 0.06) * fade;
  gl_FragColor = vec4(uColor * a, a);
}
`;

// Note markers: a ring around a note. Style 0 = claimed (solid, slowly pulsing, in
// the claiming agent's colour); style 1 = gap (a faint dashed outline: a thin note
// agents keep needing).
export const MARKER_VERT = /* glsl */ `
uniform float uPixelScale;
uniform float uSize;
attribute vec3 aColor;
attribute float aStyle;
varying vec3 vColor;
varying float vStyle;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 1.0);
  vColor = aColor;
  vStyle = aStyle;
  gl_PointSize = clamp(uSize * uPixelScale / dist, 26.0, 120.0);
  gl_Position = projectionMatrix * mv;
}
`;

export const MARKER_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vColor;
varying float vStyle;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float ring = smoothstep(0.62, 0.74, r) * (1.0 - smoothstep(0.9, 1.0, r));
  if (vStyle < 0.5) {
    // Claimed: a bright ring with a soft halo, breathing slowly.
    float pulse = 0.7 + 0.3 * sin(uTime * 2.4);
    float halo = exp(-pow((r - 0.8) * 5.0, 2.0)) * 0.35;
    float a = (ring * 2.4 + halo) * pulse * 0.5; // halved at the user's request (2026-10-20)
    gl_FragColor = vec4(vColor * a, a);
  } else {
    float ang = atan(c.y, c.x);
    float dash = step(0.0, sin(ang * 8.0 + uTime * 0.6));
    float a = ring * dash * 0.55;
    gl_FragColor = vec4(vColor * a, a);
  }
}
`;

// Handoff trail: a bright head travels the path through the first agent's notes,
// leaving a glow that holds, then fades.
export const TRAIL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStart;
uniform float uDur;
uniform float uHold;
uniform vec3 uColor;
varying float vT;
void main() {
  float age = uTime - uStart;
  float head = clamp(age / uDur, 0.0, 1.05);
  float glow = exp(-pow((vT - head) * 14.0, 2.0)) * 2.6;
  float trail = step(vT, head) * 0.6;
  float fade = 1.0 - smoothstep(uDur + uHold, uDur + uHold + 3.0, age);
  float a = (glow + trail) * fade;
  gl_FragColor = vec4(uColor * a, a);
}
`;

// Mycelium theme: each link drawn as two thin wavy threads (a fibrous bundle) instead of
// a straight line. Instanced: the per-link data is read straight from the link
// geometry's own buffers, so pulses, trails, focus and fading all behave exactly as
// for straight links. Fragment shader: EDGE_FRAG.
export const TENDRIL_VERT = /* glsl */ `
attribute float aU;      // 0..1 along the link
attribute float aStrand; // 0 = main thread, 1 = finer side thread
attribute vec3 iA;
attribute vec3 iB;
attribute float iSeedA;
attribute float iSeedB;
attribute float iKind;
attribute vec3 iPulse;
attribute float iPulseKind;
attribute vec2 iTrail;
attribute float iFocusEdge;
attribute float iBornEdge;
attribute float iSpan;

uniform float uLinkAlpha;
uniform float uProxAlpha;

varying float vT;
varying float vAlpha;
varying vec3 vPulse;
varying float vPK;
varying vec2 vTrail;
varying float vFlow;   // per-link phase, so the network pumps rather than blinks in unison
varying float vStrand; // 0 = artery, 1 = vein

void main() {
  vTrail = iTrail;
  vFlow = fract(iSeedA * 7.13 + iSeedB * 3.71);
  vStrand = aStrand;
  vec3 a = iA + driftOf(iA, iSeedA);
  vec3 b = iB + driftOf(iB, iSeedB);
  vec3 p = mix(a, b, aU) + tendrilOffset(a, b, aU, iSeedA, iSeedB, aStrand);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = max(-mv.z, 0.001);
  vAlpha = (iKind < 0.0 ? uProxAlpha : uLinkAlpha * iKind) * mix(1.0, 0.4, blurOf(dist)) * mix(0.5, 1.0, depthFade(dist)) * uLinkFade * (1.0 - 0.6 * uHeatMode) * mix(1.0, mix(0.04, 3.5, iFocusEdge), uFocusMode);
  vAlpha *= 1.0 - uGrowth * step(uReveal, iBornEdge - 1e-6);
  vAlpha *= mix(1.0, 0.04 + 0.96 * smoothstep(0.45, 0.12, iSpan), uMeaning * step(0.0, iKind));
  vAlpha *= mix(0.7, 0.3, aStrand);
  vT = aU;
  vPulse = iPulse;
  vPK = iPulseKind;
  gl_Position = projectionMatrix * mv;
}
`;
