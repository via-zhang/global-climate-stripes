import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import { Download, Info, Layers, Waves, X, ChevronUp, ChevronDown } from 'lucide-react';
import * as d3 from 'd3';
import { fetchStripeData } from './climate';

// Fix for leaflet-draw rectangle issue on modern browsers
// @ts-ignore
window.type = '';

// Leaflet draw control integration
function DrawControl({ onPolygonCreated, onDrawStart }: { onPolygonCreated: (geoJSON: any) => void, onDrawStart?: () => void }) {
  const map = useMap();
  
  const callbacksRef = useRef({ onPolygonCreated, onDrawStart });
  useEffect(() => {
    callbacksRef.current = { onPolygonCreated, onDrawStart };
  }, [onPolygonCreated, onDrawStart]);

  useEffect(() => {
    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    
    // @ts-ignore
    const drawControl = new L.Control.Draw({
      draw: {
        polyline: false,
        polygon: {
          allowIntersection: false,
          drawError: { color: '#e1e100', message: '<strong>Oh snap!<strong> you can\'t draw that!' },
          shapeOptions: { color: '#60a5fa', fillColor: '#60a5fa', fillOpacity: 0.2, weight: 2 }
        },
        rectangle: { shapeOptions: { color: '#60a5fa', fillColor: '#60a5fa', fillOpacity: 0.2, weight: 2 } },
        circle: false,
        marker: false,
        circlemarker: false,
      },
      edit: {
        featureGroup: drawnItems,
        edit: false,
        remove: false
      }
    });
    map.addControl(drawControl);

    const onDrawCreated = (e: any) => {
      drawnItems.clearLayers();
      
      // Also forcefully remove any other polygons/rectangles from the map to ensure no duplicates
      map.eachLayer((l: any) => {
        if (l instanceof L.Polygon || l instanceof L.Rectangle) {
          map.removeLayer(l);
        }
      });
      
      const layer = e.layer;
      drawnItems.addLayer(layer);
      callbacksRef.current.onPolygonCreated(layer.toGeoJSON());
    };

    map.on(L.Draw.Event.CREATED, onDrawCreated);

    const handleDrawStart = () => {
      if (callbacksRef.current.onDrawStart) callbacksRef.current.onDrawStart();
    };
    map.on(L.Draw.Event.DRAWSTART, handleDrawStart);

    return () => {
      map.removeControl(drawControl);
      map.off(L.Draw.Event.CREATED, onDrawCreated);
      map.off(L.Draw.Event.DRAWSTART, handleDrawStart);
      map.removeLayer(drawnItems);
    };
  }, [map]);

  return null;
}

interface YearlyData {
  year: number;
  temp: number | null;
  anomaly?: number | null;
}

