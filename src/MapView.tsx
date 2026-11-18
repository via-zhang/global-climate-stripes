import { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import OlMap from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import GeoJSON from 'ol/format/GeoJSON';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import Graticule from 'ol/layer/Graticule';
import OSM from 'ol/source/OSM';
import VectorSource from 'ol/source/Vector';
import Draw, { createBox } from 'ol/interaction/Draw';
import { Attribution } from 'ol/control';
import { defaults as defaultInteractions } from 'ol/interaction/defaults';
import DragPan from 'ol/interaction/DragPan';
import { Fill, Stroke, Style } from 'ol/style';
import Projection from 'ol/proj/Projection';
import { addCoordinateTransforms, addProjection, fromLonLat as fromLonLat3857, toLonLat as toLonLat3857 } from 'ol/proj';
import { feature as topoFeature } from 'topojson-client';
import landTopology from 'world-atlas/land-110m.json';
import { Minus, Pentagon, Plus, Square } from 'lucide-react';
import { EXTENT, MAX_X, OUTLINE, clipToOutline, densify, forward, inverse } from './equalEarth';

// Equal Earth (EPSG:8857): an equal-area projection, so drawn regions keep their true relative size.
const EQUAL_EARTH = new Projection({ code: 'EPSG:8857', units: 'm', extent: EXTENT, worldExtent: [-180, -90, 180, 90] });
addProjection(EQUAL_EARTH);
addCoordinateTransforms('EPSG:4326', EQUAL_EARTH, forward, inverse);
// OpenStreetMap tiles are Web Mercator (EPSG:3857); OpenLayers reprojects them through these.
addCoordinateTransforms(
  'EPSG:3857',
  EQUAL_EARTH,
  c => forward(toLonLat3857(c)),
  c => fromLonLat3857(inverse(c)),
);

/**
 * Turn a shape drawn on the Equal Earth map into a lon/lat GeoJSON polygon, trimmed to the
 * part that lies on the globe. Returns the trimmed shape in map coordinates too, for display.
 */
function toRegion(drawn: Polygon) {
  const ring = clipToOutline(densify(drawn.getCoordinates()[0], MAX_X / 400));
  if (!ring) return null;
  const geoJSON = {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [ring.map(inverse)] },
  };
  return { geoJSON, display: new Polygon([ring]) };
}

type DrawMode = 'polygon' | 'box' | null;

const regionStyle = new Style({
  stroke: new Stroke({ color: '#60a5fa', width: 2 }),
  fill: new Fill({ color: 'rgba(96, 165, 250, 0.2)' }),
});

