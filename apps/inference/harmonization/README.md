# harmonization

Work item 2: turns source data into model features.

## Status (2026-11-15)

Training table built (see "Compiled training table" below); features from a live bundle not started. Part of the original scope moved: the orchestrator's fan-out (`apps/orchestrator/src/fan-out/`) now fetches all sources for a request and aligns them to one common grid (28 x 28 cells, about 1 km, over a 300-square-mile region centred on the point). That normalized `dataBundle` is the live input.

## What is left here

- **Features from a bundle.** Map `dataBundle` fields (detections, current and hourly weather, Daymet history, terrain, fuels) to model inputs per cell and time step. Live and training must use this same code.
- **Historical bundles for training.** Build bundles for past dates and tiles: FIRMS from the harmonized archive (`sources/firms/archive.py`), historical weather, and LANDFIRE fuels from the matching vintage. Either call the orchestrator's fan-out with past dates or port the needed parts to Python.
- **Missing data.** Every source can return nulls per cell. Record which sources were present so the model can tell "missing" from "no fire".

## Open questions

- Model cell size and time step. The fan-out grid (about 1 km) is the obvious candidate.
- Live weather is NOAA RRFS through Open-Meteo, which has little history. Which historical weather product trains the model, and how far does it differ from RRFS on an overlapping period?
- Behaviour when a source fails: the orchestrator currently fails the whole request (502) if any of the five sources fails.

## Compiled training table (2026-11-15)

`compile_dataset.py` joins the four downloaded sources per 10 km cell-day and writes the model-input subsets:

```bash
python -m harmonization.compile_dataset ../../data
```

- Output: `data/training/compiled/` with `train.csv.gz`, `validation.csv.gz`, `test.csv.gz` (60/20/20), `dataset.csv.gz` (all rows, including excluded ones and why), `columns.json` (which columns are model inputs) and `summary.json`.
- Rows: the cell-days that have Open-Meteo weather. Rows missing any source are excluded from the three subsets: 2026 dates (Daymet ends 2025-12-31) and water cells Daymet has no data for.
- Split: by date, not random, so validation and test are later than train. `--split-by random` and `--ratios` change that.
- Target: `fire` (1 = a vegetation-fire detection that day, 0 = sampled background). `label_*` columns describe the same day and must not be used as inputs.
- LANDFIRE is read from the 240 m pyramid level of each `.tif.ovr` (`sources/topography/landfire.py`), because the full-resolution files are LZW-compressed and no GDAL is installed.
- Rerunning after more Open-Meteo days have been fetched: add `--force`.
- Full description: `docs/handover/compiled-dataset.md`.
