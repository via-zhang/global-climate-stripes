# Global Climate Stripes

An interactive web application that visualizes historical temperature changes (climate stripes) for any user-selected geographic region across the globe.

## Overview

Global Climate Stripes allows users to draw a polygon or rectangle on an interactive map to define a region of interest. The application then processes the region and generates a "Climate Stripes" visualization (from 1981 to 2023), which intuitively displays long-term temperature anomalies using a color scale from blue (cooler) to red (warmer). The data is separated into "Land" and "Sea" so you can independently observe temperature changes over different surface types within the same selection.

Users can toggle between Celsius and Fahrenheit and download an annotated version of the stripes for presentation or sharing.

## How Data is Processed

When you draw a shape on the map, the following geospatial processing occurs:

1. **Bounding Box & Grid Generation**: The application calculates the geographic bounding box of your drawn polygon. Using Turf.js, it generates a uniform grid of sample points (targeting ~100 points depending on area size) that fall precisely within the boundaries of your drawn shape.
2. **Land/Sea Classification**: Each sample point is cross-referenced against a Natural Earth land polygon dataset (`ne_110m_land.geojson`). This accurately classifies every point as either a "Land" surface or a "Sea" surface.
3. **Data Fetching**: The server fetches historical mean daily temperatures (aggregated to yearly averages) from 1981 to 2023 for each valid sample point.
   - **Source**: NASA POWER API.
4. **Aggregation**: The yearly temperatures for all points classified as Land are averaged together, and the same is done for Sea points. This produces a single, cohesive timeline of temperature anomalies tailored strictly to the custom area you drew.
5. **Visualization**: The resulting yearly averages are compared to a baseline period (1981–2010), and the anomalies are mapped to a divergent red-blue color scale using D3.js.

## Tech Stack

- **Frontend**: React (with Vite), TypeScript, Tailwind CSS
- **Mapping**: React-Leaflet, Leaflet, Leaflet-Draw
- **Data Visualization**: HTML5 Canvas, D3.js
- **Backend**: Node.js, Express.js
- **Geospatial Analysis**: Turf.js
- **Data APIs**: NASA POWER API (open-source)
