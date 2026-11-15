# Fan-out

The Express request path fetches all five providers concurrently for a centered
300-square-mile region. It returns observations and a normalized bundle after all
providers succeed. Environment loading, validation and HTTP routes are documented
in `../../README.md`.

## Optional scheduled-ingestion path

The merge from main also retains `grid.ts`, `scheduler.ts`, `requestTileAt` (in `request-tile.ts`),
`fetchFirmsNationwide` and `getTileWeather`. These form a separate fixed 50 km
EPSG:5070 grid path, matching the Python grid in `apps/inference/shared/grid.py`.
It supports nationwide polling of MODIS, VIIRS and Landsat, plus weather refresh
for active tiles. Detections now carry that grid's `tile_id` where available;
Landsat has null FRP and nominal 30 m pixel sizes.

This scheduler is not started by Express: enabling it must be an explicit choice.
Its 50 km tile frame does not replace the requested 300-square-mile region or the
request-driven HTTP contract. Regional FIRMS requests retain the four MODIS/VIIRS
feeds; the optional nationwide snapshot includes Landsat as its fifth feed.

## Current prototype

`fanOutEntry(lat, long, options)` fetches weather, FIRMS, Daymet, USGS 3DEP and LANDFIRE concurrently
and returns a typed `dataBundle` only after all five succeed. FIRMS uses a 300-square-mile box centered on the
point. Scheduled ingestion remains a proposal. Express now exposes the observation
response through `GET /tiles`; see the orchestrator README for the current contract.

## Weather adapters

```ts
// NOAA forecasts, FIRMS, historical Daymet, 3DEP terrain and LANDFIRE, concurrently.
const bundle = await fanOutEntry(34.05, -118.25, {
  forecastHours: 24,
  daymet: { startDate: "2020-07-01", endDate: "2020-07-31" },
});

// The Daymet adapter can also be called separately for training.
const history = await getDaymetAttributes(34.05, -118.25, "2020-07-01", "2020-07-31");
```

Import these functions from `fan-out-entry.ts` and `daymet.ts`, respectively.
All adapters use the centered 300-square-mile box defined in `region.ts`.
The shared output grid has 28 x 28 cells, approximately 1 km apart, ordered north
to south then west to east. This is a sampling grid, not the frontend tile-ID scheme.

`meteo.ts` requests NOAA RRFS CONUS explicitly via Open-Meteo. It batches 101
locations (100 regional samples plus the selected point) into three HTTP requests,
each carrying at most 50 locations. Multi-location requests can still count as
multiple calls against provider quotas. Hourly and current data include temperature,
humidity, wind speed/direction/gusts, precipitation, vapor pressure deficit and solar
radiation. Current values are weather-model estimates, not station observations.
`weather_grid.cells[].sample_index` maps output cells to entries in `samples`.
Those entries preserve requested and provider-resolved coordinates and timestamps.
Nearest-sample mapping does not increase the underlying 3 km weather resolution.

`daymet.ts` uses NASA Earthdata's current Hyrax OPeNDAP service, not the retired
THREDDS/NCSS endpoints. It fetches grid axes, projection and time metadata once per
year (cached), transforms the geographic region to native Daymet LCC indices, then
requests seven regional NetCDF3 subsets concurrently using DAP4 constraints. This
is eight requests on a cold year and seven once its metadata is cached. Supply an explicit historical date
range and set `EARTHDATA_TOKEN` in the server environment for authorized NASA
Earthdata access. This is a different credential from `FIRMS_MAP_KEY`. The adapter
sends the token as a Bearer authorization header. Dataset availability is checked
by the upstream API; unavailable recent dates fail rather than falling back to an
older year. Express loads the server `.env`; standalone adapter calls require environment
setup by their caller. Credential acquisition is manual.

Historical data goes under `historical_weather`. Each native Daymet grid retains
coordinates, units, daily date labels and time-major values; missing and out-of-area
cells are `null`. Daymet omits December 31 in leap years; dates come from the file,
so no synthetic day is inserted. `sample_indices` maps each common output cell to
a native source cell. For day `d` and common cell `c`, read
`values[d * rows * columns + sample_indices[c]]`. Dates describe daily periods,
not instantaneous UTC observations. Daymet vapor pressure (Pa) is different from
Open-Meteo vapor pressure deficit (kPa); derive matching training features explicitly.

The live NOAA path was checked with a two-hour regional request. Daymet decoding
is tested with a small synthetic NetCDF3 fixture; a live authenticated Daymet download
still needs to be verified with an authorized Earthdata account.

