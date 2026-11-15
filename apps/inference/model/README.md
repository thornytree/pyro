# model

Work item 3: training and inference.

- `training/`: fits the model on historical bundles paired with historical fire outcomes.
- `inference/`: runs the fitted model on the live bundle the orchestrator sends.

Target outputs: burn probability with uncertainty first (decision 3). Spread direction, rate and perimeter later; the web app already has an experimental spread display driven by a mock formula.

Structure: `docs/handover/model-outline.md` (latent fire state with per-sensor likelihoods, agreed 2026-11-14).

Status (2026-11-15): not started. See `../README.md` for the order of work.