export default function MapView({
  onPolygonCreated,
  onDrawStart,
}: {
  onPolygonCreated: (geoJSON: any) => void;
  onDrawStart?: () => void;
}) {
  const targetRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OlMap | null>(null);
  const regionSource = useRef(new VectorSource());
  const callbacksRef = useRef({ onPolygonCreated, onDrawStart });
  const [mode, setMode] = useState<DrawMode>(null);

  useEffect(() => {
    callbacksRef.current = { onPolygonCreated, onDrawStart };
  }, [onPolygonCreated, onDrawStart]);

  // Build the map once.
  useEffect(() => {
    if (!targetRef.current) return;
    const land = new GeoJSON().readFeatures(topoFeature(landTopology as any, (landTopology as any).objects.land), {
      dataProjection: 'EPSG:4326',
      featureProjection: EQUAL_EARTH,
    });

    const map = new OlMap({
      target: targetRef.current,
      controls: [new Attribution({ collapsible: false })],
      // Drag panning without inertia, so the map stops exactly where the pointer is released.
      interactions: defaultInteractions({ altShiftDragRotate: false, pinchRotate: false, dragPan: false }).extend([
        new DragPan(),
      ]),
      layers: [
        // Ocean and land fills show at the poles (beyond OSM's ±85° tiles) and while tiles load.
        new VectorLayer({
          source: new VectorSource({ features: [new Feature(new Polygon([OUTLINE]))] }),
          style: new Style({ fill: new Fill({ color: '#1b3441' }) }),
        }),
        new VectorLayer({
          source: new VectorSource({ features: land }),
          style: new Style({ fill: new Fill({ color: '#27231f' }) }),
        }),
        // OpenStreetMap tiles are Web Mercator; OpenLayers reprojects them into Equal Earth.
        new TileLayer({ source: new OSM(), className: 'dark-tiles' }),
        // Reprojected tiles can spill past the globe's edge; cover everything outside it.
        new VectorLayer({
          className: 'ol-overlay-layer',
          source: new VectorSource({
            features: [
              new Feature(
                new Polygon([
                  [
                    [-3 * MAX_X, -3 * MAX_X],
                    [3 * MAX_X, -3 * MAX_X],
                    [3 * MAX_X, 3 * MAX_X],
                    [-3 * MAX_X, 3 * MAX_X],
                    [-3 * MAX_X, -3 * MAX_X],
                  ],
                  OUTLINE,
                ]),
              ),
            ],
          }),
          style: new Style({ fill: new Fill({ color: '#050505' }) }),
        }),
        new Graticule({
          className: 'ol-overlay-layer',
          strokeStyle: new Stroke({ color: 'rgba(255,255,255,0.08)', width: 1 }),
          showLabels: false,
          wrapX: false,
        }),
        new VectorLayer({
          className: 'ol-overlay-layer',
          source: new VectorSource({ features: [new Feature(new Polygon([OUTLINE]))] }),
          style: new Style({ stroke: new Stroke({ color: 'rgba(255,255,255,0.2)', width: 1 }) }),
        }),
        new VectorLayer({ className: 'ol-overlay-layer', source: regionSource.current, style: regionStyle }),
      ],
      view: new View({
        projection: EQUAL_EARTH,
        // Only the map centre is kept inside this area, and it is extended to the south so the
        // southern hemisphere can be panned up above the open stripes panel.
        extent: [EXTENT[0], EXTENT[1] - 1.2 * EXTENT[3], EXTENT[2], EXTENT[3]],
        constrainOnlyCenter: true,
        // No elastic "spring back" after panning or zooming past a limit.
        smoothExtentConstraint: false,
        smoothResolutionConstraint: false,
        maxZoom: 12,
      }),
    });

    const view = map.getView();
    view.fit(EXTENT, { padding: [24, 24, 24, 24] });
    view.setMinZoom(Math.max(0, (view.getZoom() ?? 1) - 0.25));
    mapRef.current = map;

    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, []);

  // Add a one-shot drawing tool while a mode is selected.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mode) return;

    const draw = new Draw({
      type: mode === 'box' ? 'Circle' : 'Polygon',
      geometryFunction: mode === 'box' ? createBox() : undefined,
      freehand: mode === 'box', // drag to draw a rectangle
      stopClick: true,
      style: regionStyle,
    });
    draw.on('drawstart', () => {
      regionSource.current.clear();
      callbacksRef.current.onDrawStart?.();
    });
    draw.on('drawend', e => {
      const region = toRegion(e.feature.getGeometry() as Polygon);
      setMode(null);
      if (!region) return;
      regionSource.current.addFeature(new Feature(region.display));
      callbacksRef.current.onPolygonCreated(region.geoJSON);
    });
    map.addInteraction(draw);

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setMode(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      map.removeInteraction(draw);
    };
  }, [mode]);

  const zoomBy = (delta: number) => {
    const view = mapRef.current?.getView();
    if (!view) return;
    view.animate({ zoom: (view.getZoom() ?? 1) + delta, duration: 200 });
  };

  const button = (active: boolean) =>
    `w-9 h-9 flex items-center justify-center border-b border-white/10 last:border-b-0 transition-colors ${
      active ? 'bg-blue-600 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'
    }`;

  return (
    <div className={`relative w-full h-full ${mode ? 'cursor-crosshair' : ''}`}>
      <div ref={targetRef} className="absolute inset-0" />
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
        <div className="flex flex-col bg-black/70 backdrop-blur-md border border-white/10 rounded overflow-hidden">
          <button type="button" className={button(false)} onClick={() => zoomBy(1)} aria-label="Zoom in" title="Zoom in">
            <Plus className="w-4 h-4" />
          </button>
          <button type="button" className={button(false)} onClick={() => zoomBy(-1)} aria-label="Zoom out" title="Zoom out">
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
            aria-label="Draw a rectangle (drag on the map)"
            title="Draw a rectangle (drag on the map)"
          >
            <Square className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
