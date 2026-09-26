// Short list of common brick colours (BrickLink colour IDs and names), as in
// Punk to Bricks, and the mapping from zkSNARK colours to the closest one.
import { deltaE, hexToRgb, rgbToLab, type Lab, type RGB } from './color';
import { availableAtLego } from './lego';

export interface BrickColor {
  id: number;          // BrickLink colour ID
  name: string;        // BrickLink colour name
  hex: string;         // BrickLink colour value, used for matching
  render?: string;     // how the real brick looks on screen, if different
  trans?: boolean;
}

export const BRICK_COLORS: BrickColor[] = [
  { id: 1, name: 'White', hex: '#F4F4F4' },
  { id: 11, name: 'Black', hex: '#1B1B1B' },
  { id: 86, name: 'Light Bluish Gray', hex: '#A0A5A9' },
  { id: 85, name: 'Dark Bluish Gray', hex: '#6C6E68' },
  { id: 5, name: 'Red', hex: '#C91A09' },
  { id: 59, name: 'Dark Red', hex: '#720E0F' },
  { id: 4, name: 'Orange', hex: '#FE8A18' },
  { id: 3, name: 'Yellow', hex: '#F2CD37' },
  { id: 103, name: 'Bright Light Yellow', hex: '#FFF03A' },
  { id: 2, name: 'Tan', hex: '#E4CD9E' },
  { id: 69, name: 'Dark Tan', hex: '#958A73' },
  { id: 90, name: 'Light Nougat', hex: '#F6D7B3' },
  { id: 28, name: 'Nougat', hex: '#D09168' },
  { id: 150, name: 'Medium Nougat', hex: '#AA7D55' },
  { id: 68, name: 'Dark Orange', hex: '#A95500' },
  { id: 88, name: 'Reddish Brown', hex: '#582A12' },
  { id: 120, name: 'Dark Brown', hex: '#352100' },
  { id: 34, name: 'Lime', hex: '#BBE90B' },
  { id: 36, name: 'Bright Green', hex: '#4B9F4A' },
  { id: 6, name: 'Green', hex: '#237841' },
  { id: 80, name: 'Dark Green', hex: '#184632' },
  { id: 155, name: 'Olive Green', hex: '#9B9A5A' },
  { id: 48, name: 'Sand Green', hex: '#A0BCAC' },
  { id: 152, name: 'Light Aqua', hex: '#ADC3C0', render: '#C9EDE6' },
  { id: 156, name: 'Medium Azure', hex: '#36AEBF' },
  { id: 105, name: 'Bright Light Blue', hex: '#9FC3E9' },
  { id: 7, name: 'Blue', hex: '#0055BF' },
  { id: 63, name: 'Dark Blue', hex: '#0A3463' },
  { id: 55, name: 'Sand Blue', hex: '#6074A1' },
  { id: 104, name: 'Bright Pink', hex: '#E4ADC8' },
  { id: 47, name: 'Dark Pink', hex: '#C870A0' },
  { id: 71, name: 'Magenta', hex: '#923978' },
  { id: 89, name: 'Dark Purple', hex: '#4B2E8C' },
  { id: 157, name: 'Medium Lavender', hex: '#AC78BA' },
  { id: 154, name: 'Lavender', hex: '#E1D5ED' },
  { id: 12, name: 'Trans-Clear', hex: '#EEEEEE', trans: true },
  { id: 15, name: 'Trans-Light Blue', hex: '#AEEFEC', trans: true },
  { id: 17, name: 'Trans-Red', hex: '#C91A09', trans: true },
];

export const COLOR_BY_ID = new Map(BRICK_COLORS.map(c => [c.id, c]));
export const BLACK = 11, TRANS_CLEAR = 12, BASE_GRAY = 85;
const LAB = new Map<number, Lab>(BRICK_COLORS.map(c => [c.id, rgbToLab(hexToRgb(c.hex))]));
// zkSNARK art has no transparent parts: the art is only matched to solid colours.
// Trans-Clear stays reserved for the clear support posts.
const MATCHABLE = BRICK_COLORS.filter(c => !c.trans);

