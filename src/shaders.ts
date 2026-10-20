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

// Notes: a small lit glass sphere with a soft halo while in focus, melting into a
// bokeh disc as it leaves the focal plane.
export const NODE_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vBlur;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;

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

  float disc = (1.0 - smoothstep(0.72, 1.0, r2)) * (0.5 + 0.35 * smoothstep(0.3, 0.95, r2));
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

void main() {
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

  float size = uBaseSize * uNodeScale * aSize * heatSize * (1.0 + uAudioBeat * 0.25 + alert * 2.5 + fire * 0.6 + aiW * (aiFlash * 3.0 + aiGlow * 1.4) + hover * 0.25);
  // Agent-touched notes get a screen-space minimum size so a trail reads across the
  // whole brain, even from far away, and they resist depth-of-field blur.
  float res = uPixelScale / 1000.0;
  float aiFloor = aiW * (aiGlow * 7.0 + aiFlash * 12.0) * res;
  float px = max(max(size * uPixelScale / dist, 2.5), aiFloor);
  float blurPx = blurOf(dist) * uMaxBlurPx * (1.0 - 0.75 * min(aiGlow * aiW, 1.0));
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
  vec4 mv = modelViewMatrix * vec4(mix(a, b, prog), 1.0);
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

void main() {
  vTrail = aTrail;
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

varying float vT;
varying float vAlpha;
varying vec3 vPulse; // start time, direction (+1 a->b, -1 b->a), duration
varying float vPK;
varying vec2 vTrail;

void main() {
  float prog = (uTime - vPulse.x) / vPulse.z;
  float head = vPulse.y > 0.0 ? prog : 1.0 - prog;
  float behind = (vT - head) * -vPulse.y;
  float live = step(0.0, prog) * (1.0 - smoothstep(1.0, 1.6, prog));
  float glow = exp(-pow((vT - head) * 9.0, 2.0)) * 1.6 + step(0.0, behind) * exp(-behind * 3.5) * 0.7;
  // An agent's path stays lit behind it and fades over ~40 s, so you can follow the trail.
  float tdt = uTime - vTrail.x;
  float trail = step(0.0, tdt) * exp(-tdt / 40.0) * step(0.5, vTrail.y);
  // Premultiplied: the line itself is solid (alpha = vAlpha), pulses add on top.
  vec3 col = uLinkColor * vAlpha + kindColor(vPK) * glow * live * (0.35 + vAlpha * 2.0) * mix(1.0, 3.0, step(0.5, vPK))
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
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 p = (vUv - 0.5) * asp * 1.8 + uCam;
  vec2 q = vec2(fbm(p + uTime * 0.012), fbm(p + vec2(5.2, 1.3) - uTime * 0.009));
  float n = fbm(p * 0.9 + q * 1.6 + uTime * 0.004);
  float cloud = pow(smoothstep(0.38, 0.9, n), 2.2);
  float vig = 1.0 - smoothstep(0.2, 1.05, length((vUv - 0.5) * asp));
  vec3 col = uNebula * cloud * (0.35 + 0.65 * vig) * uAmount;
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
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 c = vUv - 0.5;
  float r2 = dot(c, c);
  vec2 off = c * r2 * 0.014;
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
