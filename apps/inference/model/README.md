# Model

The first supervised baseline is trained and exposed through FastAPI. It uses
five bootstrap gradient-boosted classifiers selected using the supplied temporal
validation split, with 18 location/season/weather features shared by training and
serving. Test ROC-AUC is 0.758 on 1,609 held-out cell-days.

It predicts a relative daily FIRMS-detection score on native 10 km cells, repeated
on the frontend's finer display grid. It is not calibrated burn probability or a
spread model. The planned latent-sensor Pyro model remains future work.

- `features.py`: serving-compatible feature definitions and native-grid mapping.
- `schema.py`: consumed input schema and grid/time validation.
- `training/train.py`: reproducible fitting, selection, held-out evaluation.
- `training/report.json`: versioned metrics, inputs, data hashes and limitations.
- `inference/predict.py`: artifact loading and GeoJSON output.
- `../app.py`: FastAPI `/health` and `POST /predict`.
- `artifacts/baseline.joblib`: local trained ensemble; ignored by Git.

See [service instructions](../README.md) for commands, API semantics and limits.
