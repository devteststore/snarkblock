// The zkSNARKs pixel system: every portrait is a 26×26 grid.
// (Punk to Bricks used 24×24; all grid-relative positions below are scaled from it.)
export const N = 26;

/** A position or length measured on a 24-pixel grid, scaled to this grid. */
export const at = (v24: number) => Math.round((v24 * N) / 24);

/** Official image of zkSNARK #n (1 to 10,000): ART_URL + artFile(n), e.g. https://zilkroad.com/api/art/1
 *  (a PNG; browsers save it as 1.png, but the URL has no extension) */
export const ART_URL = 'https://zilkroad.com/api/art/';
export const artFile = (n: number) => String(n);
export const FIRST_ID = 1, LAST_ID = 10000;
