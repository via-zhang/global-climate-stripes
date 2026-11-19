import { useEffect, useRef, useState } from 'react';
import {
  Map as MapLibreMap,
  type GeoJSONSource,
  type LngLat,
  type MapMouseEvent,
  type MapTouchEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import { Minus, Pentagon, Plus, Square } from 'lucide-react';
import { densify, nearestLon, regionFeature, unwrap } from './geo';

type DrawMode = 'polygon' | 'box' | null;
type Ring = number[][];

const EMPTY = { type: 'FeatureCollection' as const, features: [] };
const REGION_COLOR = '#60a5fa';

/**
 * A 3D globe (MapLibre GL's globe projection) with OpenStreetMap raster tiles, darkened by
 * inverting their colors. Same look as the global-nature-art project's dark mode.
 */
const STYLE: StyleSpecification = {
  version: 8,
  projection: { type: 'globe' },
  sky: {
    'sky-color': '#0d1b2a',
    'horizon-color': '#1f3b52',
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
  },
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    },
    region: { type: 'geojson', data: EMPTY },
    sketch: { type: 'geojson', data: EMPTY },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#0f1a24' } },
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      paint: {
        'raster-brightness-min': 1,
        'raster-brightness-max': 0.08,
        'raster-hue-rotate': 180,
        'raster-saturation': -0.35,
        'raster-contrast': 0.1,
      },
    },
    { id: 'region-fill', type: 'fill', source: 'region', paint: { 'fill-color': REGION_COLOR, 'fill-opacity': 0.2 } },
    { id: 'region-line', type: 'line', source: 'region', paint: { 'line-color': REGION_COLOR, 'line-width': 2 } },
    {
      id: 'sketch-fill',
      type: 'fill',
      source: 'sketch',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': REGION_COLOR, 'fill-opacity': 0.15 },
    },
    {
      id: 'sketch-line',
      type: 'line',
      source: 'sketch',
      filter: ['!=', ['geometry-type'], 'Point'],
      paint: { 'line-color': REGION_COLOR, 'line-width': 2, 'line-dasharray': [2, 1] },
    },
    {
      id: 'sketch-points',
      type: 'circle',
      source: 'sketch',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 4, 'circle-color': '#ffffff', 'circle-stroke-color': REGION_COLOR, 'circle-stroke-width': 2 },
    },
  ],
};

/** Opening zoom: show the whole globe on any screen size. */
function initialZoom() {
  const w = window.innerWidth;
  return w < 640 ? 0.6 : w < 1024 ? 1.2 : 1.6;
}

/** A latitude/longitude box between two corners, taking the shorter way around in longitude. */
function boxRing(a: LngLat, b: LngLat): Ring {
  const lon = nearestLon(b.lng, a.lng);
  return densify([
    [a.lng, a.lat],
    [lon, a.lat],
    [lon, b.lat],
    [a.lng, b.lat],
    [a.lng, a.lat],
  ]);
}

/** Close and densify the clicked polygon points, so drawn edges and the data region match. */
function polygonRing(points: Ring): Ring {
  const r = unwrap(points);
  return densify([...r, r[0]]);
}

const polygon = (ring: Ring) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [ring] } });

