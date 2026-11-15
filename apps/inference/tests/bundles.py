"""A Python copy of apps/orchestrator/tests/fixtures/bundle.ts, with a forecast and real grids."""
import numpy as np

ROWS = COLUMNS = 28
AREA_KM2 = 300 * 1.609344**2


def region_bounds(lat: float, lon: float) -> dict:
    """As createRegionBounds in apps/orchestrator/src/fan-out/region.ts."""
    radius = 6371.0088
    half_lat = np.sqrt(AREA_KM2) / (2 * radius)
    half_lon = AREA_KM2 / (4 * radius**2 * np.cos(np.radians(lat)) * np.sin(half_lat))
    dlat, dlon = np.degrees(half_lat), np.degrees(half_lon)
    return {"west": lon - dlon, "south": lat - dlat, "east": lon + dlon, "north": lat + dlat}


def make_bundle(lat=39.0, lon=-121.0, wind_kph=20.0, wind_from=270.0, detections=(), slope=5.0,
                fuel=141, hours=24, observed="2025-08-15T20:00:00.000Z") -> dict:
    bounds = region_bounds(lat, lon)
    cells = [{"latitude": bounds["north"] - (r + 0.5) * (bounds["north"] - bounds["south"]) / ROWS,
              "longitude": bounds["west"] + (c + 0.5) * (bounds["east"] - bounds["west"]) / COLUMNS}
             for r in range(ROWS) for c in range(COLUMNS)]
    weather = {"temperature": 30.0, "humidity": 20.0, "wind_speed_kph": wind_kph, "wind_direction": wind_from,
               "precipitation_mm": 0.0, "wind_gusts_kph": wind_kph * 1.5, "vapour_pressure_deficit_kpa": 3.0,
               "shortwave_radiation_w_m2": 600.0}
    hourly = [{**weather, "temperature": 20.0 + h % 12, "time": f"2025-08-15T{h:02d}:00:00.000Z"} for h in range(hours)]
    location = {"latitude": lat, "longitude": lon}
    grid = {"bounds": bounds, "rows": ROWS, "columns": COLUMNS}
    return {
        "location": location, "observation_time": observed, "weather": weather,
        "weather_grid": {**grid, "cells": [{**c, "sample_index": 0} for c in cells],
                         "samples": [{"requested_location": location, "source_location": location, "elevation_m": 100,
                                      "observation_time": observed, "current": weather, "hourly": hourly}]},
        "fire": {"detections": [
            {"source": source, "instrument": "VIIRS", "satellite": "N", "tile_id": None,
             "location": {"latitude": d_lat, "longitude": d_lon}, "observation_time": observed,
             "frp_mw": 40.0, "scan_km": 0.4, "track_km": 0.4, "confidence": {"kind": "category", "value": confidence}}
            for d_lat, d_lon, source, confidence in detections]},
        "historical_weather": {"grids": []},
        "terrain": {"grid": {**grid, "cells": [
            {**c, "elevation_m": 100.0 + 2.0 * i, "slope_degrees": slope, "aspect_degrees": None if slope == 0 else 180.0}
            for i, c in enumerate(cells)]}},
        "vegetation": {"grid": {**grid, "cells": [{**c, "fuel_model_code": fuel} for c in cells]}},
    }
