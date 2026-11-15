"""Load the trained artifacts once per process."""
from __future__ import annotations

from functools import lru_cache

import logging

import joblib
import numpy as np
import sklearn

from model import features


class ModelNotTrained(RuntimeError):
    """An artifact is missing: run the training scripts (see model/training/README.md)."""


def _path(name: str):
    path = features.model_dir() / name
    if not path.exists():
        raise ModelNotTrained(f"{path} not found. Train the models first: see apps/inference/model/training/README.md")
    return path


def _load(name: str) -> dict:
    artifact = joblib.load(_path(name))
    if artifact.get("sklearn_version") != sklearn.__version__:
        logging.getLogger(__name__).warning(
            "%s was trained with scikit-learn %s but %s is installed; retrain it if predictions fail or look wrong.",
            name, artifact.get("sklearn_version"), sklearn.__version__)
    return artifact


@lru_cache(maxsize=None)
def occurrence() -> dict:
    return _load(features.OCCURRENCE_FILE)


@lru_cache(maxsize=None)
def spread() -> dict:
    return _load(features.SPREAD_FILE)


@lru_cache(maxsize=None)
def fire_days() -> np.ndarray:
    """Sorted packed (cell, day) keys of every fire cell-day in the FIRMS archive."""
    return np.load(_path(features.FIRE_DAYS_FILE))
