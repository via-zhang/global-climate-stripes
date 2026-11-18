import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Download, Info, Layers, Waves, X, ChevronUp, ChevronDown } from 'lucide-react';
import { scaleSequential } from 'd3-scale';
import { interpolateRdBu } from 'd3-scale-chromatic';
import { fetchStripeData, type StripeResult, type YearlyData } from './climate';
import MapView from './MapView';

// Color scale: -2.5°C (blue) to +2.5°C (red)
const MAX_ANOMALY = 2.5;
const colorScale = scaleSequential(interpolateRdBu).domain([MAX_ANOMALY, -MAX_ANOMALY]);
const LEGEND_GRADIENT = `linear-gradient(to right, ${Array.from({ length: 11 }, (_, i) => i)
  .map(i => colorScale(-MAX_ANOMALY + (2 * MAX_ANOMALY * i) / 10))
  .join(', ')})`;
const BASELINE: [number, number] = [1981, 2010];
// Stripes are 16:5. Cap their width by the panel's height (70vh minus ~300px of controls and
// text) so the whole panel fits on screen without scrolling.
const STRIPES_MAX_WIDTH = 'max(18rem, min(56rem, calc((70vh - 300px) * 3.2)))';
const CREDIT = 'Data: Berkeley Earth (berkeleyearth.org), CC BY-NC 4.0';
const MISSING_HATCH =
  'repeating-linear-gradient(135deg, #0b0b0b 0 4px, rgba(255,255,255,0.18) 4px 5px)';

/** Diagonal hatching for years without enough data. */
function missingPattern(ctx: CanvasRenderingContext2D, scale: number): CanvasPattern | string {
  const size = Math.max(6, Math.round(8 * scale));
  const tile = document.createElement('canvas');
  tile.width = tile.height = size;
  const t = tile.getContext('2d');
  if (!t) return '#0b0b0b';
  t.fillStyle = '#0b0b0b';
  t.fillRect(0, 0, size, size);
  t.strokeStyle = 'rgba(255,255,255,0.18)';
  t.lineWidth = Math.max(1, scale);
  t.beginPath();
  t.moveTo(0, size);
  t.lineTo(size, 0);
  t.stroke();
  return ctx.createPattern(tile, 'repeat') ?? '#0b0b0b';
}

function drawStripes(
  ctx: CanvasRenderingContext2D,
  data: YearlyData[],
  width: number,
  height: number,
  scale: number,
  top = 0,
) {
  ctx.clearRect(0, top, width, height);
  const hatch = missingPattern(ctx, scale);
  const barWidth = width / data.length;
  data.forEach((d, i) => {
    ctx.fillStyle = d.anomaly === null || d.anomaly === undefined ? hatch : colorScale(d.anomaly);
    const x1 = Math.round(i * barWidth);
    const x2 = Math.round((i + 1) * barWidth);
    ctx.fillRect(x1, top, x2 - x1, height);
  });
}

