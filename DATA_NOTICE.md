# Data notice

The temperature tiles this app loads (hosted separately, not stored in this
repository) are derived from **Berkeley Earth** ([www.berkeleyearth.org](https://www.berkeleyearth.org)).

- **Source dataset:** Berkeley Earth Surface Temperature – High-Resolution (BEST-HR),
  **beta**, 0.25° × 0.25° Land + Ocean, monthly from January 1850
  (`Global_TAVG_Gridded_0p25deg.nc`, created 9 November 2026, SHA-256
  `0306b68634b1e4bbae2a6cda3ed6d5593593325aa1e8d6f49fca7caf6b6796c2`).
  Berkeley Earth notes the high-resolution products are a beta release and may change.
- **License:** [Creative Commons BY-NC 4.0 International](https://creativecommons.org/licenses/by-nc/4.0/).
  Non-commercial use only.
- **Citation:** Rohde, R. A., Calvert, B., and Hausfather, Z.: Berkeley Earth Surface
  Temperature – High-Resolution (BEST-HR): a 0.25° Global Gridded Temperature Data Set
  for Climate Monitoring, Earth Syst. Sci. Data Discuss. [preprint],
  <https://doi.org/10.5194/essd-2026-412>, in review, 2026.

## Changes made

The tiles are a modified version of the source data, produced by
[`scripts/build_tiles.py`](scripts/build_tiles.py):

- Monthly anomalies were averaged into annual means. Years missing any month
  for a grid cell were left empty for that cell, and the partial current year was dropped,
  so the record runs 1850–2025.
- The monthly 1951–1980 climatology was averaged into one annual value per cell.
- Values were rounded to 0.01 °C (land fraction to 0.0001) and split into tiles.
- A 1° version was built by averaging each block of 16 cells (at least 8 with data),
  and is used for large selections.

These derived files are shared under the same CC BY-NC 4.0 license. Berkeley
Earth does not endorse this project.

## Rebuilding the tiles

The source file is not committed (it is about 6.8 GB). Put it in `working/`, which git ignores, then:

```bash
python -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt
.venv/bin/python -I scripts/build_tiles.py --input working/Global_TAVG_Gridded_0p25deg.nc --out working/tiles/berkeley-earth-hr/v1
```

The script checks the source file's SHA-256 before building. If Berkeley Earth releases a
revised beta file, rebuild with `--skip-checksum` into a new folder (`v2`), upload it, and
point `VITE_DATA_URL` at the new folder.
