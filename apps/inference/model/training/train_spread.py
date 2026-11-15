"""Model 2a: how likely a burning 10 km cell is to put fire in a neighbouring cell the next day.

    python -m model.training.train_spread ../../data

Built from the FIRMS archive alone. Each burning cell-day (the source) is
paired with its 8 neighbours and with 8 control cells 50 km away in the same
directions. A classifier predicts "fire in the target cell tomorrow, given
none today". The control cells measure how often fire turns up nearby for
unrelated reasons (burning seasons, other ignitions), so

    spread probability = P(adjacent target) - P(control target)

is the part attributable to the source fire. Inference turns that into a mean
spread distance per day for the 1 km simulation (`model/inference/spread.py`).

The archive has no wind, so a second, small fit (model 2b) uses the
cell-days that have Open-Meteo weather to measure how wind speed, wind
alignment and dryness move that probability.

Writes `<data>/models/spread.joblib` and `spread_metrics.json`.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score

from harmonization.compile_dataset import EPOCH, NEIGHBOURS, day_number, fire_history
from model import features
from model.training.fire_days import has_fire, read_fire_cell_days
from shared import grid

CONTROL_CELLS = 5        # control targets sit this many cells (50 km) from the source
BIG_FIRE = 20            # sources with this many detections are all kept
ALBERS_CONE = 0.6028     # EPSG:5070 cone constant: grid north turns by this x (longitude + 96) degrees


def season(day) -> tuple[np.ndarray, np.ndarray]:
    doy = (EPOCH + pd.to_timedelta(np.asarray(day), unit="D")).dayofyear.to_numpy() - 1  # as compile_dataset
    return np.sin(2 * np.pi * doy / 365.25), np.cos(2 * np.pi * doy / 365.25)


def source_features(fire_days: pd.DataFrame, sources: pd.DataFrame) -> pd.DataFrame:
    """Per-source inputs. `sources` are rows of `fire_days`."""
    keys = fire_days["key"].to_numpy()
    row, col, day = (sources[c].to_numpy("int64") for c in ("cell_row", "cell_col", "day"))
    x, y = grid.cell_centre(row, col)
    latitude, longitude = grid.from_albers(x, y)
    sin, cos = season(day)
    return pd.DataFrame({
        "cell_row": row, "cell_col": col, "day": day,
        "src_n_fire": sources["n_fire"].to_numpy(), "src_n_high": sources["n_high"].to_numpy(),
        "src_frp_max": sources["frp_max"].to_numpy(), "src_n_sensors": sources["n_sensors"].to_numpy(),
        "src_fire_days_prev7d": fire_history(keys, row, col, day)["firms_fire_days_prev7d"],
        "src_burning_neighbours": sum(has_fire(keys, row + dr, col + dc, day) for dr, dc in NEIGHBOURS),
        "latitude": latitude, "longitude": longitude, "doy_sin": sin, "doy_cos": cos,
    })


def build_pairs(fire_keys: np.ndarray, sources: pd.DataFrame, rings=(1, CONTROL_CELLS)) -> pd.DataFrame:
    """One row per source and target cell that is inside the grid and not burning on the source day."""
    row, col, day = (sources[c].to_numpy("int64") for c in ("cell_row", "cell_col", "day"))
    blocks = []
    for ring in rings:
        for dr, dc in NEIGHBOURS:
            t_row, t_col = row + dr * ring, col + dc * ring
            inside = (t_row >= 0) & (t_row < grid.N_CELL_ROWS) & (t_col >= 0) & (t_col < grid.N_CELL_COLS)
            keep = inside & ~has_fire(fire_keys, t_row, t_col, day)
            history = fire_history(fire_keys, t_row[keep], t_col[keep], day[keep])
            block = sources[keep].drop(columns=["cell_row", "cell_col"]).assign(
                adjacent=int(ring == 1), diagonal=int(dr != 0 and dc != 0), d_row=dr, d_col=dc,
                tgt_fire_days_prev7d=history["firms_fire_days_prev7d"],
                tgt_fire_days_prev365d=history["firms_fire_days_prev365d"],
                spread=has_fire(fire_keys, t_row[keep], t_col[keep], day[keep] + 1).astype("int8"))
            blocks.append(block)
    return pd.concat(blocks, ignore_index=True)


def sample_sources(fire_days: pd.DataFrame, small_fires: int, seed: int) -> pd.DataFrame:
    """All big fires plus a random draw of the rest; `weight` undoes the unequal sampling."""
    big = fire_days["n_fire"] >= BIG_FIRE
    rest = fire_days[~big]
    take = min(small_fires, len(rest))
    return pd.concat([fire_days[big].assign(weight=1.0),
                      rest.sample(take, random_state=seed).assign(weight=len(rest) / max(take, 1))],
                     ignore_index=True)


def make_spread_estimator(seed: int):
    monotone = {"adjacent": 1}  # a neighbour is never less at risk than a cell 50 km away
    return HistGradientBoostingClassifier(
        max_iter=300, learning_rate=0.08, max_leaf_nodes=31, min_samples_leaf=200, l2_regularization=1.0,
        monotonic_cst=monotone, early_stopping=False, random_state=seed)


def spread_probability(model, frame: pd.DataFrame) -> np.ndarray:
    """P(adjacent) - P(control) for the same source and target history; never negative."""
    x = frame[features.SPREAD_FEATURES]
    near = model.predict_proba(x.assign(adjacent=1))[:, 1]
    far = model.predict_proba(x.assign(adjacent=0, diagonal=x["diagonal"]))[:, 1]
    return np.clip(near - far, 0.0, 1.0)


def reliability(score, y, weight, edges=(0, 0.02, 0.05, 0.1, 0.2, 0.4, 1.0)) -> list[dict]:
    """Predicted against observed next-day fire rate, by predicted bin."""
    table = pd.DataFrame({"p": score, "y": np.asarray(y), "w": np.asarray(weight)})
    out = []
    for label, group in table.groupby(pd.cut(table["p"], list(edges), include_lowest=True), observed=True):
        out.append({"predicted_bin": str(label), "pairs": int(len(group)),
                    "predicted": round(float(np.average(group["p"], weights=group["w"])), 4),
                    "observed": round(float(np.average(group["y"], weights=group["w"])), 4)})
    return out


def spread_by_fire_size(model, near: pd.DataFrame) -> list[dict]:
    """Mean spread probability (adjacent minus control) by the source's detection count."""
    predicted = spread_probability(model, near)
    bins = pd.cut(near["src_n_fire"], [0, 1, 4, 19, 99, 299, 1e9])
    table = pd.DataFrame({"p": predicted, "w": near["weight"].to_numpy()})
    return [{"source_detections": str(label), "pairs": int(len(group)),
             "spread_probability": round(float(np.average(group["p"], weights=group["w"])), 4)}
            for label, group in table.groupby(bins.to_numpy(), observed=True)]


