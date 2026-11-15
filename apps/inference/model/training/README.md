# model/training

Status (2026-11-15): `train_occurrence.py` and `train_spread.py` write artifacts and metrics to `data/models`. See `docs/handover/models.md`. The points below describe the agreed latent-state model, which is still not trainable.

- **Input:** historical bundles (see `../../harmonization/README.md`) plus outcome labels from NIFC / WFIGS.
- **Output:** a versioned model artifact for `inference/`, stored outside git.

## Ready to use

- FIRMS archive: 21.0 M detections, five sensors, in `data/firms_harmonized` (gitignored). Load with `read_harmonized` in `sources/firms/archive.py`. See `docs/handover/firms-harmonization.md`.

## Missing

- Labels: the NIFC / WFIGS feed is unverified (endpoints, fields, history depth).
- Historical weather and fuels matching the live features (see harmonization).
- Per-sensor overpass coverage, so "no detection" can be told apart from "not observed" (model outline).

## Open questions

- How NIFC / WFIGS incidents and perimeters become per-cell labels, and what counts as a non-fire cell. Direction, rate of spread and perimeter need day-over-day perimeters (Mendeley dataset: western US only, 737 fires).
- Train on near-real-time or science-quality FIRMS data.
- Where model artifacts are stored.
