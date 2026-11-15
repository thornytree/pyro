# harmonization

Work item 2: turns source data into model features.

## Status (2026-11-15)

Not started. Part of the original scope moved: the orchestrator's fan-out (`apps/orchestrator/src/fan-out/`) now fetches all sources for a request and aligns them to one common grid (28 x 28 cells, about 1 km, over a 300-square-mile region centred on the point). That normalized `dataBundle` is the live input.

## What is left here

- **Features from a bundle.** Map `dataBundle` fields (detections, current and hourly weather, Daymet history, terrain, fuels) to model inputs per cell and time step. Live and training must use this same code.
- **Historical bundles for training.** Build bundles for past dates and tiles: FIRMS from the harmonized archive (`sources/firms/archive.py`), historical weather, and LANDFIRE fuels from the matching vintage. Either call the orchestrator's fan-out with past dates or port the needed parts to Python.
- **Missing data.** Every source can return nulls per cell. Record which sources were present so the model can tell "missing" from "no fire".

## Open questions

- Model cell size and time step. The fan-out grid (about 1 km) is the obvious candidate.
- Live weather is NOAA RRFS through Open-Meteo, which has little history. Which historical weather product trains the model, and how far does it differ from RRFS on an overlapping period?
- Behaviour when a source fails: the orchestrator currently fails the whole request (502) if any of the five sources fails.
