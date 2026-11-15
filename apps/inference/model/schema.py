"""Validate the bundle fields used by this model; unrelated source fields are ignored."""
from datetime import timedelta
from typing import Annotated

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, FiniteFloat, model_validator

Latitude = Annotated[FiniteFloat, Field(ge=-90, le=90)]
Longitude = Annotated[FiniteFloat, Field(ge=-180, le=180)]


class Location(BaseModel):
    latitude: Latitude
    longitude: Longitude


class Bounds(BaseModel):
    west: Longitude
    east: Longitude
    south: Latitude
    north: Latitude

    @model_validator(mode="after")
    def ordered(self):
        if self.west >= self.east or self.south >= self.north:
            raise ValueError("Region bounds must be ordered")
        return self


class Hour(BaseModel):
    time: AwareDatetime
    temperature: FiniteFloat
    humidity: Annotated[FiniteFloat, Field(ge=0, le=100)]
    wind_speed_kph: Annotated[FiniteFloat, Field(ge=0)]
    wind_direction: Annotated[FiniteFloat, Field(ge=0, le=360)]
    precipitation_mm: Annotated[FiniteFloat, Field(ge=0)]
    wind_gusts_kph: Annotated[FiniteFloat, Field(ge=0)]
    vapour_pressure_deficit_kpa: Annotated[FiniteFloat, Field(ge=0)]


class WeatherSample(BaseModel):
    elevation_m: FiniteFloat
    hourly: list[Hour] = Field(min_length=24, max_length=72)

    @model_validator(mode="after")
    def contiguous(self):
        if any(b.time - a.time != timedelta(hours=1) for a, b in zip(self.hourly, self.hourly[1:])):
            raise ValueError("Weather must contain consecutive hourly forecasts")
        return self


class Cell(Location):
    sample_index: int = Field(ge=0)


class WeatherGrid(BaseModel):
    bounds: Bounds
    rows: int = Field(ge=1, le=200)
    columns: int = Field(ge=1, le=200)
    cells: list[Cell] = Field(min_length=1, max_length=20000)
    samples: list[WeatherSample] = Field(min_length=1, max_length=3000)

    @model_validator(mode="after")
    def aligned(self):
        if len(self.cells) != self.rows * self.columns:
            raise ValueError("Grid dimensions do not match its cells")
        reference = [hour.time for hour in self.samples[0].hourly[:24]]
        if any([hour.time for hour in sample.hourly[:24]] != reference for sample in self.samples):
            raise ValueError("Weather samples must share a forecast window")
        for index, cell in enumerate(self.cells):
            if cell.sample_index >= len(self.samples):
                raise ValueError("Grid refers to a missing weather sample")
            lat = self.bounds.north - (index // self.columns + 0.5) * (self.bounds.north - self.bounds.south) / self.rows
            lon = self.bounds.west + (index % self.columns + 0.5) * (self.bounds.east - self.bounds.west) / self.columns
            if abs(cell.latitude - lat) > 1e-6 or abs(cell.longitude - lon) > 1e-6:
                raise ValueError("Cells must be north-to-south, west-to-east grid centres")
        return self


class PredictionBundle(BaseModel):
    model_config = ConfigDict(extra="ignore")
    location: Location
    observation_time: AwareDatetime
    weather_grid: WeatherGrid

    @model_validator(mode="after")
    def selected_point(self):
        b, p = self.weather_grid.bounds, self.location
        if not (b.south <= p.latitude <= b.north and b.west <= p.longitude <= b.east):
            raise ValueError("Selected point must be inside the prediction region")
        return self