References: [Daymet regional service](https://daymet.ornl.gov/web_services),
[ORNL regional examples](https://github.com/ornldaac/gridded_subset_example_script),
[NOAA models through Open-Meteo](https://open-meteo.com/en/docs/gfs-api).

Fan-out requires `options.daymet.startDate` and `endDate`; historical dates are never
chosen automatically. `observation_time` is the current weather reference timestamp;
FIRMS detections and Daymet daily records retain their own timestamps/date labels.
Terrain now comes from 3DEP and vegetation/fuels from LANDFIRE; individual missing
pixels remain `null`.
`FIRMS_MAP_KEY` and authorized `EARTHDATA_TOKEN` are needed for the combined path.

## Terrain and fuels adapters

`getTerrainAttributes(lat, long)` in `terrain.ts` fetches raw USGS 3DEP elevations
at approximately 30 m spacing, with a one-pixel boundary buffer. It derives slope
and downhill aspect with the Horn 3x3 gradient, using horizontal distances in
metres rather than degrees. Elevation is in metres; slope and aspect are in degrees.
Flat terrain has slope 0 and aspect `null`. Missing neighbours produce unknown
slope/aspect rather than invented zeros. Results are sampled at common-grid cell
centres; they are not 1 km cell averages. `terrain.elevation_m`, `slope_degrees` and
`aspect_degrees` describe the selected point; `terrain.grid.cells` covers the region.
The 30 m value is the requested DEM sampling interval, not a promise about the
native resolution or accuracy of the underlying multi-resolution 3DEP sources.

`getVegetationAttributes(lat, long, { version: "LF2025" })` in `landfire.ts` fetches
six versioned CONUS LANDFIRE products: FBFM40, EVT, CC, CH, CBH and CBD. Raw numeric
GeoTIFF exports disable display rendering. Nearest-neighbour sampling preserves
fuel and vegetation category codes, including non-burnable fuel classes. The cells
are point samples from approximately 30 m source products, not dominant fuel types
or canopy averages across 1 km cells. CH and CBH are divided by 10 to obtain metres;
CBD is divided by 100 to obtain kg/m3; CC remains percent. Forest canopy zeros are
valid non-forested values, distinct from missing pixels. Fuel codes use the Scott
and Burgan 40 system; EVT codes require the selected version's attribute dictionary.

Both adapters run in `fanOutEntry` and fail the combined request on API or unusable
raster errors. These public ImageServer APIs require no additional API key. The
shared `raster.ts` decoder verifies numeric single-band WGS84 rasters, requested
extent and dimensions. It caches up to 16 requests in memory for 24 hours, shares
in-flight requests and evicts failures. Restarting clears the cache. `fetched_at`
records download/decode time and is preserved on cache hits; for LANDFIRE it is the
earliest fetch time among its six layers. It is not the source observation date.

Pass `landfireVersion` through fan-out options to override the pinned LF2025 default
(supported: LF2020, LF2022, LF2023, LF2024, LF2025). Historical model training must
select appropriate fuel-layer vintages; a current fuel map does not describe past
conditions just because it is combined with historical Daymet weather.

Both complete adapters were tested against the live APIs near Los Angeles. Unit
checks also use synthetic georeferenced rasters and analytic terrain planes.

References: [USGS 3DEP ImageServer](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer),
[LANDFIRE versioned services](https://lfps.usgs.gov/arcgis/rest/services),
[canopy height units](https://landfire.gov/fuel/ch),
[canopy scaling](https://landfire.gov/sites/default/files/documents/LFTFC_User_Guide_2020.pdf).

## Failure diagnostics

Fan-out wraps each provider failure with a source name and a fixed safe reason.
Only Open-Meteo is required, because it defines the grid and feeds the model. If FIRMS,
Daymet, USGS 3DEP or LANDFIRE fails, its bundle field is null and the failure is added to
`source_failures`; the other sources are still returned.
Express 502 responses (Open-Meteo failures) include `source`, `reason`, optional `upstreamStatus`, and a
credential-free message. Raw errors, URLs, headers and nested causes are never
serialized to the client. The server logs only the same constructed message.
Open-Meteo connection failures receive one bounded retry; invalid data is not retried.

The replacement Daymet service and its spatial-index constraints are documented
by [ORNL DAAC](https://forum.earthdata.nasa.gov/viewtopic.php?t=7585).
The complete July 1–3, 2020 subset near Los Angeles was verified with Earthdata
credentials after migration. The small `daymet-axes.nc` test fixture contains only
public dataset coordinate/projection/time metadata, not user credentials.
