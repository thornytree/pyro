"""Per-cell terrain statistics from the LANDFIRE 2020 CONUS rasters.

The downloads in data/landfire_us are 30 m GeoTIFFs in EPSG:5070 (the grid's
own projection): elevation (m), slope (degrees) and aspect (degrees, -1 flat).
The full-resolution files are LZW-compressed, which the standard library
cannot decode at a useful speed. Each one ships a `.tif.ovr` pyramid whose
levels are deflate-compressed, so this module reads one pyramid level with
`zlib` and needs neither GDAL nor rasterio.

Pyramid levels were built by nearest-neighbour resampling. At the default
240 m level a 10 km cell is summarised from about 1,700 of its 111,000 pixels:
a regular subsample, fine for cell means, not for anything finer.
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

from shared import grid

LAYERS = {"elev": "LF2020_Elev_CONUS", "slope": "LF2020_SlpD_CONUS", "aspect": "LF2020_Asp_CONUS"}
VALID = {"elev": (-500, 9000), "slope": (0, 90), "aspect": (-1, 359)}  # aspect -1 is flat
_NUMPY = {1: "u1", 3: "u2", 4: "u4", 8: "i2", 9: "i4", 11: "f4", 12: "f8", 16: "u8", 17: "i8", 18: "u8"}
_WIDTH, _HEIGHT, _BITS, _COMPRESSION, _PREDICTOR = 256, 257, 258, 259, 317
_TILE_W, _TILE_H, _OFFSETS, _COUNTS, _FORMAT = 322, 323, 324, 325, 339
_SCALE, _TIEPOINT, _NODATA = 33550, 33922, 42113


class Tiff:
    """The tag directories of a TIFF or BigTIFF file; values are decoded on request."""

    def __init__(self, path: Path):
        self.file = open(path, "rb")
        head = self.file.read(16)
        self.order = "<" if head[:2] == b"II" else ">"
        big = struct.unpack(self.order + "H", head[2:4])[0] == 43
        self.word, n_fmt, self.entry = ("Q", "Q", 20) if big else ("I", "H", 12)
        offset = struct.unpack(self.order + self.word, head[8:16] if big else head[4:8])[0]
        self.ifds: list[dict[int, tuple[int, int, bytes]]] = []
        while offset:
            self.file.seek(offset)
            n = struct.unpack(self.order + n_fmt, self.file.read(struct.calcsize(n_fmt)))[0]
            raw = self.file.read(self.entry * n)
            offset = struct.unpack(self.order + self.word, self.file.read(struct.calcsize(self.word)))[0]
            tags = {}
            for i in range(n):
                e = raw[i * self.entry:(i + 1) * self.entry]
                tag, kind = struct.unpack(self.order + "HH", e[:4])
                size = struct.calcsize(self.word)
                tags[tag] = (kind, struct.unpack(self.order + self.word, e[4:4 + size])[0], e[4 + size:])
            self.ifds.append(tags)

    def value(self, ifd: int, tag: int):
        """A tag as a numpy array (ASCII tags as str); None when the tag is absent."""
        if tag not in self.ifds[ifd]:
            return None
        kind, count, inline = self.ifds[ifd][tag]
        dtype = np.dtype("S1" if kind == 2 else self.order + _NUMPY[kind])
        size = dtype.itemsize * count
        if size <= len(inline):
            raw = inline[:size]
        else:
            self.file.seek(struct.unpack(self.order + self.word, inline)[0])
            raw = self.file.read(size)
        if kind == 2:
            return raw.split(b"\0")[0].decode("latin1")
        return np.frombuffer(raw, dtype=dtype)

    def read_level(self, ifd: int) -> tuple[np.ndarray, int | None]:
        """One whole image as a 2-D array, plus its nodata value."""
        get = lambda tag: self.value(ifd, tag)
        width, height = int(get(_WIDTH)[0]), int(get(_HEIGHT)[0])
        tile_w, tile_h = int(get(_TILE_W)[0]), int(get(_TILE_H)[0])
        compression = int(get(_COMPRESSION)[0])
        predictor = get(_PREDICTOR)
        if compression not in (1, 8, 32946) or int(get(_BITS)[0]) != 16 or (predictor is not None and predictor[0] != 1):
            raise ValueError("expected 16-bit tiles, uncompressed or deflate, without a predictor")
        signed = get(_FORMAT) is not None and int(get(_FORMAT)[0]) == 2
        dtype = np.dtype(self.order + ("i2" if signed else "u2"))
        nodata = get(_NODATA)
        if nodata is not None:
            nodata = int(float(nodata))
            if signed and nodata > 32767:  # written as unsigned, stored signed
                nodata -= 65536
        out = np.full((height, width), 0 if nodata is None else nodata, dtype=dtype.newbyteorder("="))
        across = -(-width // tile_w)
        for i, (offset, count) in enumerate(zip(get(_OFFSETS), get(_COUNTS))):
            if count == 0:  # sparse tile: stays nodata
                continue
            self.file.seek(int(offset))
            raw = self.file.read(int(count))
            if compression != 1:
                raw = zlib.decompress(raw)
            tile = np.frombuffer(raw, dtype=dtype).reshape(tile_h, tile_w)
            r, c = (i // across) * tile_h, (i % across) * tile_w
            out[r:r + tile_h, c:c + tile_w] = tile[:height - r, :width - c]
        return out, nodata


def cell_windows(cell_row, cell_col, origin, pixel, shape):
    """Pixel windows (r0, r1, c0, c1) of grid cells in a north-up raster.

    `origin` is the raster's top-left corner (x, y), `pixel` its (x, y) pixel
    size in metres, `shape` its (rows, cols). Windows are clipped to the raster;
    a cell outside it gets an empty window.
    """
    x0 = grid.X_MIN + np.asarray(cell_col, dtype="float64") * grid.CELL_SIZE_M
    y0 = grid.Y_MIN + np.asarray(cell_row, dtype="float64") * grid.CELL_SIZE_M
    c0 = np.rint((x0 - origin[0]) / pixel[0])
    c1 = np.rint((x0 + grid.CELL_SIZE_M - origin[0]) / pixel[0])
    r0 = np.rint((origin[1] - y0 - grid.CELL_SIZE_M) / pixel[1])
    r1 = np.rint((origin[1] - y0) / pixel[1])
    clip = lambda v, top: np.clip(v, 0, top).astype("int64")
    return clip(r0, shape[0]), clip(r1, shape[0]), clip(c0, shape[1]), clip(c1, shape[1])


def read_layer(landfire_dir: Path, layer: str, pixel_m: float):
    """The pyramid level of `layer` nearest `pixel_m`: (array, nodata, origin, pixel)."""
    name = LAYERS[layer]
    full = Tiff(landfire_dir / name / "Tif" / f"{name}.tif")
    width, height = int(full.value(0, _WIDTH)[0]), int(full.value(0, _HEIGHT)[0])
    scale, tie = full.value(0, _SCALE), full.value(0, _TIEPOINT)
    origin = (tie[3] - tie[0] * scale[0], tie[4] + tie[1] * scale[1])
    pyramid = Tiff(landfire_dir / name / "Tif" / f"{name}.tif.ovr")
    widths = [int(pyramid.value(i, _WIDTH)[0]) for i in range(len(pyramid.ifds))]
    level = int(np.argmin([abs(scale[0] * width / w - pixel_m) for w in widths]))
    data, nodata = pyramid.read_level(level)
    pixel = (scale[0] * width / data.shape[1], scale[1] * height / data.shape[0])
    return data, nodata, origin, pixel


def cell_stats(landfire_dir: Path, cells: pd.DataFrame, pixel_m: float = 240.0) -> pd.DataFrame:
    """Terrain columns for each (cell_row, cell_col) in `cells`.

    topo_valid_frac is the share of the cell's pixels that have elevation
    (0 for cells outside CONUS; below 1 on coasts and borders). Northness and
    eastness are the mean cos and sin of aspect over the cell with flat pixels
    counted as 0, so a value near 0 means flat or mixed, not "faces nowhere".
    """
    out = cells[["cell_row", "cell_col"]].reset_index(drop=True).copy()
    n = len(out)
    cols = {k: np.full(n, np.nan) for k in (
        "topo_valid_frac", "topo_elev_mean", "topo_elev_std", "topo_slope_mean", "topo_slope_p90",
        "topo_northness", "topo_eastness", "topo_flat_frac")}
    for layer in LAYERS:
        data, nodata, origin, pixel = read_layer(landfire_dir, layer, pixel_m)
        windows = cell_windows(out["cell_row"], out["cell_col"], origin, pixel, data.shape)
        for i, (r0, r1, c0, c1) in enumerate(zip(*windows)):
            block = data[r0:r1, c0:c1]
            low, high = VALID[layer]  # the files also hold -9999 and 32767 fill values
            valid = block[(block >= low) & (block <= high)].astype("float64")
            if layer == "elev":
                cols["topo_valid_frac"][i] = valid.size / max(block.size, 1)
            if valid.size == 0:
                continue
            if layer == "elev":
                cols["topo_elev_mean"][i], cols["topo_elev_std"][i] = valid.mean(), valid.std()
            elif layer == "slope":
                cols["topo_slope_mean"][i], cols["topo_slope_p90"][i] = valid.mean(), np.percentile(valid, 90)
            else:
                sloped = np.radians(valid[valid >= 0])
                cols["topo_northness"][i] = np.cos(sloped).sum() / valid.size
                cols["topo_eastness"][i] = np.sin(sloped).sum() / valid.size
                cols["topo_flat_frac"][i] = 1 - sloped.size / valid.size
        del data
    return out.assign(**cols)
