"""Model 1: probability that a 10 km cell has a satellite fire detection on a day.

    python -m model.training.train_occurrence ../../data

Reads the compiled train / validation / test table and writes
`<data>/models/occurrence.joblib`, `occurrence_metrics.json` and the fire-day
index (`fire_days.npy`) that inference uses for the fire-history inputs.

This is the prior term of the agreed latent-state model (decision 9): fire
probability from weather, terrain and fire history, before any per-sensor
likelihood is applied. See docs/handover/models.md.
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
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

from harmonization.compile_dataset import EPOCH
from model import features
from model.estimators import make_occurrence_estimator
from model.training.fire_days import read_fire_cell_days

BASE_RATE_YEARS = 3  # the prior uses the most recent complete years (all five sensors flying)


def fit_ensemble(kind: str, frame: pd.DataFrame, members: int, seed: int) -> list:
    """Bootstrap-resampled copies of one estimator; their spread is the model's uncertainty."""
    rng = np.random.default_rng(seed)
    models = []
    for member in range(members):
        rows = frame.iloc[rng.integers(0, len(frame), len(frame))]
        models.append(make_occurrence_estimator(kind, seed + member).fit(rows[features.OCCURRENCE_FEATURES], rows["fire"]))
    return models


def ensemble_scores(models: list, frame: pd.DataFrame) -> np.ndarray:
    """(members, rows) probabilities on the balanced training scale."""
    x = frame[features.OCCURRENCE_FEATURES]
    return np.stack([model.predict_proba(x)[:, 1] for model in models])


def score_metrics(y, score) -> dict:
    bins = pd.cut(score, np.linspace(0, 1, 6), include_lowest=True)
    table = pd.DataFrame({"y": np.asarray(y), "score": score}).groupby(bins, observed=True).agg(
        rows=("y", "size"), mean_score=("score", "mean"), fire_share=("y", "mean"))
    return {
        "rows": int(len(y)), "auc": round(float(roc_auc_score(y, score)), 4),
        "brier": round(float(brier_score_loss(y, score)), 4),
        "log_loss": round(float(log_loss(y, score)), 4),
        "accuracy_at_0.5": round(float(((score >= 0.5) == np.asarray(y)).mean()), 4),
        "reliability": [{"bin": str(k), **{c: round(float(v), 4) for c, v in row.items()}}
                        for k, row in table.iterrows()],
    }


def base_rate(fire_days: pd.DataFrame, n_cells: int, last_day: pd.Timestamp) -> dict:
    """Share of cell-days with fire over the last complete years, among cells that ever burned."""
    end = pd.Timestamp(year=last_day.year, month=1, day=1)
    start = end - pd.DateOffset(years=BASE_RATE_YEARS)
    day = fire_days["day"].to_numpy()
    n = int(((day >= (start - EPOCH).days) & (day < (end - EPOCH).days)).sum())
    return {"value": n / (n_cells * (end - start).days), "from": str(start.date()), "to": str(end.date()),
            "fire_cell_days": n, "cells": n_cells}


def run(data_dir: Path, members: int, seed: int) -> dict:
    compiled = data_dir / "training" / "compiled"
    train, validation, test = (pd.read_csv(compiled / f"{name}.csv.gz") for name in ("train", "validation", "test"))

    selection = {}
    for kind in ("logistic", "boosted"):
        score = ensemble_scores(fit_ensemble(kind, train, members, seed), validation).mean(0)
        selection[kind] = score_metrics(validation["fire"], score)
    kind = min(selection, key=lambda k: selection[k]["log_loss"])

    fitted = pd.concat([train, validation], ignore_index=True)
    models = fit_ensemble(kind, fitted, members, seed)
    test_scores = ensemble_scores(models, test)

    fire_days = read_fire_cell_days(data_dir / "training" / "firms_cell_day")
    n_cells = len(pd.read_csv(data_dir / "training" / "cells.csv.gz", usecols=["cell_row", "cell_col"]).drop_duplicates())
    archive_end = EPOCH + pd.Timedelta(days=int(fire_days["day"].max()))
    prior = base_rate(fire_days, n_cells, archive_end)
    sample_rate = float(fitted["fire"].mean())

    metrics = {
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "kind": kind, "members": members, "seed": seed, "features": features.OCCURRENCE_FEATURES,
        "fit_rows": int(len(fitted)), "fit_dates": [str(fitted["date"].min()), str(fitted["date"].max())],
        "selection_on_validation": selection,
        "test": score_metrics(test["fire"], test_scores.mean(0)),
        "test_dates": [str(test["date"].min()), str(test["date"].max())],
        "test_member_spread_mean": round(float(test_scores.std(0).mean()), 4),
        "sample_rate": round(sample_rate, 4), "base_rate": prior,
        "fire_archive_end": str(archive_end.date()),
    }
    out = features.model_dir(data_dir)
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump({
        "models": models, "features": features.OCCURRENCE_FEATURES, "kind": kind,
        "sample_rate": sample_rate, "base_rate": prior["value"],
        "version": f"occurrence-{metrics['trained_at'][:10]}-{kind}",
        "sklearn_version": sklearn.__version__, "metrics": metrics,
    }, out / features.OCCURRENCE_FILE, compress=3)
    np.save(out / features.FIRE_DAYS_FILE, fire_days["key"].to_numpy())
    (out / "occurrence_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("--members", type=int, default=20, help="bootstrap models in the ensemble")
    parser.add_argument("--seed", type=int, default=20261114)
    args = parser.parse_args()
    metrics = run(args.data_dir, args.members, args.seed)
    print(json.dumps({k: metrics[k] for k in ("kind", "fit_rows", "selection_on_validation", "test", "base_rate")},
                     indent=2))


if __name__ == "__main__":
    main()
