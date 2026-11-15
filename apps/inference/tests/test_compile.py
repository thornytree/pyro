"""Tests for harmonization.compile_dataset and the LANDFIRE cell windows."""
import numpy as np
import pandas as pd

from harmonization import compile_dataset as compiled
from shared import grid
from sources.topography import landfire


def test_hourly_features_split_the_last_day_from_the_six_before():
    hourly = np.zeros((1, len(compiled.HOURLY), 168))
    temp, rain, wind, direction = (compiled.HOURLY.index(n) for n in (
        "temperature_2m", "precipitation", "wind_speed_10m", "wind_direction_10m"))
    hourly[0, temp, :144] = 10.0
    hourly[0, temp, 144:] = np.arange(24)
    hourly[0, rain, :144] = 0.5
    hourly[0, rain, 144:] = 1.0
    hourly[0, wind] = 2.0
    hourly[0, direction, 144:] = 90.0  # from the east
    out = compiled.hourly_features(hourly)
    assert out["om_temp_max"][0] == 23 and out["om_temp_min"][0] == 0
    assert out["om_temp_max_prev6d"][0] == 10
    assert out["om_precip_sum"][0] == 24 and out["om_precip_sum_prev6d"][0] == 72
    assert np.isclose(out["om_wind_from_sin"][0], 1) and np.isclose(out["om_wind_from_cos"][0], 0, atol=1e-9)


def test_daymet_index_has_no_31_december_in_leap_years():
    index = compiled.daymet_index(["2000-01-01", "2020-12-30", "2020-12-31", "2021-01-01"])
    assert index[0] == 0
    assert index[1] == index[2] == index[3] - 1


def test_daymet_point_uses_days_before_the_date_and_blanks_what_it_cannot_reach():
    series = np.zeros((200, 4))
    series[:, 0] = np.arange(200)       # prcp: 0, 1, 2, ...
    series[:, 1], series[:, 2] = 20.0, 10.0
    series[:, 3] = 1000.0
    point = compiled.daymet_point(series, 100)
    assert point["dm_prcp"] == 100
    assert point["dm_prcp_sum_prev7d"] == sum(range(93, 100))
    assert point["dm_dry_days"] == 0
    assert np.isclose(point["dm_vpd"], (compiled.saturation_kpa(20) + compiled.saturation_kpa(10)) / 2 - 1.0)
    assert np.isnan(compiled.daymet_point(series, 50)["dm_prcp_sum_prev90d"])
    past_end = compiled.daymet_point(series, 200)
    assert np.isnan(past_end["dm_prcp"]) and past_end["dm_prcp_sum_prev7d"] == sum(range(193, 200))
    assert np.isnan(compiled.daymet_point(series, 201)["dm_prcp_sum_prev7d"])


def test_dry_days_count_back_to_the_last_wet_day():
    series = np.zeros((120, 4))
    series[95, 0] = 5.0
    assert compiled.daymet_point(series, 100)["dm_dry_days"] == 4
    assert compiled.daymet_point(series, 95)["dm_dry_days"] == compiled.DRY_CAP


def test_fire_history_counts_only_earlier_days_of_the_same_cell_and_its_neighbours():
    fires = np.sort(compiled.pack([10, 10, 10, 11, 10, 50], [20, 20, 20, 21, 21, 50], [90, 99, 100, 99, 95, 99]))
    out = compiled.fire_history(fires, [10, 10, 0], [20, 22, 0], [100, 100, 3])
    assert out["firms_fire_days_prev1d"].tolist() == [1, 0, 0]
    assert out["firms_fire_days_prev7d"].tolist() == [1, 0, 0]
    assert out["firms_fire_days_prev30d"].tolist() == [2, 0, 0]
    assert out["firms_days_since_fire"].tolist() == [1, compiled.SINCE_CAP, compiled.SINCE_CAP]
    assert out["firms_neighbour_fire_days_prev1d"].tolist() == [1, 1, 0]  # (11, 21) touches both cells
    assert out["firms_neighbour_fire_days_prev7d"].tolist() == [2, 2, 0]


def test_time_split_meets_the_ratios_and_never_shares_a_date():
    dates = pd.Series(pd.date_range("2001-01-01", periods=500).strftime("%Y-%m-%d").repeat(4)).sample(frac=1, random_state=1)
    split = pd.Series(compiled.assign_split(dates), index=dates.index)
    share = split.value_counts(normalize=True)
    assert abs(share["train"] - 0.6) < 0.01 and abs(share["validation"] - 0.2) < 0.01
    assert (split.groupby(dates).nunique() == 1).all()
    assert dates[split == "train"].max() < dates[split == "validation"].min()
    assert dates[split == "validation"].max() < dates[split == "test"].min()


def test_random_split_is_repeatable():
    dates = pd.Series(["2020-01-01"] * 1000)
    first = compiled.assign_split(dates, by="random", seed=3)
    assert (first == compiled.assign_split(dates, by="random", seed=3)).all()
    assert abs((first == "train").mean() - 0.6) < 0.01


def test_only_feature_columns_are_model_inputs():
    assert compiled.role("fire") == "target"
    assert compiled.role("label_frp_max") == "label_detail"
    assert compiled.role("dm_tmax") == "feature"
    assert compiled.role("split") == "meta" and compiled.role("cell_id") == "id"


def test_cell_windows_cover_the_cell_and_clip_to_the_raster():
    origin = (grid.X_MIN, grid.Y_MIN + 100 * grid.CELL_SIZE_M)  # raster spans cell rows 0-99 from x = X_MIN
    r0, r1, c0, c1 = landfire.cell_windows([99, 0, 100], [0, 3, 0], origin, (250.0, 250.0), (4000, 400))
    assert (r0[0], r1[0], c0[0], c1[0]) == (0, 40, 0, 40)
    assert (r0[1], r1[1], c0[1], c1[1]) == (3960, 4000, 120, 160)
    assert r0[2] == r1[2]  # north of the raster: empty