function StripesVisualization({ data, annotated, title, unit }: { data: YearlyData[], annotated: boolean, title: string, unit: 'C' | 'F' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  
  // Calculate anomalies based on 1981-2010 baseline
  const { processedData, baselineTemp } = useMemo(() => {
    if (!data || data.length === 0) return { processedData: [], baselineTemp: 0 };
    
    const validData = data.filter(d => d.temp !== null && d.temp !== undefined) as {year: number, temp: number}[];
    if (validData.length === 0) return { processedData: [], baselineTemp: 0 };
    
    const baselinePeriod = validData.filter(d => d.year >= 1981 && d.year <= 2010);
    const temp = baselinePeriod.length > 0 
      ? baselinePeriod.reduce((sum, d) => sum + d.temp, 0) / baselinePeriod.length 
      : validData.reduce((sum, d) => sum + d.temp, 0) / validData.length; // fallback to overall avg if period missing

    return {
      baselineTemp: temp,
      processedData: data.map(d => ({
        ...d,
        anomaly: (d.temp === null || d.temp === undefined) ? null : d.temp - temp
      }))
    };
  }, [data]);

  // Color scale: -2.5C to +2.5C
  const maxAnomaly = 2.5;
  const minAnomaly = -2.5;
  const colorScale = d3.scaleSequential(d3.interpolateRdBu).domain([maxAnomaly, minAnomaly]);

  const displayBaseline = unit === 'C' ? `${baselineTemp.toFixed(1)}°C` : `${(baselineTemp * 9/5 + 32).toFixed(1)}°F`;
  const displayMin = unit === 'C' ? '-2.5°C' : '-4.5°F';
  const displayMax = unit === 'C' ? '+2.5°C' : '+4.5°F';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || processedData.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const barWidth = width / processedData.length;

    processedData.forEach((d, i) => {
      if (d.anomaly === null || d.anomaly === undefined) {
        ctx.fillStyle = '#050505'; // Match background for missing data
      } else {
        ctx.fillStyle = colorScale(d.anomaly);
      }
      const x1 = Math.round(i * barWidth);
      const x2 = Math.round((i + 1) * barWidth);
      ctx.fillRect(x1, 0, x2 - x1, height);
    });
  }, [processedData, colorScale]);

  const handleDownload = () => {
    if (!canvasRef.current || processedData.length === 0) return;
    
    // Create an offscreen canvas to optionally add annotations
    const offscreen = document.createElement('canvas');
    offscreen.width = 1200;
    offscreen.height = 600;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    const barWidth = offscreen.width / processedData.length;
    processedData.forEach((d, i) => {
      if (d.anomaly === null || d.anomaly === undefined) {
        ctx.fillStyle = '#050505'; // Match background for missing data
      } else {
        ctx.fillStyle = colorScale(d.anomaly);
      }
      const x1 = Math.round(i * barWidth);
      const x2 = Math.round((i + 1) * barWidth);
      ctx.fillRect(x1, 0, x2 - x1, offscreen.height);
    });

    if (annotated) {
      // Add text and simple legend background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, offscreen.height - 70, offscreen.width, 70);
      
      const centerY = offscreen.height - 35;

      ctx.fillStyle = 'white';
      ctx.font = 'bold 24px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(processedData[0].year.toString(), 30, centerY);
      
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(processedData[processedData.length - 1].year.toString(), offscreen.width - 30, centerY);

      // Draw colorbar
      const legendWidth = 400;
      const legendHeight = 12;
      const legendX = (offscreen.width - legendWidth) / 2;
      const legendY = centerY - (legendHeight / 2) - 8;
      
      const gradient = ctx.createLinearGradient(legendX, 0, legendX + legendWidth, 0);
      for (let i = 0; i <= 20; i++) {
        const val = minAnomaly + (maxAnomaly - minAnomaly) * (i / 20);
        gradient.addColorStop(i / 20, colorScale(val));
      }
      
      ctx.fillStyle = gradient;
      ctx.fillRect(legendX, legendY, legendWidth, legendHeight);
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(displayMin, legendX - 12, centerY - 8);
      ctx.textAlign = 'left';
      ctx.fillText(displayMax, legendX + legendWidth + 12, centerY - 8);

      ctx.textAlign = 'center';
      ctx.font = '12px Inter, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fillText(`Baseline (1981-2010): ${displayBaseline}`, offscreen.width / 2, centerY + 14);
    }

    const link = document.createElement('a');
    link.download = `climate-stripes-${title.toLowerCase().replace(' ', '-')}.png`;
    link.href = offscreen.toDataURL('image/png');
    link.click();
  };

  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || processedData.length === 0) return;
    
    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const xOnCanvas = e.clientX - canvasRect.left;
    
    const ratio = xOnCanvas / canvasRect.width;
    const index = Math.floor(ratio * processedData.length);
    
    if (index >= 0 && index < processedData.length) {
      setHoveredIndex(index);
      setMousePos({ 
        x: e.clientX - containerRect.left, 
        y: e.clientY - containerRect.top 
      });
    } else {
      setHoveredIndex(null);
    }
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
  };

  if (processedData.length === 0) return <div className="text-white/40 text-xs font-mono uppercase tracking-widest h-64 flex items-center justify-center border border-white/10 rounded">No data available</div>;

  return (
    <div ref={containerRef} className="relative flex flex-col w-full mx-auto max-w-4xl">
      <div className="relative group rounded overflow-hidden shadow-2xl border border-white/10">
        <canvas 
          ref={canvasRef} 
          width={800} 
          height={300} 
          className="w-full h-auto aspect-[8/3] block cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
        {annotated && (
          <div className="absolute bottom-0 w-full flex justify-between px-4 pb-2 text-white/90 font-mono text-[10px] uppercase tracking-widest mix-blend-difference pointer-events-none">
            <span>{processedData[0].year}</span>
            <span>{processedData[processedData.length - 1].year}</span>
          </div>
        )}
      </div>

      {hoveredIndex !== null && processedData[hoveredIndex] && (
        <div 
          className="absolute pointer-events-none z-50 bg-black/90 border border-white/20 p-3 rounded shadow-2xl backdrop-blur-sm transform -translate-x-1/2 -translate-y-full mt-[-10px]"
          style={{ left: mousePos.x, top: mousePos.y }}
        >
          <div className="text-white/50 text-[10px] uppercase tracking-widest font-mono mb-1">
            {processedData[hoveredIndex].year}
          </div>
          <div className="text-white font-medium">
            {processedData[hoveredIndex].temp === null || processedData[hoveredIndex].temp === undefined ? (
              'No data'
            ) : (
              `${unit === 'F' ? (processedData[hoveredIndex].temp * 9/5 + 32).toFixed(2) : processedData[hoveredIndex].temp.toFixed(2)}°${unit}`
            )}
          </div>
          {processedData[hoveredIndex].anomaly !== null && processedData[hoveredIndex].anomaly !== undefined && (
            <div className={`text-[10px] mt-1 ${processedData[hoveredIndex].anomaly! > 0 ? 'text-red-400' : 'text-blue-400'}`}>
              {processedData[hoveredIndex].anomaly! > 0 ? '+' : ''}
              {unit === 'F' ? (processedData[hoveredIndex].anomaly! * 9/5).toFixed(2) : processedData[hoveredIndex].anomaly!.toFixed(2)}°{unit} anomaly
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-6 gap-4">
        {annotated && (
          <div className="flex flex-col w-72">
            <div className="text-[9px] font-mono uppercase text-white/50 mb-2 flex justify-between tracking-widest">
              <span>{displayMin}</span>
              <span>Baseline: {displayBaseline}</span>
              <span>{displayMax}</span>
            </div>
            <div className="w-full h-1.5 bg-gradient-to-r from-blue-900 via-white to-red-900 rounded" />
          </div>
        )}
        
        <button 
          onClick={handleDownload}
          className="bg-white text-black px-6 py-2 rounded-sm text-xs font-bold uppercase tracking-widest hover:bg-white/90 transition-colors ml-auto flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Download
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<{ land: YearlyData[] | null, sea: YearlyData[] | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [annotated, setAnnotated] = useState(true);
  const [activeTab, setActiveTab] = useState<'land' | 'sea'>('land');
  const [error, setError] = useState<string | null>(null);
  const [unit, setUnit] = useState<'C' | 'F'>('F');
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [showTooltip, setShowTooltip] = useState(true);

  const handlePolygonCreated = useCallback(async (geoJSON: any) => {
    setLoading(true);
    setError(null);
    setData(null);
    setIsPanelOpen(true); // Open the panel when loading starts
    try {
      const result = await fetchStripeData(geoJSON);
      setData(result);
      if (result.land && result.land.length > 0) setActiveTab('land');
      else if (result.sea && result.sea.length > 0) setActiveTab('sea');
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="flex flex-col h-screen w-full bg-[#050505] text-[#E0E0E0] font-sans overflow-hidden relative">
      {/* Header overlay */}
      <header className="absolute top-0 right-0 z-[500] p-3 lg:p-4 pointer-events-none flex justify-end max-w-[calc(100vw-55px)] sm:max-w-[320px] lg:max-w-none">
        <div className="flex items-center gap-3 lg:gap-4 bg-black/60 backdrop-blur-md p-3 lg:p-4 rounded-lg border border-white/10 pointer-events-auto shadow-2xl">
          <img src="logo.svg" alt="Logo" className="w-8 h-8 lg:w-10 lg:h-10 rounded-sm shadow-lg shadow-blue-900/20 flex-shrink-0 object-cover" />
          <div>
            <h1 className="text-[14px] sm:text-[14px] md:text-[14px] lg:text-lg font-light tracking-widest text-white uppercase whitespace-normal lg:whitespace-nowrap">
              Global{' '}
              <span 
                className="font-bold whitespace-nowrap"
                style={{ 
                  backgroundImage: 'linear-gradient(to right, #2166ac, #4393c3, #f7f7f7, #d6604d, #b2182b)', 
                  WebkitBackgroundClip: 'text', 
                  WebkitTextFillColor: 'transparent' 
                }}
              >
                Climate Stripes
              </span>
            </h1>
            <p className="text-[8px] lg:text-[9px] uppercase tracking-[0.1em] text-white/40 flex flex-wrap lg:flex-nowrap items-center gap-2 mt-1 leading-relaxed">
              <span className="whitespace-normal lg:whitespace-nowrap">Visualize temperature change around the world</span>
              <button 
                onClick={() => setShowTooltip(true)} 
                className="hover:text-white transition-colors flex-shrink-0 inline-flex items-center"
                title="Show Instructions"
              >
                <Info className="w-3 h-3" />
              </button>
            </p>
          </div>
        </div>
      </header>

      {/* Map (Fullscreen) */}
      <main className="absolute inset-0 z-0 bg-[#111111] select-none">
        <MapContainer 
          center={[20, 0]} 
          zoom={3} 
          minZoom={2}
          className="w-full h-full"
          zoomControl={true}
          maxBounds={[[-90, -180], [90, 180]]}
          maxBoundsViscosity={1.0}
        >
          <TileLayer
            attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            noWrap={true}
            bounds={[[-90, -180], [90, 180]]}
          />
          <DrawControl onPolygonCreated={handlePolygonCreated} onDrawStart={() => setShowTooltip(false)} />
        </MapContainer>
        
        {showTooltip && (
          <div className="absolute top-[120px] lg:top-[80px] left-14 md:left-16 z-[400] bg-black/80 backdrop-blur-md border border-white/10 px-4 py-3 rounded shadow-xl max-w-[220px] md:max-w-[260px] flex flex-col pointer-events-auto animate-in fade-in slide-in-from-left-4">
            <div className="absolute -left-[5px] top-4 lg:top-4 w-3 h-3 bg-black/80 border-t-0 border-l border-b border-white/10 transform rotate-45 hidden lg:block"></div>
            <div className="flex justify-between items-start mb-1 relative z-10 gap-4">
              <h3 className="text-[12px] font-bold text-white/70 uppercase tracking-widest">Select an Area</h3>
              <button onClick={() => setShowTooltip(false)} className="text-white/40 hover:text-white transition-colors flex-shrink-0">
                <X className="w-3 h-3" />
              </button>
            </div>
            <p className="text-[12px] text-white/50 leading-relaxed relative z-10">Use the drawing tools (polygon or rectangle) to select a region on the map. The generated climate stripe will show averaged temperatures within the area you selected.</p>
          </div>
        )}
      </main>

      {/* Collapsible Bottom Panel */}
      <div className={`absolute bottom-0 left-0 right-0 z-[500] transition-transform duration-500 ease-in-out ${isPanelOpen ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="bg-black/90 backdrop-blur-xl border-t border-white/10 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] relative">
          {/* Toggle Button */}
          <div className="flex justify-center -top-10 absolute left-0 right-0 pointer-events-none">
            <button 
              onClick={() => setIsPanelOpen(!isPanelOpen)} 
              className="bg-black/90 border border-white/10 text-white/50 hover:text-white px-6 py-2 rounded-t-lg pointer-events-auto uppercase tracking-widest text-[10px] font-bold shadow-xl transition-colors flex items-center gap-2 h-10"
            >
              {isPanelOpen ? (
                <><ChevronDown className="w-3 h-3" /> Hide Stripes</>
              ) : (
                <><ChevronUp className="w-3 h-3" /> Show Stripes</>
              )}
            </button>
          </div>
          
          <div className="p-6 lg:px-12 w-full max-w-6xl mx-auto min-h-[40vh] max-h-[70vh] overflow-y-auto">
            {loading ? (
              <div className="flex-1 flex flex-col items-center justify-center opacity-70 h-64">
                <div className="w-10 h-10 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-4" />
                <p className="text-[10px] text-white/50 uppercase tracking-widest font-mono">Processing temperature data...</p>
              </div>
            ) : error ? (
              <div className="flex-1 flex items-center justify-center h-64">
                <div className="bg-red-900/20 text-red-400 px-4 py-3 rounded border border-red-900/50 text-[10px] font-mono uppercase tracking-widest">
                  {error}
                </div>
              </div>
            ) : !data ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center opacity-50 max-w-md mx-auto h-64 px-4">
                <Info className="w-8 h-8 mb-4 text-white/30" />
                <p className="text-xs font-bold text-white/50 uppercase tracking-widest leading-relaxed">Draw a rectangle or polygon on the map, and the app will compute historical annual mean temperatures.</p>
              </div>
            ) : (
              <div className="flex flex-col w-full">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4 border-b border-white/10 pb-4">
                  <div className="flex gap-2">
                    {data.land && data.land.length > 0 && (
                      <button 
                        onClick={() => setActiveTab('land')}
                        className={`px-6 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors flex items-center gap-2 ${activeTab === 'land' ? 'border-b-2 border-blue-500 bg-white/5 text-white' : 'text-white/30 hover:text-white/50'}`}
                      >
                        <Layers className="w-4 h-4" />
                        Land
                      </button>
                    )}
                    {data.sea && data.sea.length > 0 && (
                      <button 
                        onClick={() => setActiveTab('sea')}
                        className={`px-6 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors flex items-center gap-2 ${activeTab === 'sea' ? 'border-b-2 border-blue-500 bg-white/5 text-white' : 'text-white/30 hover:text-white/50'}`}
                      >
                        <Waves className="w-4 h-4" />
                        Sea
                      </button>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-6">
                    {/* Info Icon */}
                    <div className="relative group flex items-center">
                      <a href="https://power.larc.nasa.gov/" target="_blank" rel="noopener noreferrer" className="text-white/40 hover:text-white transition-colors">
                        <Info className="w-4 h-4" />
                      </a>
                      <div className="absolute right-full top-1/2 -translate-y-1/2 mr-3 w-56 p-2 bg-black/90 border border-white/10 rounded text-[9px] uppercase tracking-widest text-white/70 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-left">
                        Temperature data provided by NASA POWER
                      </div>
                    </div>
                    
                    {/* Unit Toggle */}
                    <div className="flex items-center bg-white/5 rounded-full p-1 border border-white/10">
                      <button 
                        onClick={() => setUnit('C')}
                        className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${unit === 'C' ? 'bg-white text-black' : 'text-white/50 hover:text-white/80'}`}
                      >
                        °C
                      </button>
                      <button 
                        onClick={() => setUnit('F')}
                        className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${unit === 'F' ? 'bg-white text-black' : 'text-white/50 hover:text-white/80'}`}
                      >
                        °F
                      </button>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer text-[10px] font-bold text-white/70 uppercase tracking-widest hover:text-white transition-colors">
                      <span className="mr-2">Annotated View</span>
                      <div className="relative">
                        <input type="checkbox" className="sr-only" checked={annotated} onChange={e => setAnnotated(e.target.checked)} />
                        <div className={`block w-10 h-5 rounded-full transition-colors ${annotated ? 'bg-blue-600' : 'bg-white/10'}`}></div>
                        <div className={`absolute left-1 top-1 w-3 h-3 rounded-full transition-transform ${annotated ? 'bg-white transform translate-x-5' : 'bg-white/30'}`}></div>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="flex-1 flex flex-col items-center">
                  {activeTab === 'land' && data.land ? (
                    <StripesVisualization data={data.land} annotated={annotated} title="Land" unit={unit} />
                  ) : activeTab === 'sea' && data.sea ? (
                    <StripesVisualization data={data.sea} annotated={annotated} title="Sea" unit={unit} />
                  ) : (
                    <div className="text-gray-500">No data available for this surface type in the selected region.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