export default function MapView({
  onPolygonCreated,
  onDrawStart,
  bottomInset = 0,
}: {
  onPolygonCreated: (geoJSON: any) => void;
  onDrawStart?: () => void;
  /** Pixels covered at the bottom (the open stripes panel); the globe centers in the rest. */
  bottomInset?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const callbacksRef = useRef({ onPolygonCreated, onDrawStart });
  const [mode, setMode] = useState<DrawMode>(null);

  useEffect(() => {
    callbacksRef.current = { onPolygonCreated, onDrawStart };
  }, [onPolygonCreated, onDrawStart]);

  // Create the globe once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE,
      center: [0, 20],
      zoom: initialZoom(),
      minZoom: 0.3,
      maxZoom: 14,
      attributionControl: { compact: true },
      // Keep the globe north-up and flat-on; rotating or tilting it isn't needed to pick regions.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      // No coasting after a drag: the globe stops where the pointer is released.
      dragPan: { maxSpeed: 0 },
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Slide the globe up above the stripes panel while it's open, and back down when it closes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const height = map.getContainer().clientHeight;
    const bottom = Math.max(0, Math.min(bottomInset, height - 120));
    map.easeTo({ padding: { top: 0, left: 0, right: 0, bottom }, duration: 500 });
  }, [bottomInset]);

  // One-shot drawing tools: drag a box, or click points and double-click (or click the first point).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mode) return;
    const sketch = () => map.getSource<GeoJSONSource>('sketch');
    const region = () => map.getSource<GeoJSONSource>('region');
    const canvas = map.getCanvas();
    canvas.style.cursor = 'crosshair';

    const begin = () => {
      region()?.setData(EMPTY);
      callbacksRef.current.onDrawStart?.();
    };
    const finish = (ring: Ring) => {
      sketch()?.setData(EMPTY);
      region()?.setData(polygon(ring));
      setMode(null);
      callbacksRef.current.onPolygonCreated(regionFeature(ring));
    };
    const pixelDistance = (a: LngLat, b: LngLat) => {
      const p = map.project(a);
      const q = map.project(b);
      return Math.hypot(p.x - q.x, p.y - q.y);
    };

    let start: LngLat | null = null;
    let last: LngLat | null = null;
    const vertices: LngLat[] = [];
    const listeners: [string, (e: any) => void][] = [];
    const on = (type: string, fn: (e: any) => void) => {
      map.on(type as any, fn);
      listeners.push([type, fn]);
    };

    if (mode === 'box') {
      map.dragPan.disable();
      const down = (e: MapMouseEvent | MapTouchEvent) => {
        if ('points' in e && e.points.length > 1) return; // let two-finger gestures zoom
        start = last = e.lngLat;
        begin();
      };
      const move = (e: MapMouseEvent | MapTouchEvent) => {
        if (!start) return;
        last = e.lngLat;
        sketch()?.setData(polygon(boxRing(start, last)));
      };
      const up = () => {
        if (start && last && pixelDistance(start, last) > 4) finish(boxRing(start, last));
        else sketch()?.setData(EMPTY);
        start = last = null;
      };
      on('mousedown', down);
      on('touchstart', down);
      on('mousemove', move);
      on('touchmove', move);
      on('mouseup', up);
      on('touchend', up);
    } else {
      map.doubleClickZoom.disable();
      const preview = (cursor?: LngLat) => {
        const prev = vertices[vertices.length - 1];
        const withCursor = cursor && prev && pixelDistance(prev, cursor) > 3 ? [...vertices, cursor] : vertices;
        const pts = unwrap(withCursor.map(v => [v.lng, v.lat]));
        const features: any[] = pts.map(c => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } }));
        if (pts.length >= 3) features.push(polygon([...pts, pts[0]]));
        else if (pts.length === 2) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } });
        sketch()?.setData({ type: 'FeatureCollection', features });
      };
      const done = () => {
        if (vertices.length >= 3) finish(polygonRing(vertices.map(v => [v.lng, v.lat])));
      };
      const click = (e: MapMouseEvent) => {
        if (vertices.length === 0) begin();
        // Clicking near the first point closes the shape (handy on touch screens).
        if (vertices.length >= 3 && pixelDistance(vertices[0], e.lngLat) < 12) return done();
        const prev = vertices[vertices.length - 1];
        if (!prev || pixelDistance(prev, e.lngLat) > 3) vertices.push(e.lngLat);
        preview(e.lngLat);
      };
      const move = (e: MapMouseEvent) => {
        if (vertices.length) preview(e.lngLat);
      };
      const dblclick = (e: MapMouseEvent) => {
        e.preventDefault();
        done();
      };
      on('click', click);
      on('mousemove', move);
      on('dblclick', dblclick);
    }

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setMode(null);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      listeners.forEach(([type, fn]) => map.off(type as any, fn));
      sketch()?.setData(EMPTY);
      canvas.style.cursor = '';
      map.dragPan.enable({ maxSpeed: 0 });
      map.doubleClickZoom.enable();
    };
  }, [mode]);

  const button = (active: boolean) =>
    `w-9 h-9 flex items-center justify-center border-b border-white/10 last:border-b-0 transition-colors ${
      active ? 'bg-blue-600 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'
    }`;

  return (
    <div className="relative w-full h-full">
      {/* MapLibre sets position: relative on its container, so size it from a wrapper. */}
      <div className="absolute inset-0">
        <div ref={containerRef} className="h-full w-full" role="region" aria-label="Interactive globe" />
      </div>
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
        <div className="flex flex-col bg-black/70 backdrop-blur-md border border-white/10 rounded overflow-hidden">
          <button type="button" className={button(false)} onClick={() => mapRef.current?.zoomIn({ duration: 200 })} aria-label="Zoom in" title="Zoom in">
            <Plus className="w-4 h-4" />
          </button>
          <button type="button" className={button(false)} onClick={() => mapRef.current?.zoomOut({ duration: 200 })} aria-label="Zoom out" title="Zoom out">
            <Minus className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-col bg-black/70 backdrop-blur-md border border-white/10 rounded overflow-hidden">
          <button
            type="button"
            className={button(mode === 'polygon')}
            onClick={() => setMode(m => (m === 'polygon' ? null : 'polygon'))}
            aria-pressed={mode === 'polygon'}
            aria-label="Draw a polygon (click points, double-click to finish)"
            title="Draw a polygon (click points, double-click to finish)"
          >
            <Pentagon className="w-4 h-4" />
          </button>
          <button
            type="button"
            className={button(mode === 'box')}
            onClick={() => setMode(m => (m === 'box' ? null : 'box'))}
            aria-pressed={mode === 'box'}
            aria-label="Draw a rectangle (drag on the globe)"
            title="Draw a rectangle (drag on the globe)"
          >
            <Square className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
