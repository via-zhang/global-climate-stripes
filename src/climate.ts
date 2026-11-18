import * as turf from '@turf/turf';

/**
 * Regional temperature series from pre-built Berkeley Earth tiles.
 *
 * Data: Berkeley Earth Surface Temperature - High-Resolution (BEST-HR, beta),
 * 0.25° Land + Ocean (berkeleyearth.org), CC BY-NC 4.0.
 * The tiles are built by scripts/build_tiles.py and served from VITE_DATA_URL;
 * in development they are served from working/tiles.
 */

export interface YearlyData {
  year: number;
  /** Absolute annual mean temperature in °C, or null when coverage is too thin. */
  temp: number | null;
  anomaly?: number | null;
}

export interface SurfaceSeries {
  data: YearlyData[];
  /** Number of grid cells that contribute to this surface. */
  cellCount: number;
  /** This surface's share of the selected area (0–1). */
  areaShare: number;
}

export interface StripeResult {
  land: SurfaceSeries | null;
  sea: SurfaceSeries | null;
  startYear: number;
  endYear: number;
  /** Grid cell size used for this selection, in degrees. */
  resolution: number;
}

interface Level {
  id: string;
  resolution: number;
  tileDegrees: number;
  cellsPerSide: number;
  rows: number;
  cols: number;
  tilePath: string;
}

interface Manifest {
  version: number;
  startYear: number;
  endYear: number;
  years: number;
  scale: number;
  landScale: number;
  nodata: number;
  levels: Level[];
}

interface Tile {
  climatology: Int16Array;
  land: Int16Array;
  anomaly: Int16Array;
}

const DEV_DATA_URL = '/working/tiles/berkeley-earth-hr/v1/';
const DATA_BASE = (import.meta.env.VITE_DATA_URL || (import.meta.env.DEV ? DEV_DATA_URL : '')).replace(/\/?$/, '/');

/** Use 0.25° cells when the selection touches at most this many 5° tiles (~2 MB); otherwise 1°. */
const MAX_HR_TILES = 24;
/** A surface is shown only if it covers at least this share of the selection. */
const MIN_SURFACE_SHARE = 0.05;
/** A year is shown only if cells covering at least this share of the surface have data. */
const MIN_YEAR_COVERAGE = 0.5;

let manifestPromise: Promise<Manifest> | null = null;
const tileCache = new Map<string, Promise<Tile>>();

async function fetchData(url: string): Promise<Response> {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`Could not load temperature data (HTTP ${res.status})`);
  return res;
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const buf = await (await fetchData(url)).arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  // Some servers decode .gz files on the fly; only decompress if still gzipped.
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }
  return buf;
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Reject a manifest that is malformed or would point tile requests somewhere unexpected. */
function validateManifest(raw: unknown): Manifest {
  const m = raw as Manifest;
  const levelsOk =
    Array.isArray(m?.levels) &&
    m.levels.length > 0 &&
    m.levels.length <= 4 &&
    m.levels.every(
      l =>
        [0.25, 0.5, 1, 2].includes(l.resolution) &&
        isInt(l.cellsPerSide, 1, 100) &&
        // Only a fixed, relative path shape is allowed, never a full URL or "..".
        /^[a-z0-9]+\/\{row\}_\{col\}\.bin\.gz$/.test(l.tilePath),
    );
  const ok =
    levelsOk &&
    isInt(m.startYear, 1700, 2200) &&
    isInt(m.years, 1, 500) &&
    m.endYear === m.startYear + m.years - 1 &&
    isInt(m.scale, 1, 10000) &&
    isInt(m.landScale, 1, 100000) &&
    m.nodata === -32768;
  if (!ok) throw new Error('Temperature data manifest is invalid');
  return m;
}

function loadManifest(): Promise<Manifest> {
  if (!DATA_BASE || DATA_BASE === '/') {
    return Promise.reject(new Error('Temperature data location is not configured'));
  }
  if (!manifestPromise) {
    manifestPromise = fetchData(`${DATA_BASE}manifest.json`)
      .then(res => res.json())
      .then(validateManifest)
      .catch(err => {
        manifestPromise = null;
        throw err;
      });
  }
  return manifestPromise;
}

function loadTile(m: Manifest, level: Level, row: number, col: number): Promise<Tile> {
  const key = `${level.id}/${row}_${col}`;
  let p = tileCache.get(key);
  if (!p) {
    const url = DATA_BASE + level.tilePath.replace('{row}', String(row)).replace('{col}', String(col));
    p = fetchBytes(url)
      .then(buf => {
        const n = level.cellsPerSide * level.cellsPerSide;
        const expected = (2 * n + n * m.years) * 2;
        if (buf.byteLength !== expected) throw new Error('Temperature data tile is corrupted');
        // Tiles are little-endian int16, which matches every browser platform in use.
        const all = new Int16Array(buf);
        return {
          climatology: all.subarray(0, n),
          land: all.subarray(n, 2 * n),
          anomaly: all.subarray(2 * n),
        };
      })
      .catch(err => {
        tileCache.delete(key);
        throw err;
      });
    tileCache.set(key, p);
  }
  return p;
}

interface Cell {
  i: number; // latitude index from the south pole
  j: number; // longitude index from -180°
}

