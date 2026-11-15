"""Download Daymet daily weather for every training cell (Single Pixel API).

Run from apps/inference (standard library only, no install needed):

    python -m sources.daymet.fetch ../../data/training/cells.csv.gz ../../data/daymet_us

One request per cell returns its whole daily series. Each response is saved
unchanged as `<output>/<tile_id>/<cell_id>.csv.gz`. Cells that already have a
file are skipped, so stop it (Ctrl+C) and rerun it whenever you like.

`--first` takes weather_queue.csv.gz and fetches those cells first, so the
cells that also get Open-Meteo weather are complete early. That queue is in
random order, so `--target N` (only the first N cells in fetch order) leaves a
random subset of cells, weighted towards cells with more sampled days.

Daymet has no data for water. A cell whose centre it refuses (HTTP 400) is
listed in `<output>/no_data.csv` and never requested again; delete a line
there to retry that cell.

API: https://daymet.ornl.gov/web_services (no key; no published rate limit,
so the default is a modest 8 requests at a time).
"""
from __future__ import annotations

import argparse
import csv
import datetime
import gzip
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from shared.net import open_url

API = "https://daymet.ornl.gov/single-pixel/api/data"
VARIABLES = "tmax,tmin,prcp,vp"
START = "2000-01-01"  # the FIRMS archive starts in November 2000
USER_AGENT = "pyro-hackathon/0.1 (training data fetch)"
NO_DATA_FILE = "no_data.csv"
# A point known to be on land (the one shared.net checks the connection with),
# so finding Daymet's newest year never depends on what the first cell is.
PROBE = {"latitude": "40", "longitude": "-105"}


def http_get(url: str, tries: int = 5) -> bytes:
    """GET with retries on timeouts, 429 and 5xx. Other HTTP errors are raised at once."""
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with open_url(request, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code != 429 and error.code < 500:
                raise
            last = error
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            last = error
        time.sleep(5 * 2**attempt)
    raise last


def cell_url(api: str, cell: dict, end_year: int) -> str:
    query = urllib.parse.urlencode({
        "lat": cell["latitude"], "lon": cell["longitude"], "vars": VARIABLES,
        "start": START, "end": f"{end_year}-12-31",
    }, safe=",")
    return f"{api}?{query}"


def latest_year(api: str) -> int:
    """Daymet's newest year: try last year, then step back until a request works."""
    year = datetime.date.today().year - 1
    while year >= 2020:
        try:
            if b"year,yday" in http_get(cell_url(api, PROBE, year), tries=2):
                return year
        except urllib.error.HTTPError:
            pass
        year -= 1
    raise SystemExit("Daymet refused every end year from last year back to 2020; check the API by hand.")


def fetch_cell(api: str, cell: dict, end_year: int, output: Path) -> tuple[str, str]:
    """Returns ("ok" | "no_data" | "failed", message)."""
    target = output / cell["tile_id"] / f"{cell['cell_id']}.csv.gz"
    try:
        body = http_get(cell_url(api, cell, end_year))
        if b"year,yday" not in body:
            return "failed", f"{cell['cell_id']}: unexpected response, not saved"
        target.parent.mkdir(parents=True, exist_ok=True)
        part = target.with_name(target.name + ".part")
        part.write_bytes(gzip.compress(body, 6))
        part.replace(target)
        return "ok", ""
    except urllib.error.HTTPError as error:
        # The same request works for the probe point, so a 400 is about this location.
        if error.code == 400:
            return "no_data", f"{cell['cell_id']}: no Daymet data at its centre (water?), dropped"
        return "failed", f"{cell['cell_id']}: {error}"
    except Exception as error:  # one bad cell must not stop the run; it is retried next run
        return "failed", f"{cell['cell_id']}: {error}"


def read_no_data(output: Path) -> set[str]:
    path = output / NO_DATA_FILE
    if not path.exists():
        return set()
    with path.open(newline="") as handle:
        return {row["cell_id"] for row in csv.DictReader(handle)}


def record_no_data(output: Path, cell: dict) -> None:
    path = output / NO_DATA_FILE
    output.mkdir(parents=True, exist_ok=True)
    new = not path.exists()
    with path.open("a", newline="") as handle:
        writer = csv.writer(handle)
        if new:
            writer.writerow(["cell_id", "latitude", "longitude"])
        writer.writerow([cell["cell_id"], cell["latitude"], cell["longitude"]])


def ordered_cells(cells_path: Path, first_path: Path | None) -> list[dict]:
    with gzip.open(cells_path, "rt", newline="") as handle:
        cells = list(csv.DictReader(handle))
    cells.sort(key=lambda c: -int(c["n_fire_days"]))
    if first_path is None:
        return cells
    rank: dict[tuple[str, str], int] = {}
    with gzip.open(first_path, "rt", newline="") as handle:
        for row in csv.DictReader(handle):
            rank.setdefault((row["cell_row"], row["cell_col"]), len(rank))
    return sorted(cells, key=lambda c: rank.get((c["cell_row"], c["cell_col"]), len(rank)))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("cells", type=Path, help="data/training/cells.csv.gz")
    parser.add_argument("output", type=Path, help="data/daymet_us")
    parser.add_argument("--first", type=Path, help="weather_queue.csv.gz: fetch its cells first")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--target", type=int,
                        help="only the first N cells in fetch order, counting those already downloaded")
    parser.add_argument("--limit", type=int, help="stop after this many cells (for a trial run)")
    parser.add_argument("--end-year", type=int, help="default: found automatically")
    parser.add_argument("--api", default=API, help=argparse.SUPPRESS)
    args = parser.parse_args()

    cells = ordered_cells(args.cells, args.first)[: args.target]
    no_data = read_no_data(args.output)
    wanted = [c for c in cells if c["cell_id"] not in no_data]
    todo = [c for c in wanted
            if not (args.output / c["tile_id"] / f"{c['cell_id']}.csv.gz").exists()]
    print(f"{len(wanted) - len(todo):,} of {len(cells):,} cells already downloaded, "
          f"{len(cells) - len(wanted):,} dropped (no Daymet data)")
    todo = todo[: args.limit]
    if not todo:
        return
    end_year = args.end_year or latest_year(args.api)
    print(f"Fetching {len(todo):,} cells, {START} to {end_year}-12-31, "
          f"{args.workers} at a time", flush=True)

    started, failed, dropped = time.time(), 0, 0
    with ThreadPoolExecutor(args.workers) as pool:
        results = pool.map(lambda c: fetch_cell(args.api, c, end_year, args.output), todo)
        for done, (cell, (kind, message)) in enumerate(zip(todo, results), 1):
            if kind == "no_data":
                dropped += 1
                record_no_data(args.output, cell)
            elif kind == "failed":
                failed += 1
            if message:
                print(message, flush=True)
            if done % 100 == 0 or done == len(todo):
                rate = done / (time.time() - started)
                print(f"{done:,}/{len(todo):,}  {rate:.1f} cells/s  "
                      f"about {(len(todo) - done) / rate / 3600:.1f} h left", flush=True)
    print(f"Finished. {dropped:,} cells dropped (no Daymet data); "
          f"{failed:,} failed and will be retried on the next run.")


if __name__ == "__main__":
    main()