# --- Model 2b: weather adjustment on the cell-days that have Open-Meteo weather ----

def fit_logistic_offset(x: np.ndarray, y: np.ndarray, offset: np.ndarray, ridge: float = 1e-6):
    """Logistic regression with a fixed offset by Newton's method. Returns (coefficients, standard errors)."""
    beta = np.zeros(x.shape[1])
    for _ in range(50):
        p = 1 / (1 + np.exp(-(offset + x @ beta)))
        hessian = (x * (p * (1 - p))[:, None]).T @ x + ridge * np.eye(x.shape[1])
        step = np.linalg.solve(hessian, x.T @ (y - p) - ridge * beta)
        beta += step
        if np.abs(step).max() < 1e-8:
            break
    return beta, np.sqrt(np.diag(np.linalg.inv(hessian)))


def fit_weather(model, fire_days: pd.DataFrame, compiled: pd.DataFrame, train_end_day: int) -> dict:
    rows = compiled[compiled["fire"] == 1].assign(day=lambda d: day_number(d["date"]))
    weather = rows[["cell_row", "cell_col", "day", "om_wind_mean", "om_wind_from_sin", "om_wind_from_cos", "om_vpd_max"]]
    sources = source_features(fire_days, weather[["cell_row", "cell_col", "day"]].merge(
        fire_days, on=["cell_row", "cell_col", "day"]))
    sources = sources.merge(weather, on=["cell_row", "cell_col", "day"]).assign(weight=1.0)
    pairs = build_pairs(fire_days["key"].to_numpy(), sources, rings=(1,))
    # Bearing from source to target, clockwise from true north (grid north corrected for the projection).
    bearing = np.arctan2(pairs["d_col"], pairs["d_row"]) + np.radians(ALBERS_CONE * (pairs["longitude"] + 96.0))
    # The wind blows towards (-sin, -cos) of the direction it comes from.
    along = -(pairs["om_wind_from_sin"] * np.sin(bearing) + pairs["om_wind_from_cos"] * np.cos(bearing))
    centre = {"om_wind_mean": float(sources["om_wind_mean"].mean()), "om_vpd_max": float(sources["om_vpd_max"].mean())}
    x = np.column_stack([
        np.ones(len(pairs)),
        pairs["om_wind_mean"] * along,                      # m/s of wind blowing towards the target
        pairs["om_wind_mean"] - centre["om_wind_mean"],
        pairs["om_vpd_max"] - centre["om_vpd_max"],
    ])
    base = np.clip(model.predict_proba(pairs[features.SPREAD_FEATURES])[:, 1], 1e-6, 1 - 1e-6)
    y = pairs["spread"].to_numpy("float64")
    fit = (pairs["day"] <= train_end_day).to_numpy()
    beta, error = fit_logistic_offset(x[fit], y[fit], np.log(base / (1 - base))[fit])
    names = ["intercept", "wind_towards_target_ms", "wind_mean_ms", "vpd_max_kpa"]
    z = beta / error
    return {
        # Reported only. Inference does not use these coefficients; wire them in once every |z| is 2 or more.
        "significant": bool(np.all(np.abs(z[1:]) >= 2.0)),
        "pairs": int(fit.sum()), "spread_pairs": int(y[fit].sum()), "centre": centre,
        "coefficients": {n: round(float(b), 4) for n, b in zip(names, beta)},
        "standard_errors": {n: round(float(e), 4) for n, e in zip(names, error)},
        "z": {n: round(float(b / e), 2) for n, b, e in zip(names, beta, error)},
    }


