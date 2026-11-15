# Training

Implemented in `train.py`. From the repository root:

```bash
uv run --directory apps/inference python -m model.training.train --data training/compiled
```

Inputs are the supplied `train.csv.gz`, `validation.csv.gz`, `test.csv.gz` and
`columns.json`. The compiled table has 8,071 usable cell-days. Only the 18 features
listed in `model/features.py` are used; same-day target detail and other unavailable
serving features are excluded. Existing chronological splits are preserved.

Five bootstrap members are fitted per candidate (logistic regression and two
small gradient-boosted families). Validation average precision selects the family;
a validation F1 threshold is reported for evaluation only. Test data never guides
selection, and serving returns scores rather than applying that threshold.

Outputs are `model/artifacts/baseline.joblib` (ignored) and `report.json`. The report
records split-specific metrics, dates, seed, library version and input hashes.
The selected 15-leaf boosting family achieves test ROC-AUC 0.758 and average
precision 0.759, versus constant-score AP 0.509 on this balanced sample.

The label is daily FIRMS detection, not WFIGS-confirmed wildfire or burned area.
Scores do not estimate population prevalence. No spatial or prospective forecast
holdout was performed. Read [all limitations](../../README.md) before comparing
these metrics to a future spread or calibrated probability model.
