# Global Climate Stripes

An interactive web app that visualizes historical temperature change for any region you draw on a world map.

## Overview

Draw a polygon or rectangle on the map, and the app builds "climate stripes" for that region from **1850 to 2025**. Each stripe is one year, colored from blue (cooler) to red (warmer) relative to a 1981–2010 baseline. Results are split into **Land** and **Ocean** so you can compare the two surfaces in the same selection.

You can switch between Celsius and Fahrenheit and download the stripes as a PNG, with or without annotations.

## The map

The map uses the **Equal Earth** projection (EPSG:8857), an equal-area world projection, so a region's size on screen matches its true size relative to the rest of the globe. OpenStreetMap tiles are reprojected into it on the fly, and Natural Earth land shapes (via `world-atlas`) fill in the poles beyond the tiles' ±85° limit. A shape you draw is trimmed to the edge of the map and converted back to longitude and latitude, with its edges subdivided so the region matches what you drew.

## How the data is processed

1. **Pre-built tiles.** [`scripts/build_tiles.py`](scripts/build_tiles.py) turns Berkeley Earth's monthly 0.25° high-resolution data into annual means and splits them into small tiles, plus a 1° version for large areas. The tiles are hosted as static files outside this repository. The app is fully static: there is no backend and no live API call.
2. **Grid cells.** When you draw a shape, the app finds every grid cell whose centre is inside it (or, for very small shapes, the cell under its centre) and loads only the tiles those cells are in. Regions up to roughly 20°–25° across use 0.25° cells; larger ones use 1° cells so loading stays fast.
3. **Land and ocean weighting.** Each cell has a land fraction from Berkeley Earth. Cells are weighted by area (cosine of latitude) and by their land or ocean share, so a coastal cell counts partly toward each.
4. **Averaging.** Annual anomalies are averaged across cells, then the region's 1951–1980 mean temperature is added back to give absolute temperatures. A year is left blank (hatched) if less than half the area has data, which mostly affects the 1800s.
5. **Visualization.** Each year's temperature is compared to the 1981–2010 average and colored on a red–blue scale with D3.

Open-ocean values in Berkeley Earth come from sea-surface temperature; land values are air temperature.

## Data and license

Temperature data: **[Berkeley Earth](https://www.berkeleyearth.org)** High-Resolution (BEST-HR, beta), licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) for non-commercial use. The tiles are a modified (annually averaged, rounded) version of that data.

Rohde, R. A., Calvert, B., and Hausfather, Z.: Berkeley Earth Surface Temperature – High-Resolution (BEST-HR): a 0.25° Global Gridded Temperature Data Set for Climate Monitoring, Earth Syst. Sci. Data Discuss. [preprint], https://doi.org/10.5194/essd-2026-412, in review, 2026.

See [DATA_NOTICE.md](DATA_NOTICE.md) for the exact source file, the changes made, and how to rebuild the tiles.

## Running locally

1. Build the tiles into `working/tiles/` (see [DATA_NOTICE.md](DATA_NOTICE.md)). `npm run dev` serves them from there.
2. For `npm run build` or `npm run deploy`, copy `.env.example` to `.env.production.local` and set `VITE_DATA_URL` to the public folder that holds the tiles.

## Tech stack

- **Frontend:** React (Vite), TypeScript, Tailwind CSS
- **Mapping:** OpenLayers, Equal Earth projection, OpenStreetMap tiles, Natural Earth land (world-atlas)
- **Visualization:** HTML5 Canvas, d3-scale
- **Geospatial:** Turf.js
- **Data pipeline:** Python, NumPy, netCDF4