export interface SnarkColor { rgb: RGB; count: number }

const chroma = (l: Lab) => Math.hypot(l[1], l[2]);
const hue = (l: Lab) => (Math.atan2(l[2], l[1]) * 180 / Math.PI + 360) % 360;
const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
/** below this chroma a colour counts as grey (black, greys, white) */
const GREY = 8;
/** closeness points added per degree of hue difference beyond 10° */
const HUE_PENALTY = 0.2;
/** shades closer than this are one colour: they get the same brick colour */
const SHADE = 6;

/** Closest brick colour within the colour's family (see mapColors), among `base`. */
function closest(lab: Lab, base: BrickColor[]): number {
  // near-black (dark and weakly coloured) reads as black; a grey stays among grey bricks
  const grey = chroma(lab) < GREY || (lab[0] < 20 && chroma(lab) < 25);
  // a colour only among colour bricks of at least 40% of its strength, within 45° of hue
  let pool = base.filter(b => { const bl = LAB.get(b.id)!; return grey ? chroma(bl) < GREY || bl[0] < 20 : chroma(bl) >= Math.max(GREY, chroma(lab) * 0.4) && hueGap(hue(bl), hue(lab)) <= 45; });
  if (!pool.length) pool = base;
  // closest (CIEDE2000), with a penalty for each degree of hue difference beyond 10°:
  // an army green goes to Olive Green (3° off) rather than Green (40° off)
  const score = (b: BrickColor) => { const bl = LAB.get(b.id)!; return deltaE(lab, bl) + (grey ? 0 : HUE_PENALTY * Math.max(0, hueGap(hue(bl), hue(lab)) - 10)); };
  let best = pool[0].id, d = Infinity;
  for (const b of pool) { const e = score(b); if (e < d) { d = e; best = b.id; } }
  return best;
}

/**
 * Map each zkSNARK colour to its closest brick colour (CIEDE2000), within its own
 * family: a grey, white or near-black only among grey bricks; a colour only among
 * bricks of a similar hue (closest, with a penalty per degree of hue difference) and
 * at least 40% of its strength. The plain
 * closest colour can jump hue when no brick has the right lightness (a dark grey
 * to Dark Blue, a light cyan to a grey-green).
 * Near-identical shades (within ΔE 6) are matched together, from their average,
 * so smooth shading doesn't break into a speckle of two brick colours.
 */
export function mapColors(colors: SnarkColor[], onlyLego = false): number[] {
  // "only parts LEGO sells": only colours LEGO sells the 1x1 brick, plate and tile in
  const base = onlyLego ? MATCHABLE.filter(b => (['brick', 'plate', 'tile'] as const).every(k => availableAtLego(k, 1, 1, b.id))) : MATCHABLE;
  const labs = colors.map(c => rgbToLab(c.rgb));
  // group shades: most used colours first, each joins the nearest group within SHADE
  const order = colors.map((_, i) => i).sort((a, b) => colors[b].count - colors[a].count);
  const groupOf: number[] = [], seeds: number[] = [];
  for (const i of order) {
    let g = -1, d = SHADE;
    seeds.forEach((s, k) => { const e = deltaE(labs[i], labs[s]); if (e < d) { d = e; g = k; } });
    if (g < 0) { g = seeds.length; seeds.push(i); }
    groupOf[i] = g;
  }
  const brick = seeds.map((_, g) => {
    const members = colors.map((c, i) => ({ c, i })).filter(m => groupOf[m.i] === g);
    const n = members.reduce((a, m) => a + m.c.count, 0);
    const mean = [0, 1, 2].map(k => members.reduce((a, m) => a + labs[m.i][k] * m.c.count, 0) / n) as Lab;
    return closest(mean, base);
  });
  return colors.map((_, i) => brick[groupOf[i]]);
}

/** Colour to draw a brick with (3D view, instructions). */
export const renderHex = (id: number) => { const c = COLOR_BY_ID.get(id)!; return c.render ?? c.hex; };
