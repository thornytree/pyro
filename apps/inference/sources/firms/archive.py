"""Harmonize a FIRMS archive download (a folder of per-sensor CSVs).

Run from apps/inference:

    python -m sources.firms.archive ../../data/firms_historical_us ../../data/firms_harmonized

Writes one file per sensor and year, `<output>/<SOURCE>/<year>.parquet`, in
the unified schema (shared/firms_schema.py), plus `_summary.json` with row
counts. Without pyarrow it writes `<year>.csv.gz` instead. Sensors are
processed one at a time to bound memory; pass `--source` to do a single one.

Read the result back with `read_harmonized`, which restores the schema's
dtypes from either format.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from shared import firms_schema as schema
from sources.firms.normalize import RAW_TEXT_COLUMNS, dedupe, normalize, with_dtypes

CHUNK_ROWS = 500_000
SUMMARY_FILE = "_summary.json"


def _read_normalized(path: Path) -> tuple[pd.DataFrame, int]:
    """One raw CSV -> unified frame, plus the number of rows read."""
    parts, rows_read = [], 0
    chunks = pd.read_csv(
        path, dtype={c: str for c in RAW_TEXT_COLUMNS}, chunksize=CHUNK_ROWS
    )
    for chunk in chunks:
        rows_read += len(chunk)
        parts.append(normalize(chunk))
    if not parts:
        return normalize(pd.read_csv(path, dtype=str)), 0
    return with_dtypes(pd.concat(parts, ignore_index=True)), rows_read


def _source_of(path: Path) -> str | None:
    """Which sensor a file holds, from its first data row."""
    head = pd.read_csv(path, dtype={c: str for c in RAW_TEXT_COLUMNS}, nrows=1)
    if head.empty:
        return None
    return str(normalize(head)["source"].iloc[0])


_EXTENSIONS = {"parquet": "parquet", "csv": "csv.gz"}


def write_year(frame: pd.DataFrame, output: Path, source: str, year: int, fmt: str) -> Path:
    path = output / source / f"{year}.{_EXTENSIONS[fmt]}"
    path.parent.mkdir(parents=True, exist_ok=True)
    if fmt == "parquet":
        frame.to_parquet(path, index=False)
    else:
        frame.to_csv(
            path, index=False, date_format="%Y-%m-%dT%H:%M:%SZ",
            compression={"method": "gzip", "compresslevel": 4},
        )
    return path


def load_source(source: str, files: list[Path]) -> tuple[pd.DataFrame, dict]:
    """Normalize and dedupe every file of one sensor. Returns (frame, counts)."""
    frames, inputs = [], {}
    for path in files:
        frame, rows_read = _read_normalized(path)
        inputs[path.name] = {"rows_read": rows_read, "rows_unusable": rows_read - len(frame)}
        frames.append(frame)
    combined = with_dtypes(pd.concat(frames, ignore_index=True))
    del frames
    if (combined["source"] != source).any():
        raise ValueError(f"{[f.name for f in files]} mix sensors; expected only {source}")
    rows_before = len(combined)
    combined = dedupe(combined)
    return combined, {"inputs": inputs, "duplicates_removed": rows_before - len(combined)}


def summarize(frame: pd.DataFrame, counts: dict, fmt: str) -> dict:
    return {
        **counts,
        "rows_written": len(frame),
        "rows_outside_tile_grid": int(frame["tile_id"].isna().sum()),
        "first_detection": frame["acq_datetime"].min().isoformat(),
        "last_detection": frame["acq_datetime"].max().isoformat(),
        "by_quality": {k: int(v) for k, v in frame["quality"].value_counts().items() if v},
        "by_satellite": {k: int(v) for k, v in frame["satellite"].value_counts().items() if v},
        "format": fmt,
    }


def harmonize_source(source: str, files: list[Path], output: Path, fmt: str) -> dict:
    """Normalize, dedupe and write every file of one sensor. Returns its summary."""
    frame, counts = load_source(source, files)
    # Clear out a previous run so a year that no longer has rows cannot linger.
    for stale in (output / source).glob("*.*"):
        stale.unlink()
    for year, group in frame.groupby(frame["acq_datetime"].dt.year.to_numpy(), sort=True):
        write_year(group, output, source, int(year), fmt)
    return summarize(frame, counts, fmt)


def group_by_source(input_dir: Path) -> dict[str, list[Path]]:
    groups: dict[str, list[Path]] = {}
    for path in sorted(input_dir.glob("*.csv")):
        source = _source_of(path)
        if source is not None:
            groups.setdefault(source, []).append(path)
    return groups


def read_harmonized(output: Path, sources=None, years=None) -> pd.DataFrame:
    """Load harmonized detections, optionally only some sensors and years."""
    frames = []
    for source in sources or schema.SOURCES:
        for path in sorted((Path(output) / source).glob("*.*")):
            if years is not None and int(path.name.split(".")[0]) not in years:
                continue
            if path.suffix == ".parquet":
                frame = pd.read_parquet(path)
            else:
                text = [c for c, t in schema.COLUMNS.items() if t == "category"]
                frame = pd.read_csv(path, dtype={c: str for c in text}, parse_dates=["acq_datetime"])
            frames.append(with_dtypes(frame))
    if not frames:
        raise FileNotFoundError(f"No harmonized FIRMS files under {output}")
    return with_dtypes(pd.concat(frames, ignore_index=True))


def harmonize(input_dir: Path, output: Path, fmt: str, only: str | None = None) -> dict:
    groups = group_by_source(input_dir)
    if only is not None and only not in groups:
        raise SystemExit(f"No files for {only} in {input_dir}; found {sorted(groups)}")

    output.mkdir(parents=True, exist_ok=True)
    summary_path = output / SUMMARY_FILE
    summary = json.loads(summary_path.read_text()) if summary_path.exists() else {}
    for source, files in groups.items():
        if only is not None and source != only:
            continue
        summary[source] = harmonize_source(source, files, output, fmt)
        summary_path.write_text(json.dumps(summary, indent=2) + "\n")
        print(f"{source}: {summary[source]['rows_written']:,} rows", flush=True)
    return summary


def _default_format() -> str:
    try:
        import pyarrow  # noqa: F401
    except ImportError:
        return "csv"
    return "parquet"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--source", choices=schema.SOURCES, help="only this sensor")
    parser.add_argument(
        "--format", choices=("parquet", "csv"), default=_default_format(),
        help="default: parquet if pyarrow is installed, else csv (gzip)",
    )
    args = parser.parse_args()
    harmonize(args.input_dir, args.output_dir, args.format, args.source)


if __name__ == "__main__":
    main()
