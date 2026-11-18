/**
 * Equal Earth projection (Šavrič, Patterson & Jenny, 2018), spherical form.
 * An equal-area world projection: every region keeps its true relative size.
 * https://doi.org/10.1080/13658816.2018.1504949
 */

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;
/** Radius of the sphere with the same surface area as the WGS84 ellipsoid, in metres. */
const R = 6371007.181;
const DEG = Math.PI / 180;

/** [longitude, latitude] in degrees → [x, y] in metres. */
export function forward([lon, lat]: number[]): number[] {
  const theta = Math.asin(M * Math.sin(lat * DEG));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  const x = (2 * Math.sqrt(3) * lon * DEG * Math.cos(theta)) / (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1));
  const y = theta * (A4 * t6 * t2 + A3 * t6 + A2 * t2 + A1);
  return [R * x, R * y];
}

/** [x, y] in metres → [longitude, latitude] in degrees, clamped to the globe. */
export function inverse([x, y]: number[]): number[] {
  const yr = y / R;
  // Solve y(theta) = yr with Newton's method; converges in a few steps.
  let theta = yr;
  for (let i = 0; i < 12; i++) {
    const t2 = theta * theta;
    const t6 = t2 * t2 * t2;
    const f = theta * (A4 * t6 * t2 + A3 * t6 + A2 * t2 + A1) - yr;
    const fp = 9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1;
    const step = f / fp;
    theta -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  const fp = 9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1;
  const lon = (3 * (x / R) * fp) / (2 * Math.sqrt(3) * Math.cos(theta));
  const lat = Math.asin(Math.max(-1, Math.min(1, Math.sin(theta) / M)));
  const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
  return [clamp(lon / DEG, 180), clamp(lat / DEG, 90)];
}

export const MAX_X = forward([180, 0])[0];
export const MAX_Y = forward([0, 90])[1];
export const EXTENT: [number, number, number, number] = [-MAX_X, -MAX_Y, MAX_X, MAX_Y];

/** The edge of the map (the ±180° meridians and the flat poles), counter-clockwise and closed. */
export const OUTLINE: number[][] = (() => {
  const ring: number[][] = [];
  for (let lat = -90; lat <= 90; lat += 1) ring.push(forward([180, lat]));
  for (let lat = 90; lat >= -90; lat -= 1) ring.push(forward([-180, lat]));
  ring.push(ring[0]);
  return ring;
})();

/** Add points along each edge so a straight line on the map becomes the right curve in lon/lat. */
export function densify(ring: number[][], step: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
    for (let k = 0; k < n; k++) out.push([x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n]);
  }
  out.push(ring[ring.length - 1]);
  return out;
}

/**
 * Clip a ring to the map outline (Sutherland–Hodgman; the outline is convex).
 * Returns a closed ring, or null if nothing is left.
 */
export function clipToOutline(ring: number[][]): number[][] | null {
  let output = ring.slice(0, -1);
  for (let i = 0; i < OUTLINE.length - 1 && output.length > 0; i++) {
    const [ax, ay] = OUTLINE[i];
    const [bx, by] = OUTLINE[i + 1];
    const side = ([px, py]: number[]) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const sCur = side(cur);
      const sPrev = side(prev);
      if (sCur >= 0) {
        if (sPrev < 0) output.push(lerp(prev, cur, sPrev / (sPrev - sCur)));
        output.push(cur);
      } else if (sPrev >= 0) {
        output.push(lerp(prev, cur, sPrev / (sPrev - sCur)));
      }
    }
  }
  if (output.length < 3) return null;
  output.push(output[0]);
  return output;
}

function lerp(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
