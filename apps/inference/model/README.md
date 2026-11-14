# model

Work item 3: training and inference.

- `training/`: fits the model on historical bundles paired with historical fire outcomes.
- `inference/`: runs the fitted model on the real-time bundle.

Target outputs: burn probability, spread direction, rate of spread, perimeter.
Structure: `docs/handover/model-outline.md` (latent fire state with per-sensor likelihoods, agreed 2026-11-14).