/** Index range of cells overlapping the polygon's bounding box at a given resolution. */
function cellRange(polygon: any, res: number) {
  const [minLng, minLat, maxLng, maxLat] = turf.bbox(polygon);
  const nLat = Math.round(180 / res);
  const nLon = Math.round(360 / res);
  const clamp = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
  return {
    i0: clamp(Math.floor((minLat + 90) / res), nLat),
    i1: clamp(Math.floor((maxLat + 90) / res), nLat),
    j0: clamp(Math.floor((minLng + 180) / res), nLon),
    j1: clamp(Math.floor((maxLng + 180) / res), nLon),
    nLat,
    nLon,
  };
}

/** Pick 0.25° cells for small selections and 1° cells for large ones. */
function chooseLevel(m: Manifest, polygon: any): Level {
  const sorted = [...m.levels].sort((a, b) => a.resolution - b.resolution);
  const fine = sorted[0];
  const { i0, i1, j0, j1 } = cellRange(polygon, fine.resolution);
  const side = fine.cellsPerSide;
  const tiles = (Math.floor(i1 / side) - Math.floor(i0 / side) + 1) * (Math.floor(j1 / side) - Math.floor(j0 / side) + 1);
  return tiles <= MAX_HR_TILES ? fine : sorted[sorted.length - 1];
}

/** Cells whose centres fall inside the polygon (or the one under its centroid). */
function cellsInPolygon(polygon: any, res: number): Cell[] {
  const { i0, i1, j0, j1, nLat, nLon } = cellRange(polygon, res);
  const cells: Cell[] = [];
  for (let i = i0; i <= i1; i++) {
    const lat = -90 + (i + 0.5) * res;
    for (let j = j0; j <= j1; j++) {
      if (turf.booleanPointInPolygon([-180 + (j + 0.5) * res, lat], polygon)) cells.push({ i, j });
    }
  }
  if (cells.length === 0) {
    const [lng, lat] = turf.centroid(polygon).geometry.coordinates;
    const clamp = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
    cells.push({ i: clamp(Math.floor((lat + 90) / res), nLat), j: clamp(Math.floor((lng + 180) / res), nLon) });
  }
  return cells;
}

export const fetchStripeData = async (polygon: any, signal?: AbortSignal): Promise<StripeResult> => {
  const m = await loadManifest();
  signal?.throwIfAborted();

  const level = chooseLevel(m, polygon);
  const res = level.resolution;
  const side = level.cellsPerSide;
  const cells = cellsInPolygon(polygon, res);
  const tileKey = (c: Cell) => `${Math.floor(c.i / side)}_${Math.floor(c.j / side)}`;
  const tiles = new Map<string, Tile>();
  await Promise.all(
    [...new Set(cells.map(tileKey))].map(async key => {
      const [r, c] = key.split('_').map(Number);
      tiles.set(key, await loadTile(m, level, r, c));
    }),
  );
  signal?.throwIfAborted();

  const Y = m.years;
  const newAcc = () => ({ total: 0, clim: 0, cells: 0, sum: new Float64Array(Y), weight: new Float64Array(Y) });
  const acc = { land: newAcc(), sea: newAcc() };

  for (const cell of cells) {
    const tile = tiles.get(tileKey(cell))!;
    const k = (cell.i % side) * side + (cell.j % side);
    const climRaw = tile.climatology[k];
    const landRaw = tile.land[k];
    if (climRaw === m.nodata || landRaw === m.nodata) continue;

    // Area weight: a grid cell shrinks with the cosine of its latitude.
    const w = Math.cos(((-90 + (cell.i + 0.5) * res) * Math.PI) / 180);
    const landFrac = landRaw / m.landScale;
    const clim = climRaw / m.scale;
    const parts: [ReturnType<typeof newAcc>, number][] = [
      [acc.land, w * landFrac],
      [acc.sea, w * (1 - landFrac)],
    ];
    for (const [s, sw] of parts) {
      if (sw <= 0) continue;
      s.total += sw;
      s.clim += sw * clim;
      s.cells++;
      const base = k * Y;
      for (let y = 0; y < Y; y++) {
        const v = tile.anomaly[base + y];
        if (v === m.nodata) continue;
        s.sum[y] += sw * (v / m.scale);
        s.weight[y] += sw;
      }
    }
  }

  const grandTotal = acc.land.total + acc.sea.total;
  const finish = (s: ReturnType<typeof newAcc>): SurfaceSeries | null => {
    if (grandTotal === 0 || s.total / grandTotal < MIN_SURFACE_SHARE) return null;
    // Average anomalies, then add back the mean climatology, so changes in
    // station coverage over time don't shift the absolute level.
    const climMean = s.clim / s.total;
    const data: YearlyData[] = [];
    for (let y = 0; y < Y; y++) {
      const covered = s.weight[y] / s.total >= MIN_YEAR_COVERAGE;
      data.push({ year: m.startYear + y, temp: covered ? s.sum[y] / s.weight[y] + climMean : null });
    }
    return { data, cellCount: s.cells, areaShare: s.total / grandTotal };
  };

  return {
    land: finish(acc.land),
    sea: finish(acc.sea),
    startYear: m.startYear,
    endYear: m.endYear,
    resolution: res,
  };
};
