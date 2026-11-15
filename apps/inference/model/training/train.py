"""Train a small baseline without touching the held-out test set during selection.

uv run python -m model.training.train --data training/compiled
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, f1_score, log_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits

from model.features import FEATURES

SEED = 20261114


def metrics(y, scores, threshold=0.5):
    return {
        "rows": len(y), "positive_fraction": float(np.mean(y)),
        "roc_auc": float(roc_auc_score(y, scores)),
        "average_precision": float(average_precision_score(y, scores)),
        "brier": float(brier_score_loss(y, scores)), "log_loss": float(log_loss(y, scores)),
        "f1": float(f1_score(y, scores >= threshold)),
    }


def estimator(name, seed):
    if name == "logistic":
        return make_pipeline(StandardScaler(), LogisticRegression(C=0.3, max_iter=2000, random_state=seed))
    return HistGradientBoostingClassifier(
        max_iter=180, learning_rate=0.05, max_leaf_nodes=7 if name == "hgb7" else 15,
        min_samples_leaf=40, l2_regularization=10, early_stopping=False, random_state=seed,
    )


def mean_score(models, frame):
    return np.mean([model.predict_proba(frame)[:, 1] for model in models], axis=0)


def train(data: Path, output: Path, report_path: Path):
    frames = {name: pd.read_csv(data / f"{name}.csv.gz") for name in ("train", "validation", "test")}
    roles = json.loads((data / "columns.json").read_text())
    if any(roles.get(name) != "feature" for name in FEATURES):
        raise ValueError("Model inputs must be declared feature columns, never label detail")
    for name, frame in frames.items():
        if not frame["fire"].isin([0, 1]).all() or frame["fire"].nunique() != 2:
            raise ValueError(f"{name} must contain both binary classes")
        if not np.isfinite(frame[FEATURES].to_numpy()).all():
            raise ValueError(f"Missing or non-finite {name} features")
        if frame.duplicated(["date", "cell_row", "cell_col"]).any():
            raise ValueError(f"Duplicate {name} cell-days")
    if not (frames["train"].date.max() < frames["validation"].date.min() and
            frames["validation"].date.max() < frames["test"].date.min()):
        raise ValueError("Expected non-overlapping chronological splits")
    x, y = frames["train"][FEATURES], frames["train"].fire.to_numpy()
    candidates, fitted = {}, {}
    for name in ("logistic", "hgb7", "hgb15"):
        models = []
        for member in range(5):
            rng = np.random.default_rng(SEED + member)
            indices = rng.integers(0, len(x), size=len(x))
            model = estimator(name, SEED + member)
            model.fit(x.iloc[indices], y[indices])
            models.append(model)
        score = mean_score(models, frames["validation"][FEATURES])
        candidates[name] = metrics(frames["validation"].fire, score)
        fitted[name] = models
    winner = max(candidates, key=lambda name: candidates[name]["average_precision"])
    models = fitted[winner]
    val_scores = mean_score(models, frames["validation"][FEATURES])
    thresholds = np.linspace(0.1, 0.9, 81)
    threshold = float(max(thresholds, key=lambda t: f1_score(frames["validation"].fire, val_scores >= t)))
    files = {name: hashlib.sha256((data / f"{name}.csv.gz").read_bytes()).hexdigest() for name in frames}
    version = f"daily-detection-v1-{files['train'][:8]}-{winner}"
    report = {
        "model_version": version, "created_at": datetime.now(timezone.utc).isoformat(),
        "target": "any_firms_detection_in_10km_cell_day", "score_kind": "sample_relative",
        "native_resolution_km": 10, "forecast_window_hours": 24,
        "features": FEATURES, "seed": SEED, "ensemble_members": 5,
        "selection": "highest validation average precision; test unused until final evaluation",
        "selected_family": winner, "validation_candidates": candidates,
        "threshold": threshold, "data_sha256": files,
        "dates": {name: {"first": f.date.min(), "last": f.date.max()} for name, f in frames.items()},
        "metrics": {name: metrics(f.fire, mean_score(models, f[FEATURES]), threshold) for name, f in frames.items()},
        "test_constant_baseline": metrics(frames["test"].fire, np.full(len(frames["test"]), y.mean()), threshold),
        "limitations": [
            "FIRMS detection labels are not confirmed wildfire or burned-area labels.",
            "Balanced sampled backgrounds: scores are not calibrated population burn probabilities.",
            "Retrospective daily weather differs from live rolling-24h RRFS forecasts.",
            "10 km model cells are displayed on a finer grid; no added spatial skill is implied.",
            "Partial native cells use only the weather samples within the selected region.",
            "No spread direction, speed, perimeter or overpass-coverage model.",
        ],
        "sklearn_version": sklearn.__version__,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"models": models, "metadata": report}, output)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", type=Path, default=Path("training/compiled"))
    parser.add_argument("--output", type=Path, default=Path("model/artifacts/baseline.joblib"))
    parser.add_argument("--report", type=Path, default=Path("model/training/report.json"))
    args = parser.parse_args()
    with threadpool_limits(limits=1):
        report = train(args.data, args.output, args.report)
    print(json.dumps({"model": report["model_version"], "metrics": report["metrics"]}, indent=2))


if __name__ == "__main__":
    main()
