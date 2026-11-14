# model/training

- **Input:** historical bundles from `harmonization` plus outcome labels from NIFC / WFIGS.
- **Output:** a versioned model artifact for `inference/`.

## Open questions

- How NIFC / WFIGS incidents and perimeters become per-cell labels, and what counts as a non-fire cell. Direction, rate of spread and perimeter need day-over-day perimeters (Mendeley dataset: western US only, 737 fires).
- Train on near-real-time or science-quality FIRMS data.
- Where model artifacts are stored (not in git).
