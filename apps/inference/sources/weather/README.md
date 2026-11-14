# sources/weather

Work item 2: meteorological data for the target area.

- **Provider:** Open-Meteo (decided, see `docs/handover/data-sources.md`).
- **Input:** coordinates or grid cells, time range.
- **Output:** wind speed and direction, gusts, relative humidity, vapour pressure deficit, soil moisture, precipitation, temperature.

## Notes

- Use the forecast API for live data and the Historical Weather API for training dates.
- Request RRFS or best match. HRRR is discontinued on 2026-11-30.
- Free-tier call cap is unverified. Check before polling many points.
