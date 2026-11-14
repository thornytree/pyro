# Model outline (proposal)

Status: proposed on 2026-11-14, not yet agreed by the team. Nothing here is implemented.

## Idea

Treat "is there a wildfire in this grid cell at this time" as a hidden variable. Weather and fuels set how likely fire is before we look at satellites. Each satellite feed is a separate, imperfect witness. The model combines them and returns a probability per cell.

## Structure

- **Grid:** CONUS divided into fixed cells, time in fixed steps. Cell size and step are undecided.
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

## Training

- Detections: FIRMS archive
- Weather: Open-Meteo Historical Weather API for the same dates and cells
- Labels: undecided, see risks doc. Without labels the per-sensor rates are only identifiable from sensor agreement.
- Inference: stochastic variational inference in Pyro is the default choice; revisit if the grid makes it too slow.

## Decisions needed

1. Cell size and time step (drives data volume and API call counts)
2. Label source
3. Train on NRT or science-quality detections (see risks doc)
4. How to get overpass coverage per source
5. Whether the hackathon demo covers all of CONUS or one region (for example California) at higher resolution

## Later: spread prediction

Extend the neighbour term in the prior with wind direction and slope so probability flows downwind and uphill. Validate against the Mendeley daily perimeter dataset.

## Update 2026-11-14

- First target is burn probability. Spread direction, rate and perimeter are a proof of concept on fires with perimeter data (see `decisions.md`).
- The model runs per active tile, not across all of CONUS.
- Daymet is a training-only input.
- Still open: whether the model arbitrates between sensors as outlined above, or takes the harmonized bundle as plain features.