def run(data_dir: Path, small_fires: int, seed: int) -> dict:
    training = data_dir / "training"
    fire_days = read_fire_cell_days(training / "firms_cell_day")
    summary = json.loads((training / "compiled" / "summary.json").read_text(encoding="utf-8"))["splits"]
    ends = {name: int(day_number(pd.Index([summary[name]["last_date"]]))[0]) for name in ("train", "validation", "test")}

    # The last archive day has no "tomorrow" yet.
    usable = fire_days[fire_days["day"] <= min(ends["test"], fire_days["day"].max() - 1)]
    sources = sample_sources(usable, small_fires, seed)
    weights = sources["weight"].to_numpy()
    pairs = build_pairs(fire_days["key"].to_numpy(), source_features(fire_days, sources).assign(weight=weights))
    split = np.select([pairs["day"] <= ends["train"], pairs["day"] <= ends["validation"]], ["train", "validation"], "test")

    def fit(mask):
        part = pairs[mask]
        return make_spread_estimator(seed).fit(part[features.SPREAD_FEATURES], part["spread"], sample_weight=part["weight"])

    def evaluate(model, mask):
        part = pairs[mask]
        near = part[part["adjacent"] == 1]
        score = model.predict_proba(near[features.SPREAD_FEATURES])[:, 1]
        return {"pairs": int(len(part)), "adjacent_pairs": int(len(near)),
                "adjacent_spread_rate": round(float(np.average(near["spread"], weights=near["weight"])), 4),
                "control_spread_rate": round(float(np.average(part[part["adjacent"] == 0]["spread"],
                                                              weights=part[part["adjacent"] == 0]["weight"])), 4),
                "auc_adjacent": round(float(roc_auc_score(near["spread"], score, sample_weight=near["weight"])), 4),
                "reliability_adjacent": reliability(score, near["spread"], near["weight"]),
                "spread_by_fire_size": spread_by_fire_size(model, near)}

    validation = evaluate(fit(split == "train"), split == "validation")
    model = fit(split != "test")
    compiled = pd.read_csv(training / "compiled" / "dataset.csv.gz")
    metrics = {
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "features": features.SPREAD_FEATURES, "sources": int(len(sources)), "pairs": int(len(pairs)),
        "control_distance_km": CONTROL_CELLS * grid.CELL_SIZE_M / 1000,
        "validation": validation, "test": evaluate(model, split == "test"),
        "weather_adjustment": fit_weather(model, fire_days, compiled, ends["validation"]),
    }
    out = features.model_dir(data_dir)
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "features": features.SPREAD_FEATURES,
                 "weather_adjustment": metrics["weather_adjustment"],
                 "version": f"spread-{metrics['trained_at'][:10]}", "sklearn_version": sklearn.__version__,
                 "metrics": metrics}, out / features.SPREAD_FILE, compress=3)
    (out / "spread_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("--small-fires", type=int, default=300_000,
                        help=f"random sources with fewer than {BIG_FIRE} detections (all larger ones are used)")
    parser.add_argument("--seed", type=int, default=20261114)
    args = parser.parse_args()
    print(json.dumps(run(args.data_dir, args.small_fires, args.seed), indent=2))


if __name__ == "__main__":
    main()
