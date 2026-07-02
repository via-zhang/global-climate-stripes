import * as turf from '@turf/turf';

let landGeoJSON: any = null;

export const fetchStripeData = async (polygon: any) => {
  if (!landGeoJSON) {
    try {
      const res = await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson');
      landGeoJSON = await res.json();
    } catch (e) {
      console.error("Failed to load land geojson", e);
    }
  }

  // Generate point grid in the bounding box
  const bbox = turf.bbox(polygon);
  const width = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]]);
  const height = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]]);
  const area = width * height;
  
  // Target around 100 points
  let cellSide = Math.sqrt(area / 100);
  if (cellSide === 0 || isNaN(cellSide)) cellSide = 1;

  let grid = turf.pointGrid(bbox, cellSide, { mask: polygon, units: 'kilometers' });
  
  // Fallback to centroid if polygon is too small
  if (grid.features.length === 0) {
    grid = turf.featureCollection([turf.centroid(polygon)]);
  }

  const landPoints = [];
  const seaPoints = [];

  for (const pt of grid.features) {
    let inLand = false;
    if (landGeoJSON) {
      for (const land of landGeoJSON.features) {
        if (turf.booleanPointInPolygon(pt, land)) {
          inLand = true;
          break;
        }
      }
    }
    if (inLand) landPoints.push(pt);
    else seaPoints.push(pt);
  }

  const fetchClimateData = async (points: any[]) => {
    if (points.length === 0) return null;
    const center = turf.centroid(turf.featureCollection(points));
    const [lng, lat] = center.geometry.coordinates;

    // Use NASA POWER API
    const url = `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M&community=RE&longitude=${lng}&latitude=${lat}&start=1981&end=2023&format=JSON`;
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      const timeseries = data.properties.parameter.T2M;
      if (!timeseries) return null;

      const yearlyData: Record<string, { sum: number, count: number }> = {};
      
      for (const [timeStr, temp] of Object.entries(timeseries)) {
        // timeStr is YYYYMM
        const year = timeStr.substring(0, 4);
        // Ignore annual average markers like "202113" (NASA POWER uses month 13 for annual average)
        if (timeStr.length !== 6 || timeStr.endsWith('13')) continue;
        
        // NASA POWER uses -999.0 for missing data
        if (temp === -999.0 || temp === null) continue;

        if (!yearlyData[year]) yearlyData[year] = { sum: 0, count: 0 };
        yearlyData[year].sum += temp as number;
        yearlyData[year].count++;
      }

      const result = [];
      for (let year = 1981; year <= 2023; year++) {
        const yStr = year.toString();
        if (yearlyData[yStr] && yearlyData[yStr].count > 0) {
          result.push({
            year,
            temp: yearlyData[yStr].sum / yearlyData[yStr].count
          });
        } else {
          result.push({
            year,
            temp: null
          });
        }
      }
      return result;
    } catch (err) {
      console.error("NASA POWER API Error:", (err as any).message || err);
      return null;
    }
  };

  const [landData, seaData] = await Promise.all([
    fetchClimateData(landPoints),
    fetchClimateData(seaPoints)
  ]);

  return { land: landData, sea: seaData };
};
