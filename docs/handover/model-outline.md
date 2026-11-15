# Model outline

Status: structure agreed on 2026-11-14 (latent fire state with per-sensor likelihoods). The model itself is not implemented; the harmonized FIRMS training data is ready (see `firms-harmonization.md`).

## Idea

Treat "is there a wildfire in this grid cell at this time" as a hidden variable. Weather and fuels set how likely fire is before we look at satellites. Each satellite feed is a separate, imperfect witness. The model combines them and returns a probability per cell.

## Structure

- **Grid:** CONUS divided into fixed 50 km x 50 km tiles. The model runs per active tile, on cells inside it, in fixed time steps. Cell size and time step are undecided.
- **Latent state:** `fire[cell, t]`, Bernoulli.
- **Prior:** `P(fire)` from a regression on
  - Open-Meteo: wind, gusts, relative humidity, vapour pressure deficit, soil moisture, recent precipitation, temperature
  - LANDFIRE: fuel model, canopy, slope, aspect, elevation
  - previous state of the cell and its neighbours (this is the hook for the later spread model)
- **Observations:** one likelihood per FIRMS source (MODIS, VIIRS S-NPP, VIIRS NOAA-20, VIIRS NOAA-21, Landsat). Each has its own
  - detection probability given fire
  - false-alarm probability given no fire
  - both can depend on the detection's reported confidence and FRP
- **No overpass is not a negative.** Polar orbiters see a cell only a few times a day. A cell with no detection because no satellite passed must be treated as unobserved, not as "no fire". This needs overpass times or a per-source observation mask.
- **Output:** posterior `P(fire[cell, t])` for the heat map, plus its uncertainty.
- **Serving (2026-11-15):** the orchestrator builds a normalized `dataBundle` for a 300-square-mile region on a 28 x 28 (about 1 km) grid and will POST it to the inference service. Neither the service nor the call exists yet; see `apps/inference/model/inference/README.md`.

## Training

- Detections: FIRMS archive, harmonized into `data/firms_harmonized` (21.0 M detections, five sensors). Load with `read_harmonized` in `apps/inference/sources/firms/archive.py`. Every sensor has a 0/1/2 confidence class; Landsat has no FRP or brightness, so FRP-dependent likelihood terms need a fallback for it. About 12% of rows are flagged non-fire (volcano, static source, offshore) and should be filtered or modelled separately. Landsat has no such flag; see the Landsat assessment in `decisions.md` before setting its false-alarm prior.
- Weather: Open-Meteo Historical Weather API for the same dates and cells. Note (2026-11-15): live weather is now NOAA RRFS via Open-Meteo, which has little history; check that the training product matches it on an overlapping period, or pick another.
- Labels: NIFC / WFIGS incident locations and perimeters (decided 2026-11-14, feed details unverified). They anchor the per-sensor detection and false-alarm rates. A cell with no WFIGS incident is not proof of no fire, because small fires can go unreported.
- Inference: stochastic variational inference in Pyro is the default choice; revisit if the grid makes it too slow.
- First training table (2026-11-15): 8,071 cell-days on a 10 km daily grid with FIRMS history, Open-Meteo, Daymet and LANDFIRE topography, split 60/20/20 by date; see `compiled-dataset.md`. It fits a plain classifier of "any FIRMS detection that day" from weather, terrain and fire history. It does not yet fit the structure above: there is one target instead of per-sensor observations, no WFIGS labels, no overpass mask and no fuels.

## Decisions needed

1. Model cell size inside a tile, and time step (drives data volume and API call counts). Training data is on 10 km daily cells; the live bundle is about 1 km.
2. Train on NRT or science-quality detections (see risks doc)
3. How to get overpass coverage per source (required by the agreed structure)
4. How WFIGS incidents and perimeters are rasterized into per-cell labels

## Later: spread prediction

Extend the neighbour term in the prior with wind direction and slope so probability flows downwind and uphill. Validate against the Mendeley daily perimeter dataset.

## Update 2026-11-14

- First target is burn probability. Spread direction, rate and perimeter are a proof of concept on fires with perimeter data (see `decisions.md`).
- The model runs per active tile, not across all of CONUS.
- Daymet is a training-only input.
- Decided: the model arbitrates between sensors as outlined above. Tiles are 50 km, coverage is all of CONUS, and labels come from NIFC / WFIGS (decisions 6 to 9 in `decisions.md`).
