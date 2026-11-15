"""Estimator pieces that are pickled into the artifacts.

They live in an importable module (not a training script run as `__main__`)
so inference can unpickle them.
"""
from __future__ import annotations

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

from model import features

SKEWED = [*features.FIRE_HISTORY, "om_precip_sum"]  # counts and rain: log1p before the linear model


def log_skewed(frame):
    frame = frame.copy()
    frame[SKEWED] = np.log1p(frame[SKEWED])
    return frame


def make_occurrence_estimator(kind: str, seed: int):
    if kind == "logistic":
        return make_pipeline(FunctionTransformer(log_skewed), StandardScaler(), LogisticRegression(max_iter=2000))
    if kind == "boosted":
        return HistGradientBoostingClassifier(
            max_iter=300, learning_rate=0.05, max_leaf_nodes=15, l2_regularization=1.0,
            early_stopping=False, random_state=seed)
    raise ValueError(f"Unknown model kind: {kind}")


def shift_prior(score, sample_rate: float, base_rate: float):
    """Move a probability learned at `sample_rate` positives to a population with `base_rate`."""
    score = np.clip(np.asarray(score, dtype="float64"), 1e-9, 1 - 1e-9)
    odds = score / (1 - score) * (base_rate / (1 - base_rate)) / (sample_rate / (1 - sample_rate))
    return odds / (1 + odds)
