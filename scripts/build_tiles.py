"""Build static temperature tiles from the Berkeley Earth high-resolution (0.25 degree) grid.

Source: Berkeley Earth Surface Temperature - High-Resolution (BEST-HR), beta,
0.25 x 0.25 degree Land + Ocean, monthly, from January 1850.
https://berkeleyearth.org  License: CC BY-NC 4.0
(https://creativecommons.org/licenses/by-nc/4.0/). The tiles this script writes are a
derived, modified version of that data (annual means, quantized to 0.01 C, plus a
1 degree aggregate) and stay under the same license.

Usage:
    python -I scripts/build_tiles.py --input working/Global_TAVG_Gridded_0p25deg.nc \
        --out working/tiles/berkeley-earth-hr/v1

Requires numpy and netCDF4 (see scripts/requirements.txt). Peak memory is about 1 GB.

Two levels are written, each as gzip files of little-endian int16:
    hr/{row}_{col}.bin.gz    0.25 degree cells, 5 x 5 degree tiles (20 x 20 cells)
    1deg/{row}_{col}.bin.gz  1 degree cells, 10 x 10 degree tiles (10 x 10 cells),
                             used for large selections
Each tile holds, for its N cells:
    climatology[N]        annual mean 1951-1980 temperature, hundredths of C
    land_fraction[N]      land share of each cell, ten-thousandths (0-10000)
    anomaly[N][n_years]   annual anomaly vs 1951-1980, hundredths of C
Cells are ordered south-to-north, then west-to-east inside the tile. Missing values
are NODATA (-32768). A year is kept only when all 12 months exist; trailing partial
years are dropped.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path

import netCDF4
import numpy as np

# SHA-256 of the beta file received on 2026-11-17 (file_creation 09-Nov-2026).
# The beta product may be revised; pass --skip-checksum for a newer file and
# write the output to a new version folder (v2, v3, ...).
SOURCE_SHA256 = "0306b68634b1e4bbae2a6cda3ed6d5593593325aa1e8d6f49fca7caf6b6796c2"

RES = 0.25
NLAT, NLON = 720, 1440
SCALE = 100  # stored value = round(celsius * SCALE)
LAND_SCALE = 10000
NODATA = -32768
# Levels: (id, cell size in degrees, cells per tile side, aggregation factor from 0.25)
LEVELS = [("hr", 0.25, 20, 1), ("1deg", 1.0, 10, 4)]
# A 1 degree cell's annual value needs at least this many of its 16 sub-cells.
MIN_SUBCELLS = 8


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


def quantize(values: np.ndarray, scale: int) -> np.ndarray:
    out = np.full(values.shape, NODATA, dtype="<i2")
    ok = np.isfinite(values)
    scaled = np.round(values[ok] * scale)
    if scaled.size and (scaled.min() <= NODATA or scaled.max() > 32767):
        raise ValueError("value out of int16 range")
    out[ok] = scaled.astype("<i2")
    return out


def block_mean(a: np.ndarray, f: int, min_count: int) -> np.ndarray:
    """NaN-aware mean over f x f blocks of the last two axes."""
    *lead, h, w = a.shape
    b = a.reshape(*lead, h // f, f, w // f, f)
    ok = np.isfinite(b)
    count = ok.sum(axis=(-3, -1))
    total = np.where(ok, b, 0).sum(axis=(-3, -1), dtype=np.float64)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = total / count
    return np.where(count >= min_count, mean, np.nan).astype(np.float32)


def write_level(out: Path, level: str, side: int, clim, land, annual_q) -> tuple[int, int]:
    """Write tiles for one level. annual_q is int16 (years, lat, lon)."""
    n_years, nlat, nlon = annual_q.shape
    clim_q = quantize(clim, SCALE)
    land_q = quantize(land, LAND_SCALE)
    folder = out / level
    folder.mkdir(parents=True, exist_ok=True)
    count = total = 0
    for r in range(nlat // side):
        for c in range(nlon // side):
            la, lo = slice(r * side, (r + 1) * side), slice(c * side, (c + 1) * side)
            payload = (
                clim_q[la, lo].tobytes()
                + land_q[la, lo].tobytes()
                + np.ascontiguousarray(annual_q[:, la, lo].reshape(n_years, -1).T).tobytes()
            )
            data = gzip.compress(payload, compresslevel=9, mtime=0)
            (folder / f"{r}_{c}.bin.gz").write_bytes(data)
            count += 1
            total += len(data)
    return count, total


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--skip-checksum", action="store_true", help="accept a source file with a different SHA-256"
    )
    args = parser.parse_args()

    print("Checking SHA-256...")
    digest = sha256_of(args.input)
    if digest != SOURCE_SHA256 and not args.skip_checksum:
        raise SystemExit(f"Unexpected SHA-256 {digest}; expected {SOURCE_SHA256}")

    ds = netCDF4.Dataset(args.input)
    ds.set_auto_mask(False)
    lat = ds["latitude"][:]
    lon = ds["longitude"][:]
    time = ds["time"][:]
    assert lat.shape == (NLAT,) and lon.shape == (NLON,), "expected a 0.25 degree grid"
    assert np.allclose(lat, np.arange(-90 + RES / 2, 90, RES)), "latitude must run south to north"
    assert np.allclose(lon, np.arange(-180 + RES / 2, 180, RES)), "longitude must run -180 to 180"

    first_year = int(math.floor(time[0]))
    if not math.isclose(time[0], first_year + 1 / 24, abs_tol=1e-4):
        raise SystemExit("time axis does not start in January")
    n_years = len(time) // 12  # drops a trailing partial year
    last_year = first_year + n_years - 1

    temp = ds["temperature"]
    agg = LEVELS[1][3]
    annual_hr = np.full((n_years, NLAT, NLON), NODATA, dtype="<i2")
    annual_1 = np.full((n_years, NLAT // agg, NLON // agg), NODATA, dtype="<i2")
    for y in range(n_years):
        months = np.asarray(temp[y * 12 : y * 12 + 12], dtype=np.float32)
        complete = np.all(np.isfinite(months), axis=0)
        mean = np.where(complete, months.mean(axis=0), np.nan).astype(np.float32)
        annual_hr[y] = quantize(mean, SCALE)
        annual_1[y] = quantize(block_mean(mean, agg, MIN_SUBCELLS), SCALE)
        if y % 25 == 0:
            print(f"  read {first_year + y}")

    clim = np.asarray(ds["climatology"][:], dtype=np.float32)
    clim_hr = np.where(np.all(np.isfinite(clim), axis=0), clim.mean(axis=0), np.nan)
    land_hr = np.asarray(ds["land_mask"][:], dtype=np.float64)
    land_hr = np.where(np.isfinite(land_hr), np.clip(land_hr, 0, 1), np.nan)
    clim_1 = block_mean(clim_hr, agg, 1)
    land_1 = block_mean(land_hr, agg, 1)

    levels_meta = []
    for (level, res, side, _), (c, l, a) in zip(
        LEVELS, [(clim_hr, land_hr, annual_hr), (clim_1, land_1, annual_1)]
    ):
        count, total = write_level(args.out, level, side, c, l, a)
        print(f"  {level}: {count} tiles, {total / 1e6:.1f} MB")
        levels_meta.append(
            {
                "id": level,
                "resolution": res,
                "tileDegrees": res * side,
                "cellsPerSide": side,
                "rows": round(180 / (res * side)),
                "cols": round(360 / (res * side)),
                "tilePath": f"{level}/{{row}}_{{col}}.bin.gz",
            }
        )

    manifest = {
        "version": 1,
        "source": {
            "name": "Berkeley Earth Surface Temperature - High-Resolution (BEST-HR), beta, 0.25 degree Land + Ocean",
            "file": args.input.name,
            "fileCreated": getattr(ds, "file_creation", None),
            "homepage": "https://berkeleyearth.org",
            "sha256": digest,
            "license": "CC BY-NC 4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by-nc/4.0/",
            "attribution": "Berkeley Earth (berkeleyearth.org)",
            "citation": "Rohde, R. A., Calvert, B., and Hausfather, Z.: Berkeley Earth Surface "
            "Temperature - High-Resolution (BEST-HR): a 0.25 degree Global Gridded Temperature Data "
            "Set for Climate Monitoring, Earth Syst. Sci. Data Discuss. [preprint], "
            "https://doi.org/10.5194/essd-2026-412, in review, 2026.",
            "modifications": "Monthly anomalies averaged to annual means (complete years only), "
            "climatology averaged to an annual mean, values quantized to 0.01 C, and a 1 degree "
            f"aggregate built from the 0.25 degree cells (at least {MIN_SUBCELLS} of 16 sub-cells).",
        },
        "startYear": first_year,
        "endYear": last_year,
        "years": n_years,
        "anomalyBaseline": [1951, 1980],
        "scale": SCALE,
        "landScale": LAND_SCALE,
        "nodata": NODATA,
        "levels": levels_meta,
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Done: years {first_year}-{last_year}")


if __name__ == "__main__":
    main()
