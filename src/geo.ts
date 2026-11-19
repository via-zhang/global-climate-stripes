/**
 * Small lon/lat helpers for regions drawn on the globe. All coordinates are [lon, lat] degrees.
 */

type Ring = number[][];

/** Shift `lon` by whole turns so it is within 180° of `ref`. */
export function nearestLon(lon: number, ref: number): number {
  while (lon - ref > 180) lon -= 360;
  while (lon - ref < -180) lon += 360;
  return lon;
}

/** Make longitudes continuous (no jumps of more than 180°) along a line or ring. */
export function unwrap(coords: Ring): Ring {
  const out: Ring = [coords[0].slice()];
  for (let i = 1; i < coords.length; i++) out.push([nearestLon(coords[i][0], out[i - 1][0]), coords[i][1]]);
  return out;
}

/** Add points every `step` degrees along each edge of a closed ring. */
export function densify(ring: Ring, step = 1): Ring {
  const out: Ring = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / step));
    for (let k = 0; k < n; k++) out.push([x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n]);
  }
  out.push(ring[ring.length - 1]);
  return out;
}

/** Keep the part of a ring on one side of a vertical line (Sutherland–Hodgman). */
function clipRing(ring: Ring, x: number, keepLeft: boolean): Ring {
  const inside = (p: number[]) => (keepLeft ? p[0] <= x : p[0] >= x);
  const cross = (a: number[], b: number[]) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i];
    const prev = ring[(i + ring.length - 1) % ring.length];
    if (inside(cur)) {
      if (!inside(prev)) out.push(cross(prev, cur));
      out.push(cur);
    } else if (inside(prev)) {
      out.push(cross(prev, cur));
    }
  }
  return out;
}

/**
 * Cut a closed ring into pieces that each stay within -180°..180°, so a shape drawn across the
 * date line (or around a pole) becomes ordinary polygons the data lookup can handle.
 */
export function splitRing(ring: Ring): Ring[] {
  let r = unwrap(ring.slice(0, -1));
  const drift = r[r.length - 1][0] - r[0][0];
  if (Math.abs(drift) > 180) {
    // Encircles a pole: close the ring along that pole.
    const poleLat = r.reduce((a, p) => a + p[1], 0) / r.length < 0 ? -90 : 90;
    r = [...r, [r[r.length - 1][0], poleLat], [r[0][0], poleLat]];
  }
  const lons = r.map(p => p[0]);
  const min = Math.min(...lons);
  const max = Math.max(...lons);
  const pieces: Ring[] = [];
  for (let shift = -720; shift <= 720; shift += 360) {
    if (max + shift < -180 || min + shift > 180) continue;
    const shifted = r.map(([lon, lat]) => [lon + shift, lat]);
    const piece = clipRing(clipRing(shifted, 180, true), -180, false);
    if (piece.length >= 3) pieces.push([...piece, piece[0]]);
  }
  return pieces;
}

/** GeoJSON Feature for a drawn ring: a Polygon, or a MultiPolygon if it crosses the date line. */
export function regionFeature(ring: Ring) {
  const pieces = splitRing(ring);
  const geometry =
    pieces.length === 1
      ? { type: 'Polygon' as const, coordinates: [pieces[0]] }
      : { type: 'MultiPolygon' as const, coordinates: pieces.map(p => [p]) };
  return { type: 'Feature' as const, properties: {}, geometry };
}