function StripesVisualization({ data, annotated, title, unit }: { data: YearlyData[], annotated: boolean, title: string, unit: 'C' | 'F' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  // Canvas backing-store size in device pixels, so stripes stay sharp on high-DPI screens.
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 300 });

  // Calculate anomalies relative to the baseline period
  const { processedData, baselineTemp, hasMissing } = useMemo(() => {
    const empty = { processedData: [] as YearlyData[], baselineTemp: 0, hasMissing: false };
    if (!data || data.length === 0) return empty;

    const validData = data.filter(d => d.temp !== null && d.temp !== undefined) as {year: number, temp: number}[];
    if (validData.length === 0) return empty;

    const baselinePeriod = validData.filter(d => d.year >= BASELINE[0] && d.year <= BASELINE[1]);
    const temp = baselinePeriod.length > 0
      ? baselinePeriod.reduce((sum, d) => sum + d.temp, 0) / baselinePeriod.length
      : validData.reduce((sum, d) => sum + d.temp, 0) / validData.length; // fallback to overall avg if period missing

    return {
      baselineTemp: temp,
      hasMissing: validData.length < data.length,
      processedData: data.map(d => ({
        ...d,
        anomaly: (d.temp === null || d.temp === undefined) ? null : d.temp - temp
      }))
    };
  }, [data]);

  const hasData = processedData.length > 0;
  const displayBaseline = unit === 'C' ? `${baselineTemp.toFixed(1)}°C` : `${(baselineTemp * 9/5 + 32).toFixed(1)}°F`;
  const displayMin = unit === 'C' ? `-${MAX_ANOMALY}°C` : `-${(MAX_ANOMALY * 9 / 5).toFixed(1)}°F`;
  const displayMax = unit === 'C' ? `+${MAX_ANOMALY}°C` : `+${(MAX_ANOMALY * 9 / 5).toFixed(1)}°F`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(entry.contentRect.width * dpr));
      setCanvasSize({ w, h: Math.round((w * 5) / 16) });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [hasData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasData) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawStripes(ctx, processedData, canvas.width, canvas.height, window.devicePixelRatio || 1);
  }, [processedData, hasData, canvasSize]);

  const handleDownload = () => {
    if (!hasData) return;

    // Annotated exports put the years above the stripes and the legend below,
    // so no text is drawn on top of the colors.
    const width = 1200;
    const stripesHeight = 600;
    const header = annotated ? 56 : 0;
    const footer = annotated ? 96 : 0;
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = header + stripesHeight + footer;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    if (annotated) {
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, offscreen.width, offscreen.height);
    }
    drawStripes(ctx, processedData, width, stripesHeight, 1, header);

    if (annotated) {
      ctx.fillStyle = 'white';
      ctx.font = 'bold 24px Inter, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(processedData[0].year.toString(), 0, header / 2);
      ctx.textAlign = 'right';
      ctx.fillText(processedData[processedData.length - 1].year.toString(), width, header / 2);

      const centerY = header + stripesHeight + 40;

      // Draw colorbar
      const legendWidth = 400;
      const legendHeight = 12;
      const legendX = (offscreen.width - legendWidth) / 2;
      const legendY = centerY - (legendHeight / 2) - 8;

      const gradient = ctx.createLinearGradient(legendX, 0, legendX + legendWidth, 0);
      for (let i = 0; i <= 20; i++) {
        const val = -MAX_ANOMALY + 2 * MAX_ANOMALY * (i / 20);
        gradient.addColorStop(i / 20, colorScale(val));
      }

      ctx.fillStyle = gradient;
      ctx.fillRect(legendX, legendY, legendWidth, legendHeight);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(displayMin, legendX - 12, centerY - 8);
      ctx.textAlign = 'left';
      ctx.fillText(displayMax, legendX + legendWidth + 12, centerY - 8);

      ctx.textAlign = 'center';
      ctx.font = '12px Inter, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillText(`Baseline (${BASELINE[0]}-${BASELINE[1]}): ${displayBaseline}`, offscreen.width / 2, centerY + 14);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText(CREDIT, offscreen.width / 2, offscreen.height - 12);
    } else {
      // Attribution is required by the CC BY-NC license, so keep a small credit.
      ctx.font = '11px Inter, sans-serif';
      const pad = 6;
      const textWidth = ctx.measureText(CREDIT).width;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(offscreen.width - textWidth - pad * 3, offscreen.height - 24, textWidth + pad * 3, 24);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(CREDIT, offscreen.width - pad * 1.5, offscreen.height - 12);
    }

    const link = document.createElement('a');
    link.download = `climate-stripes-${title.toLowerCase().replace(/\s+/g, '-')}.png`;
    link.href = offscreen.toDataURL('image/png');
    link.click();
  };

  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !hasData) return;

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

  if (!hasData) return <div className="text-white/40 text-xs font-mono uppercase tracking-widest h-64 flex items-center justify-center border border-white/10 rounded">No data available</div>;

  const hovered = hoveredIndex !== null ? processedData[hoveredIndex] : null;

  return (
    <div ref={containerRef} className="relative flex flex-col w-full mx-auto" style={{ maxWidth: STRIPES_MAX_WIDTH }}>
      {annotated && (
        <div className="flex justify-between mb-2 text-white/80 font-mono text-[11px] uppercase tracking-widest" aria-hidden="true">
          <span>{processedData[0].year}</span>
          <span>{processedData[processedData.length - 1].year}</span>
        </div>
      )}
      <div className="relative group rounded overflow-hidden shadow-2xl border border-white/10">
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          className="w-full h-auto aspect-[16/5] block cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
      </div>

      {hovered && (
        <div
          className="absolute pointer-events-none z-50 bg-black/90 border border-white/20 p-3 rounded shadow-2xl backdrop-blur-sm transform -translate-x-1/2 -translate-y-full mt-[-10px]"
          style={{ left: mousePos.x, top: mousePos.y }}
        >
          <div className="text-white/50 text-[10px] uppercase tracking-widest font-mono mb-1">
            {hovered.year}
          </div>
          <div className="text-white font-medium">
            {hovered.temp === null || hovered.temp === undefined ? (
              'Not enough data'
            ) : (
              `${unit === 'F' ? (hovered.temp * 9/5 + 32).toFixed(2) : hovered.temp.toFixed(2)}°${unit}`
            )}
          </div>
          {hovered.anomaly !== null && hovered.anomaly !== undefined && (
            <div className={`text-[10px] mt-1 ${hovered.anomaly > 0 ? 'text-red-400' : 'text-blue-400'}`}>
              {hovered.anomaly > 0 ? '+' : ''}
              {unit === 'F' ? (hovered.anomaly * 9/5).toFixed(2) : hovered.anomaly.toFixed(2)}°{unit} vs {BASELINE[0]}–{BASELINE[1]}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-4 gap-4">
        {annotated && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col w-72">
              <div className="text-[9px] font-mono uppercase text-white/50 mb-2 flex justify-between tracking-widest">
                <span>{displayMin}</span>
                <span>Baseline {BASELINE[0]}–{BASELINE[1]}: {displayBaseline}</span>
                <span>{displayMax}</span>
              </div>
              <div className="w-full h-1.5 rounded" style={{ backgroundImage: LEGEND_GRADIENT }} />
            </div>
            {hasMissing && (
              <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-widest text-white/50">
                <span className="inline-block w-4 h-3 rounded-sm border border-white/10" style={{ backgroundImage: MISSING_HATCH }} />
                Not enough data
              </div>
            )}
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
  const [data, setData] = useState<StripeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [annotated, setAnnotated] = useState(true);
  const [activeTab, setActiveTab] = useState<'land' | 'sea'>('land');
  const [error, setError] = useState<string | null>(null);
  const [unit, setUnit] = useState<'C' | 'F'>('F');
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [showTooltip, setShowTooltip] = useState(true);
  const hideTooltip = useCallback(() => setShowTooltip(false), []);

  // Only the most recent selection may update the panel; older requests are cancelled.
  const requestRef = useRef<AbortController | null>(null);

  const handlePolygonCreated = useCallback(async (geoJSON: any) => {
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;

    setLoading(true);
    setError(null);
    setData(null);
    setIsPanelOpen(true); // Open the panel when loading starts
    try {
      const result = await fetchStripeData(geoJSON, request.signal);
      if (request.signal.aborted) return;
      setData(result);
      if (result.land) setActiveTab('land');
      else if (result.sea) setActiveTab('sea');
    } catch (err: any) {
      if (request.signal.aborted) return;
      setError(err?.message || 'An error occurred');
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, []);

  const activeSeries = data ? (activeTab === 'land' ? data.land : data.sea) : null;

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
      <main className="absolute inset-0 z-0 bg-[#050505] select-none">
        <MapView onPolygonCreated={handlePolygonCreated} onDrawStart={hideTooltip} />
        
        {showTooltip && (
          <div className="absolute top-[94px] left-[60px] z-[400] bg-black/80 backdrop-blur-md border border-white/10 px-4 py-3 rounded shadow-xl max-w-[220px] md:max-w-[260px] flex flex-col pointer-events-auto animate-in fade-in slide-in-from-left-4">
            <div className="absolute -left-[5px] top-4 w-3 h-3 bg-black/80 border-t-0 border-l border-b border-white/10 transform rotate-45"></div>
            <div className="flex justify-between items-start mb-1 relative z-10 gap-4">
              <h3 className="text-[12px] font-bold text-white/70 uppercase tracking-widest">Select an Area</h3>
              <button onClick={() => setShowTooltip(false)} className="text-white/40 hover:text-white transition-colors flex-shrink-0">
                <X className="w-3 h-3" />
              </button>
            </div>
            <p className="text-[12px] text-white/50 leading-relaxed relative z-10">Use the drawing tools to select a region: drag to draw a rectangle, or click points and double-click to finish a polygon. The map uses the Equal Earth projection, so areas are shown at their true relative size.</p>
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
          
          <div className="no-scrollbar px-6 py-5 lg:px-12 w-full max-w-6xl mx-auto min-h-[40vh] max-h-[70vh] overflow-y-auto">
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
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-5 gap-4 border-b border-white/10 pb-3">
                  <div className="flex gap-2">
                    {data.land && (
                      <button 
                        onClick={() => setActiveTab('land')}
                        className={`px-6 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors flex items-center gap-2 ${activeTab === 'land' ? 'border-b-2 border-blue-500 bg-white/5 text-white' : 'text-white/30 hover:text-white/50'}`}
                      >
                        <Layers className="w-4 h-4" />
                        Land
                      </button>
                    )}
                    {data.sea && (
                      <button 
                        onClick={() => setActiveTab('sea')}
                        className={`px-6 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors flex items-center gap-2 ${activeTab === 'sea' ? 'border-b-2 border-blue-500 bg-white/5 text-white' : 'text-white/30 hover:text-white/50'}`}
                      >
                        <Waves className="w-4 h-4" />
                        Ocean
                      </button>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-6">
                    {/* Info Icon */}
                    <div className="relative group flex items-center">
                      <a href="https://berkeleyearth.org/data/" target="_blank" rel="noopener noreferrer" className="text-white/40 hover:text-white transition-colors" aria-label="About the data: Berkeley Earth">
                        <Info className="w-4 h-4" />
                      </a>
                      <div className="absolute right-full top-1/2 -translate-y-1/2 mr-3 w-56 p-2 bg-black/90 border border-white/10 rounded text-[9px] uppercase tracking-widest text-white/70 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-left">
                        Temperature data from Berkeley Earth high-resolution (0.25°) Land + Ocean grid
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
                  {activeSeries ? (
                    <>
                      <StripesVisualization
                        data={activeSeries.data}
                        annotated={annotated}
                        title={activeTab === 'land' ? 'Land' : 'Ocean'}
                        unit={unit}
                      />
                      <p className="w-full max-w-4xl mt-3 text-[11px] text-white/50 leading-relaxed">
                        {activeSeries.cellCount} grid cell{activeSeries.cellCount === 1 ? '' : 's'} ({data.resolution}°) · {Math.round(activeSeries.areaShare * 100)}% of the selected area
                        {activeTab === 'sea' && ' · Open-ocean values are based on sea-surface temperature'}
                      </p>
                    </>
                  ) : (
                    <div className="text-gray-500">No data available for this surface type in the selected region.</div>
                  )}
                </div>

                <p className="w-full max-w-4xl mx-auto mt-4 pt-3 border-t border-white/10 text-[11px] text-white/50 leading-relaxed">
                  Temperature data:{' '}
                  <a href="https://berkeleyearth.org" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">Berkeley Earth</a>
                  , licensed under{' '}
                  <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">CC BY-NC 4.0</a>
                  . Berkeley Earth High-Resolution (beta) monthly 0.25° Land + Ocean data, averaged to annual means for {data.startYear}–{data.endYear}
                  {data.resolution > 0.25 && `; large selections use a ${data.resolution}° aggregate`}.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
