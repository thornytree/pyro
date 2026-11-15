"""Download Open-Meteo historical weather for queued training cell-days.

Run from apps/inference, once a day (standard library only):

    python -m sources.weather.fetch_history ../../data/training/weather_queue.csv.gz ../../data/open-meteo_us

For each queued cell-day it requests the 7 local days ending on that date,
hourly, and appends one line to `<output>/history.jsonl`. `<output>/done.csv`
records what has been fetched, so every run continues where the last stopped.

Free-tier limits (https://open-meteo.com/en/terms): under 10,000 calls a day,
5,000 an hour, 600 a minute, non-commercial, CC BY 4.0 attribution. A request
of up to 7 days and 10 variables for one place counts as one call, so the
defaults (9,000 requests a run, one every 0.75 s) stay inside all three.
The run stops by itself if the API answers 429 (limit reached).

Variables are hourly because those names are certain; daily values (max wind,
min humidity, ...) are computed when the bundle is joined.
"""
from __future__ import annotations

import argparse
import csv
import datetime
import gzip
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from shared.net import open_url

API = "https://archive-api.open-meteo.com/v1/archive"
HOURLY = [
    "temperature_2m", "relative_humidity_2m", "vapour_pressure_deficit", "precipitation",
    "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "soil_moisture_0_to_7cm",
]
WINDOW_DAYS = 7      # longer windows count as more than one call
ARCHIVE_LAG_DAYS = 7  # the archive trails today by a few days
USER_AGENT = "pyro-hackathon/0.1 (training data fetch)"
KEY = ("date", "cell_row", "cell_col")


class LimitReached(Exception):
    pass


def fetch(api: str, row: dict) -> dict:
    end = datetime.date.fromisoformat(row["date"])
    start = end - datetime.timedelta(days=WINDOW_DAYS - 1)
    query = urllib.parse.urlencode({
        "latitude": f"{float(row['latitude']):.4f}", "longitude": f"{float(row['longitude']):.4f}",
        "start_date": start.isoformat(), "end_date": end.isoformat(),
        "hourly": ",".join(HOURLY), "timezone": "auto", "wind_speed_unit": "ms",
    }, safe=",")
    for attempt in range(4):
        try:
            request = urllib.request.Request(f"{api}?{query}", headers={"User-Agent": USER_AGENT})
            with open_url(request, timeout=60) as response:
                data = json.load(response)
            break
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:300]
            if error.code == 429:
                raise LimitReached(detail) from None
            if error.code < 500:
                raise SystemExit(f"Open-Meteo rejected the request ({error.code}): {detail}") from None
            last = error
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            last = error
        time.sleep(5 * 2**attempt)
    else:
        raise last
    hourly = data["hourly"]
    return {
        **{k: row[k] for k in KEY},
        "start": start.isoformat(),  # hourly values begin at 00:00 local time on this day
        "utc_offset_seconds": data.get("utc_offset_seconds"),
        "elevation": data.get("elevation"),
        "grid_latitude": data.get("latitude"), "grid_longitude": data.get("longitude"),
        "hourly": {name: hourly[name] for name in HOURLY},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("queue", type=Path, help="data/training/weather_queue.csv.gz")
    parser.add_argument("output", type=Path, help="data/open-meteo_us")
    parser.add_argument("--max-calls", type=int, default=9000, help="requests this run")
    parser.add_argument("--delay", type=float, default=0.75, help="seconds between requests")
    parser.add_argument("--api", default=API, help=argparse.SUPPRESS)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    done_path, history_path = args.output / "done.csv", args.output / "history.jsonl"
    done = set()
    if done_path.exists():
        with done_path.open(newline="") as handle:
            done = {tuple(r) for r in csv.reader(handle)}
    with gzip.open(args.queue, "rt", newline="") as handle:
        queue = list(csv.DictReader(handle))
    newest = (datetime.date.today() - datetime.timedelta(days=ARCHIVE_LAG_DAYS)).isoformat()
    todo = [r for r in queue if tuple(r[k] for k in KEY) not in done and r["date"] <= newest]
    print(f"{len(done):,} cell-days already fetched, {len(todo):,} left in the queue")
    todo = todo[: args.max_calls]

    fetched = 0
    with history_path.open("a", encoding="utf-8") as history, done_path.open("a", newline="") as marks:
        mark = csv.writer(marks)
        try:
            for row in todo:
                began = time.time()
                history.write(json.dumps(fetch(args.api, row), separators=(",", ":")) + "\n")
                history.flush()
                mark.writerow([row[k] for k in KEY])
                marks.flush()
                fetched += 1
                if fetched % 250 == 0:
                    print(f"{fetched:,}/{len(todo):,}", flush=True)
                time.sleep(max(0.0, args.delay - (time.time() - began)))
        except LimitReached as limit:
            print(f"Open-Meteo says the limit is reached: {limit}")
        except KeyboardInterrupt:
            print("Stopped.")
    print(f"Fetched {fetched:,} cell-days this run. Run again tomorrow for the next batch.")


if __name__ == "__main__":
    main()
