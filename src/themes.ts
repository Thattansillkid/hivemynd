// Brain themes. Multiverse and Inkblot are the original dark and light looks; the
// rest are colour schemes on the dark pipeline (glowing notes on a coloured ground).

export interface BrainTheme {
  id: string;
  name: string;
  mood: string;
  /** Drawn as ink on paper (the light pipeline) instead of light on a dark ground. */
  light: boolean;
  /** Close-up notes become turning galaxies (Multiverse's signature). */
  marbles: boolean;
  /** Mycelium: notes drawn as dew drops, links as fungal tendrils (look only). */
  mycelium?: boolean;
  /** Links drawn as organic wavy threads (Mycelium, Lifeblood). */
  tendrils?: boolean;
  /** Notes drawn as small dew drops (Mycelium). */
  dew?: boolean;
  /** Blood pumping through the links on a heartbeat (Lifeblood). */
  blood?: boolean;
  /** Code rain behind the brain, glyph notes and data packets on the links (Matrix). */
  matrix?: boolean;
  bg?: string;
  node?: string;
  link?: string;
  accent?: string;
}

export const THEMES: BrainTheme[] = [
  { id: 'multiverse', name: 'Multiverse', mood: 'Glowing glass on black. Up close, every note is a turning galaxy.', light: false, marbles: true },
  { id: 'inkblot', name: 'Inkblot', mood: 'Ink on paper. Notes drift like small oil blobs.', light: true, marbles: false },
  { id: 'violet-dusk', name: 'Violet Dusk', mood: 'Calm and a little mystical, like thoughts lighting up in a dim room.', light: false, marbles: false, bg: '#1E2230', node: '#B89CFF', link: '#4A4F6A', accent: '#8B5CF6' },
  { id: 'tide-pulse', name: 'Tide Pulse', mood: 'Clean, technical and quietly alive, like a heartbeat moving through the network.', light: false, marbles: false, bg: '#1C1F21', node: '#5EEAD4', link: '#3A4144', accent: '#14B8A6' },
  { id: 'copper-ember', name: 'Copper Ember', mood: 'Grounded, earthy and handcrafted.', light: false, marbles: false, bg: '#3A3633', node: '#D9CFC4', link: '#6B625B', accent: '#C87533' },
  { id: 'aurora-moss', name: 'Aurora Moss', mood: 'Organic and alive, like bioluminescence in a forest at night.', light: false, marbles: false, bg: '#0D1A14', node: '#C6F16D', link: '#2F4A3A', accent: '#FF6FB5' },
  { id: 'mycelium', name: 'Mycelium', mood: 'A forest floor at night: fungal threads beaded with dew drops.', light: false, marbles: false, mycelium: true, tendrils: true, dew: true, bg: '#0E0B08', node: '#E8D9B5', link: '#D8C7A0', accent: '#7CFFB2' },
  { id: 'lifeblood', name: 'Lifeblood', mood: 'Arteries and veins: blood pumps from note to note on a heartbeat.', light: false, marbles: false, tendrils: true, blood: true, bg: '#140306', node: '#E5484D', link: '#C0141F', accent: '#FF5A4E' },
  { id: 'matrix', name: 'Matrix', mood: 'Green code rain, notes as glowing glyphs, data packets streaming along the links.', light: false, marbles: false, matrix: true, bg: '#010703', node: '#00FF41', link: '#0B8F3A', accent: '#B6FFC8' },
  { id: 'solar-ink', name: 'Solar Ink', mood: 'Bold and energetic, like a sunrise breaking through ink.', light: false, marbles: false, bg: '#14112B', node: '#FF7A59', link: '#4B3B6B', accent: '#FFD23F' },
];

export function themeById(id: string | undefined): BrainTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function mix(a: string, b: string, t: number) {
  const x = rgb(a), y = rgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function alpha(hex: string, a: number) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Brain Monitor colours for a theme (its CSS variables). Null for Multiverse and
 * Inkblot, which use the monitor's built-in dark and light styles.
 */
export function monitorVars(t: BrainTheme): Record<string, string> | null {
  if (!t.bg || !t.node || !t.accent) return null;
  return {
    '--pl-bg': mix(t.bg, '#000000', 0.25),
    '--pl-panel': mix(t.bg, t.node, 0.05),
    '--pl-line': alpha(t.node, 0.16),
    '--pl-cyan': t.node,
    '--pl-text': mix(t.node, '#ffffff', 0.82),
    '--pl-dim': mix(t.node, t.bg, 0.35),
    '--pl-faint': mix(t.node, t.bg, 0.6),
  };
}

/** Accent for the brain's own buttons and menus (null = the built-in teal). */
export function chromeAccent(t: BrainTheme) {
  return t.node ?? null;
}
