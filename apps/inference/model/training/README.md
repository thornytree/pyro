# model/training

- **Input:** historical bundles from `harmonization` plus outcome labels.
- **Output:** a versioned model artifact for `inference/`.

## Open questions

- Label source per target. Burn probability needs confirmed fires and non-fire cells. Direction, rate of spread and perimeter need day-over-day perimeters (Mendeley dataset: western US only, 737 fires).
- Train on near-real-time or science-quality FIRMS data.
- Where model artifacts are stored (not in git).
