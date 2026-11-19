import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {setWorkerUrl} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import App from './App.tsx';
import './index.css';

// MapLibre locates its worker relative to its own file at runtime, which Vite can't follow.
// Point it at the copy Vite emits, so the worker is same-origin (and allowed by the CSP).
setWorkerUrl(maplibreWorkerUrl);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
