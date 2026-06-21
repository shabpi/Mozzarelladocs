import json as json_lib
import sys
import urllib.error
import urllib.request
import uuid
from functools import lru_cache
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DATASET_DIR = Path(__file__).resolve().parent.parent / "ihl_research_dataset"

WINDOWS = [
    {
        "label": "Heating",
        "path": DATASET_DIR / "heating_2026-03-30_to_2026-04-05",
    },
    {
        "label": "Cooling",
        "path": DATASET_DIR / "cooling_2026-05-25_to_2026-05-31",
    },
]

POWER_INTERVAL_HOURS = 5 / 60  # power_draw.csv uses 5-minute samples
COMFORT_TOLERANCE_C = 2.0

EVENT_TEMP_C = 21
MIN_TEMP_C = 11
MAX_STANDBY_TEMP_C = 30
STANDBY_OUTSIDE_THRESHOLD_C = 20.0
WEATHER_PROGNOSIS_HORIZON_DAYS = 7
DEFAULT_WEATHER_LAT = 48.1351
DEFAULT_WEATHER_LON = 11.5820
SHORT_TERM_FORECAST_INTERVAL_MINUTES = 15
DEFAULT_SHORT_TERM_FORECAST_HOURS = 6
MAX_SHORT_TERM_FORECAST_HOURS = 48
SHORT_TERM_HEAT_RATE_C = 0.18
SHORT_TERM_COOL_RATE_C = 0.15
SHORT_TERM_IDLE_DRIFT = 0.04

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def load_window(window: dict) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    root = window["path"]
    intervals = pd.read_csv(root / "heat_pump_intervals.csv")
    intervals["interval_start_time"] = pd.to_datetime(intervals["interval_start_time"])
    intervals["season"] = window["label"]

    power = pd.read_csv(root / "power_draw.csv", parse_dates=["timestamp"])
    power["season"] = window["label"]

    events = pd.read_csv(
        root / "space_events.csv", parse_dates=["starts_at", "ends_at"]
    )
    events["season"] = window["label"]

    snapshots = pd.read_csv(root / "heat_pump_snapshots.csv", parse_dates=["last_seen_at"])
    snapshots["season"] = window["label"]

    return intervals, power, events, snapshots


def load_all_windows() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, list[dict]]:
    interval_frames = []
    power_frames = []
    event_frames = []
    snapshot_frames = []
    periods = []

    for window in WINDOWS:
        intervals, power, events, snapshots = load_window(window)
        interval_frames.append(intervals)
        power_frames.append(power)
        event_frames.append(events)
        snapshot_frames.append(snapshots)

        times = intervals["interval_start_time"]
        periods.append(
            {
                "label": window["label"],
                "start": times.min().date().isoformat(),
                "end": times.max().date().isoformat(),
            }
        )

    all_intervals = pd.concat(interval_frames, ignore_index=True)
    all_power = pd.concat(power_frames, ignore_index=True)
    all_events = pd.concat(event_frames, ignore_index=True)
    all_snapshots = pd.concat(snapshot_frames, ignore_index=True)

    return all_intervals, all_power, all_events, all_snapshots, periods


df, power_df, events_df, snapshots_df, dataset_periods = load_all_windows()

CUSTOM_EVENTS_FILE = Path(__file__).resolve().parent / "custom_space_events.json"
CUSTOM_EVENT_COLUMNS = [
    "id",
    "name",
    "type",
    "source",
    "starts_at",
    "ends_at",
    "target_temperature_c",
]


def load_custom_events() -> pd.DataFrame:
    if not CUSTOM_EVENTS_FILE.exists():
        return pd.DataFrame(columns=CUSTOM_EVENT_COLUMNS)
    rows = json_lib.loads(CUSTOM_EVENTS_FILE.read_text())
    if not rows:
        return pd.DataFrame(columns=CUSTOM_EVENT_COLUMNS)
    frame = pd.DataFrame(rows)
    frame["starts_at"] = pd.to_datetime(frame["starts_at"])
    frame["ends_at"] = pd.to_datetime(frame["ends_at"])
    return frame


def ensure_custom_events_dtypes(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return pd.DataFrame(columns=CUSTOM_EVENT_COLUMNS)
    result = frame.copy()
    result["starts_at"] = pd.to_datetime(result["starts_at"])
    result["ends_at"] = pd.to_datetime(result["ends_at"])
    if "target_temperature_c" not in result.columns:
        result["target_temperature_c"] = pd.NA
    if "season" in result.columns:
        result = result.drop(columns=["season"])
    for column in CUSTOM_EVENT_COLUMNS:
        if column not in result.columns:
            result[column] = pd.NA
    return result[CUSTOM_EVENT_COLUMNS]


def save_custom_events(frame: pd.DataFrame) -> None:
    records = ensure_custom_events_dtypes(frame)
    records["starts_at"] = records["starts_at"].dt.strftime("%Y-%m-%d %H:%M:%S")
    records["ends_at"] = records["ends_at"].dt.strftime("%Y-%m-%d %H:%M:%S")
    CUSTOM_EVENTS_FILE.write_text(json_lib.dumps(records.to_dict(orient="records"), indent=2))


custom_events_df = load_custom_events()

times = df["interval_start_time"]
display_range_start = times.min().date().isoformat()
display_range_end = times.max().date().isoformat()
available_dates = sorted({ts.date().isoformat() for ts in times})


def parse_optional_datetime(value: str | None) -> pd.Timestamp | None:
    if not value:
        return None
    return pd.to_datetime(value)


def filter_intervals_by_range(
    intervals: pd.DataFrame,
    start: pd.Timestamp | None,
    end: pd.Timestamp | None,
) -> pd.DataFrame:
    result = intervals
    if start is not None:
        result = result[result["interval_start_time"] >= start]
    if end is not None:
        result = result[result["interval_start_time"] <= end]
    return result


def filter_power_by_range(
    power: pd.DataFrame,
    start: pd.Timestamp | None,
    end: pd.Timestamp | None,
) -> pd.DataFrame:
    result = power
    if start is not None:
        result = result[result["timestamp"] >= start]
    if end is not None:
        result = result[result["timestamp"] <= end]
    return result


def energy_draw_kwh(power: pd.DataFrame) -> float:
    if power.empty:
        return 0.0
    totals = power.groupby("timestamp", as_index=False)["power_draw_kw"].sum()
    return round(
        float((totals["power_draw_kw"] * POWER_INTERVAL_HOURS).sum()),
        1,
    )


def compute_dataset_gaps(periods: list[dict]) -> list[dict]:
    sorted_periods = sorted(periods, key=lambda period: period["start"])
    gaps = []

    for index in range(len(sorted_periods) - 1):
        prev_end = pd.Timestamp(sorted_periods[index]["end"])
        next_start = pd.Timestamp(sorted_periods[index + 1]["start"])
        gap_start = prev_end + pd.Timedelta(days=1)
        gap_end = next_start - pd.Timedelta(days=1)

        if gap_start <= gap_end:
            gaps.append(
                {
                    "start": gap_start.strftime("%Y-%m-%d %H:%M:%S"),
                    "end": gap_end.replace(hour=23, minute=59, second=59).strftime(
                        "%Y-%m-%d %H:%M:%S"
                    ),
                }
            )

    return gaps


dataset_gaps = compute_dataset_gaps(dataset_periods)


def resolve_timeseries_range(
    start: pd.Timestamp | None,
    end: pd.Timestamp | None,
) -> tuple[pd.Timestamp, pd.Timestamp]:
    range_start = start if start is not None else pd.Timestamp(f"{display_range_start} 00:00:00")
    range_end = end if end is not None else pd.Timestamp(f"{display_range_end} 23:59:59")
    return range_start, range_end


def gaps_in_range(
    gaps: list[dict],
    range_start: pd.Timestamp,
    range_end: pd.Timestamp,
) -> list[dict]:
    visible = []
    for gap in gaps:
        gap_start = pd.to_datetime(gap["start"])
        gap_end = pd.to_datetime(gap["end"])
        if gap_start <= range_end and gap_end >= range_start:
            visible.append(gap)
    return visible


def filter_snapshots_by_range(
    snapshots: pd.DataFrame,
    start: pd.Timestamp | None,
    end: pd.Timestamp | None,
) -> pd.DataFrame:
    result = snapshots
    if start is not None:
        result = result[result["last_seen_at"] >= start]
    if end is not None:
        result = result[result["last_seen_at"] <= end]
    return result


def temperature_status_at(
    snapshots: pd.DataFrame,
    at: pd.Timestamp,
) -> dict | None:
    if snapshots.empty:
        return None

    subset = snapshots[snapshots["last_seen_at"] <= at]
    if subset.empty:
        subset = snapshots
    latest_time = subset["last_seen_at"].max()
    recent = subset[subset["last_seen_at"] == latest_time]

    return {
        "insideC": round(float(recent["status_temperature_in_celsius"].mean()), 1),
        "outsideC": round(float(recent["status_temperature_outside_in_celsius"].mean()), 1),
        "returnC": round(float(recent["status_temperature_return_in_celsius"].mean()), 1),
        "co2Ppm": round(float(recent["status_carbon_dioxide_in_ppm"].mean()), 0),
        "checkedAt": latest_time.strftime("%Y-%m-%d %H:%M UTC"),
    }


def grouped_timeseries(
    snapshots: pd.DataFrame,
    range_start: pd.Timestamp,
    range_end: pd.Timestamp,
    gaps: list[dict],
) -> list[dict]:
    points: list[dict] = []

    if not snapshots.empty:
        bucketed = snapshots.copy()
        bucketed["bucket"] = bucketed["last_seen_at"].dt.floor("15min")
        grouped = (
            bucketed.groupby("bucket", as_index=False)
            .agg(
                insideTemp=("status_temperature_in_celsius", "mean"),
                outsideTemp=("status_temperature_outside_in_celsius", "mean"),
                returnTemp=("status_temperature_return_in_celsius", "mean"),
                targetTemp=("status_target_temperature_in_celsius", "mean"),
                co2Ppm=("status_carbon_dioxide_in_ppm", "mean"),
            )
            .sort_values("bucket")
        )

        points = [
            {
                "timestamp": row["bucket"].strftime("%Y-%m-%d %H:%M:%S"),
                "insideTemp": round(row["insideTemp"], 2),
                "outsideTemp": round(row["outsideTemp"], 2),
                "returnTemp": round(row["returnTemp"], 2),
                "targetTemp": round(row["targetTemp"], 2),
                "co2Ppm": round(row["co2Ppm"], 0)
                if pd.notna(row["co2Ppm"])
                else None,
            }
            for _, row in grouped.iterrows()
        ]

    gap_markers = []
    for gap in gaps_in_range(gaps, range_start, range_end):
        gap_start = pd.to_datetime(gap["start"])
        gap_end = pd.to_datetime(gap["end"])
        midpoint = gap_start + (gap_end - gap_start) / 2
        gap_markers.append(
            {
                "timestamp": midpoint.strftime("%Y-%m-%d %H:%M:%S"),
                "insideTemp": None,
                "outsideTemp": None,
                "returnTemp": None,
                "targetTemp": None,
                "co2Ppm": None,
            }
        )

    combined = points + gap_markers
    combined.sort(key=lambda point: point["timestamp"])
    return combined


BUCKET_MINUTES = 15


def timestamp_in_gap(ts: pd.Timestamp, gaps: list[dict]) -> bool:
    for gap in gaps:
        gap_start = pd.to_datetime(gap["start"])
        gap_end = pd.to_datetime(gap["end"])
        if gap_start <= ts <= gap_end:
            return True
    return False


def timestamp_in_dataset_period(ts: pd.Timestamp, periods: list[dict]) -> bool:
    for period in periods:
        period_start = pd.Timestamp(f"{period['start']} 00:00:00")
        period_end = pd.Timestamp(f"{period['end']} 23:59:59")
        if period_start <= ts <= period_end:
            return True
    return False


def build_power_grid(
    power: pd.DataFrame,
    range_start: pd.Timestamp,
    range_end: pd.Timestamp,
    gaps: list[dict],
    periods: list[dict],
) -> list[dict]:
    bucketed_power: dict[pd.Timestamp, float] = {}
    if not power.empty:
        df = power.copy()
        at_time = df.groupby("timestamp", as_index=False)["power_draw_kw"].sum()
        at_time["bucket"] = at_time["timestamp"].dt.floor(f"{BUCKET_MINUTES}min")
        grouped = at_time.groupby("bucket", as_index=False)["power_draw_kw"].mean()
        for _, row in grouped.iterrows():
            bucketed_power[row["bucket"]] = round(float(row["power_draw_kw"]), 3)

    grid_start = range_start.floor(f"{BUCKET_MINUTES}min")
    grid_end = range_end.floor(f"{BUCKET_MINUTES}min")
    if grid_start > grid_end:
        return []

    buckets = pd.date_range(grid_start, grid_end, freq=f"{BUCKET_MINUTES}min")
    points = []
    for bucket in buckets:
        if not timestamp_in_dataset_period(bucket, periods):
            continue

        ts_str = bucket.strftime("%Y-%m-%d %H:%M:%S")
        if bucket in bucketed_power:
            points.append(
                {
                    "timestamp": ts_str,
                    "powerDrawKw": bucketed_power[bucket],
                    "powerMissing": False,
                }
            )
        else:
            points.append(
                {
                    "timestamp": ts_str,
                    "powerDrawKw": 0,
                    "powerMissing": True,
                }
            )

    return points


def build_device_power_series(
    power: pd.DataFrame,
    range_start: pd.Timestamp,
    range_end: pd.Timestamp,
    gaps: list[dict],
    periods: list[dict],
) -> dict[str, list[dict]]:
    if power.empty:
        return {}

    series: dict[str, list[dict]] = {}
    for device_name in sorted(power["device_name"].unique()):
        device_power = power[power["device_name"] == device_name]
        series[device_name] = build_power_grid(
            device_power, range_start, range_end, gaps, periods
        )
    return series


def grouped_power_timeseries(
    power: pd.DataFrame,
    range_start: pd.Timestamp,
    range_end: pd.Timestamp,
    gaps: list[dict],
    periods: list[dict],
) -> list[dict]:
    return build_power_grid(power, range_start, range_end, gaps, periods)


def attach_power_to_points(points: list[dict], power_points: list[dict]) -> list[dict]:
    power_map = {point["timestamp"]: point for point in power_points}
    for point in points:
        if point.get("insideTemp") is None:
            continue
        match = power_map.get(point["timestamp"])
        if match is not None:
            point["powerDrawKw"] = match["powerDrawKw"]
            point["powerMissing"] = match["powerMissing"]
        else:
            point["powerDrawKw"] = 0
            point["powerMissing"] = True
    return points


def build_power_detail(power: pd.DataFrame) -> dict:
    if power.empty:
        return {
            "totalKwh": 0.0,
            "peakKw": 0.0,
            "avgKw": 0.0,
            "sampleIntervalMinutes": 5,
            "devices": [],
        }

    totals = power.groupby("timestamp", as_index=False)["power_draw_kw"].sum()
    by_device = power.groupby("device_name", as_index=False).agg(
        avgKw=("power_draw_kw", "mean"),
        maxKw=("power_draw_kw", "max"),
    )
    device_rows = []
    for _, row in by_device.iterrows():
        device_power = power[power["device_name"] == row["device_name"]]
        device_rows.append(
            {
                "name": row["device_name"],
                "avgKw": round(float(row["avgKw"]), 2),
                "maxKw": round(float(row["maxKw"]), 2),
                "energyKwh": energy_draw_kwh(device_power),
            }
        )

    return {
        "totalKwh": energy_draw_kwh(power),
        "peakKw": round(float(totals["power_draw_kw"].max()), 2),
        "avgKw": round(float(totals["power_draw_kw"].mean()), 2),
        "sampleIntervalMinutes": 5,
        "devices": device_rows,
    }


def build_timeseries_payload(
    snapshots: pd.DataFrame,
    power: pd.DataFrame,
    start: pd.Timestamp | None,
    end: pd.Timestamp | None,
    reference_at: pd.Timestamp | None = None,
    include_forecast: bool = False,
    latitude: float | None = None,
    longitude: float | None = None,
) -> dict:
    range_start, range_end = resolve_timeseries_range(start, end)
    visible_gaps = gaps_in_range(dataset_gaps, range_start, range_end)
    power_points = grouped_power_timeseries(
        power, range_start, range_end, dataset_gaps, dataset_periods
    )
    device_power_series = build_device_power_series(
        power, range_start, range_end, dataset_gaps, dataset_periods
    )
    points = attach_power_to_points(
        grouped_timeseries(snapshots, range_start, range_end, dataset_gaps),
        power_points,
    )

    forecast_model = None
    if include_forecast and reference_at is not None:
        effective_ref = effective_forecast_reference(reference_at)
        forecast_snapshots = forecast_model_snapshots(reference_at)
        forecast_model = build_outside_forecast_model(
            forecast_snapshots,
            latitude=latitude,
            longitude=longitude,
        )
        range_events = events_for_range(start, end)
        points = merge_forecast_timeseries_points(
            points,
            range_start,
            range_end,
            effective_ref,
            forecast_model,
        )
        points = merge_event_target_points(
            points,
            range_start,
            range_end,
            range_events,
            reference_at=effective_ref,
        )
        points = fill_standby_target_temps(points, range_events, effective_ref)
        forecast_reference_at = effective_ref.strftime("%Y-%m-%d %H:%M UTC")
    else:
        forecast_reference_at = None

    return {
        "points": points,
        "powerPoints": power_points,
        "devicePowerSeries": device_power_series,
        "rangeStart": range_start.strftime("%Y-%m-%d %H:%M:%S"),
        "rangeEnd": range_end.strftime("%Y-%m-%d %H:%M:%S"),
        "gaps": visible_gaps,
        "forecastReferenceAt": forecast_reference_at,
        "weatherLatitude": latitude,
        "weatherLongitude": longitude,
        "weatherSource": forecast_model.get("source") if forecast_model else None,
    }


def comfort_maintained_percent(intervals: pd.DataFrame) -> float:
    grouped = (
        intervals.groupby("interval_start_time", as_index=False)
        .agg(
            insideTemp=("median_temperature_in_celsius", "mean"),
            targetTemp=("target_temperature_in_celsius", "mean"),
        )
    )
    if grouped.empty:
        return 0.0

    deviation = (grouped["insideTemp"] - grouped["targetTemp"]).abs()
    within = (deviation <= COMFORT_TOLERANCE_C).sum()
    return round(100 * within / len(grouped), 1)


def format_energy_label(
    start: pd.Timestamp | None,
    end: pd.Timestamp | None,
) -> str:
    if start is not None and end is not None:
        return f"{start.strftime('%Y-%m-%d %H:%M')} – {end.strftime('%Y-%m-%d %H:%M')}"
    return f"{display_range_start} – {display_range_end}"


def event_check_time(
    start: pd.Timestamp | None,
    end: pd.Timestamp | None,
) -> pd.Timestamp:
    if end is not None:
        return end
    if start is not None:
        return start
    return power_df["timestamp"].max()


def is_event_active(events: pd.DataFrame, at: pd.Timestamp) -> bool:
    if events.empty:
        return False
    return bool(
        ((events["starts_at"] <= at) & (events["ends_at"] >= at)).any()
    )


def parse_reference_at(value: str | None) -> pd.Timestamp:
    if not value:
        return power_df["timestamp"].max()
    return pd.to_datetime(value.replace(" UTC", ""))


def wall_clock_now(reference_at: pd.Timestamp | None = None) -> pd.Timestamp:
    now = pd.Timestamp.now().replace(microsecond=0)
    if reference_at is not None and reference_at.tzinfo is not None:
        now = now.tz_localize(reference_at.tzinfo)
    return now


def effective_forecast_reference(reference_at: pd.Timestamp | None = None) -> pd.Timestamp:
    """Past/future split for forecasts — always wall-clock now, not the zoom end."""
    return wall_clock_now(reference_at)


def forecast_model_snapshots(reference_at: pd.Timestamp) -> pd.DataFrame:
    effective = effective_forecast_reference(reference_at)
    latest = snapshots_df["last_seen_at"].max()
    cutoff = min(effective, latest)
    return snapshots_df[snapshots_df["last_seen_at"] <= cutoff]


def events_for_range(
    start: pd.Timestamp | None,
    end: pd.Timestamp | None,
) -> pd.DataFrame:
    """Return dataset events from every period overlapping the visible range."""
    range_start, range_end = resolve_timeseries_range(start, end)
    season_labels = []

    for period in dataset_periods:
        period_start = pd.Timestamp(f"{period['start']} 00:00:00")
        period_end = pd.Timestamp(f"{period['end']} 23:59:59")
        if period_start <= range_end and period_end >= range_start:
            season_labels.append(period["label"])

    if not season_labels:
        matched = events_df.iloc[0:0]
    else:
        matched = events_df[events_df["season"].isin(season_labels)]
        matched = matched[
            (matched["ends_at"] >= range_start) & (matched["starts_at"] <= range_end)
        ]

    custom = ensure_custom_events_dtypes(custom_events_df)
    if not custom.empty:
        in_range = custom[
            (custom["ends_at"] >= range_start) & (custom["starts_at"] <= range_end)
        ]
        outside_future = custom[custom["starts_at"] > range_end]
        custom = pd.concat([in_range, outside_future], ignore_index=True)
        custom = custom.drop_duplicates(subset=["id"], keep="first")
    if custom.empty:
        return matched
    if matched.empty:
        return custom
    return pd.concat([matched, custom], ignore_index=True)


def event_has_weather_prognosis(
    event_start: pd.Timestamp,
    reference_at: pd.Timestamp,
) -> bool:
    """Planned events within the forecast horizon have weather prognosis."""
    effective = effective_forecast_reference(reference_at)
    if event_start <= effective:
        return False
    horizon = effective + pd.Timedelta(days=WEATHER_PROGNOSIS_HORIZON_DAYS)
    return event_start <= horizon


def build_outside_forecast_model(
    snapshots: pd.DataFrame,
    latitude: float | None = None,
    longitude: float | None = None,
) -> dict:
    lat = latitude if latitude is not None else DEFAULT_WEATHER_LAT
    lon = longitude if longitude is not None else DEFAULT_WEATHER_LON
    open_meteo = fetch_open_meteo_hourly(lat, lon)
    if open_meteo:
        return {
            "source": "open_meteo",
            "hourly": open_meteo,
            "latitude": lat,
            "longitude": lon,
        }

    if snapshots.empty:
        return {
            "source": "synthetic",
            "hourly_means": {},
            "baseline": 15.0,
            "trend_per_day": 0.0,
        }

    frame = snapshots.copy()
    frame["outside"] = frame["status_temperature_outside_in_celsius"]
    hourly_means = (
        frame.groupby(frame["last_seen_at"].dt.hour)["outside"].mean().to_dict()
    )
    daily = (
        frame.groupby(frame["last_seen_at"].dt.floor("D"))["outside"]
        .mean()
        .sort_index()
    )

    if len(daily) >= 2:
        trend_per_day = float((daily.iloc[-1] - daily.iloc[0]) / max(len(daily) - 1, 1))
        baseline = float(daily.iloc[-1])
    else:
        trend_per_day = 0.0
        baseline = float(daily.iloc[-1]) if len(daily) else 15.0

    return {
        "source": "synthetic",
        "hourly_means": hourly_means,
        "baseline": baseline,
        "trend_per_day": trend_per_day,
    }


@lru_cache(maxsize=32)
def fetch_open_meteo_hourly(latitude: float, longitude: float) -> dict[str, float]:
    url = (
        "https://api.open-meteo.com/v1/forecast?"
        f"latitude={latitude:.4f}&longitude={longitude:.4f}"
        "&hourly=temperature_2m&forecast_days=7&timezone=UTC"
    )
    try:
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "heatpump-dashboard/1.0"},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = json_lib.loads(response.read())
    except (urllib.error.URLError, TimeoutError, KeyError, ValueError):
        return {}

    hourly = {}
    for timestamp, temp in zip(
        payload.get("hourly", {}).get("time", []),
        payload.get("hourly", {}).get("temperature_2m", []),
    ):
        if temp is None:
            continue
        hourly[timestamp] = float(temp)
    return hourly


def open_meteo_temp_at(model: dict, at: pd.Timestamp) -> float | None:
    hourly = model.get("hourly", {})
    if not hourly:
        return None

    hour_key = at.floor("h").strftime("%Y-%m-%dT%H:00")
    if hour_key in hourly:
        return hourly[hour_key]

    nearest = None
    nearest_distance = None
    target = at.floor("h")
    for key, value in hourly.items():
        ts = pd.Timestamp(key)
        distance = abs((ts - target).total_seconds())
        if nearest_distance is None or distance < nearest_distance:
            nearest = value
            nearest_distance = distance
    return nearest


def forecast_outside_at(
    model: dict,
    at: pd.Timestamp,
    reference_at: pd.Timestamp,
) -> float | None:
    effective = effective_forecast_reference(reference_at)
    if at <= effective:
        return None
    horizon_end = effective + pd.Timedelta(days=WEATHER_PROGNOSIS_HORIZON_DAYS)
    if at > horizon_end:
        return None

    if model.get("source") == "open_meteo":
        live = open_meteo_temp_at(model, at)
        if live is not None:
            return live

    days_ahead = (at.normalize() - reference_at.normalize()).days
    hour = int(at.hour)
    hourly_means = model.get("hourly_means", {})
    baseline = model.get("baseline", 15.0)
    trend_adjusted = baseline + model.get("trend_per_day", 0.0) * days_ahead
    if hourly_means:
        diurnal = hourly_means.get(hour, baseline)
        return trend_adjusted + (diurnal - baseline)
    return trend_adjusted


def energy_saving_target_c(outside_c: float | None) -> float | None:
    """Future standby target: 30 °C if forecast above band, 11 °C if below, else none."""
    if outside_c is None:
        return None
    outside = float(outside_c)
    if outside > MAX_STANDBY_TEMP_C:
        return float(MAX_STANDBY_TEMP_C)
    if outside < MIN_TEMP_C:
        return float(MIN_TEMP_C)
    return None


def fill_standby_target_temps(
    points: list[dict],
    events: pd.DataFrame,
    reference_at: pd.Timestamp,
) -> list[dict]:
    for point in points:
        ts = pd.Timestamp(point["timestamp"])

        if ts <= reference_at:
            if point.get("targetIsStandby"):
                point["targetTemp"] = None
                point["targetIsStandby"] = False
            continue

        if point.get("targetTemp") is not None and not point.get("targetIsStandby"):
            continue

        if not events.empty:
            in_event = events[
                (events["starts_at"] <= ts) & (events["ends_at"] >= ts)
            ]
            if not in_event.empty:
                continue

        target = energy_saving_target_c(point.get("outsideTemp"))
        if target is None:
            point["targetTemp"] = None
            point["targetIsStandby"] = False
        else:
            point["targetTemp"] = round(target, 2)
            point["targetIsStandby"] = True

    return points


def resolve_target_temp_at(
    ts: pd.Timestamp,
    outside_c: float | None,
    events: pd.DataFrame,
    reference_at: pd.Timestamp,
) -> float | None:
    if not events.empty:
        overlapping = events[
            (events["starts_at"] <= ts) & (events["ends_at"] >= ts)
        ]
        if not overlapping.empty:
            row = overlapping.iloc[0]
            if pd.notna(row.get("target_temperature_c")):
                return round(float(row["target_temperature_c"]), 1)
            return float(EVENT_TEMP_C)

    standby = energy_saving_target_c(outside_c)
    if standby is not None:
        return round(standby, 1)

    return None


def normalize_operation_mode(mode: str) -> str:
    normalized = str(mode or "").strip().upper()
    if normalized == "COOL":
        return "cool"
    if normalized == "HEAT":
        return "heat"
    return "idle"


def resolve_short_term_operation_mode(
    inside_c: float,
    target_c: float | None,
    outside_c: float | None,
) -> str:
    if target_c is None:
        return "idle"

    gap = target_c - inside_c
    if abs(gap) <= COMFORT_TOLERANCE_C:
        return "idle"
    if gap > COMFORT_TOLERANCE_C:
        return "heat"
    if gap < -COMFORT_TOLERANCE_C and outside_c is not None and outside_c > target_c:
        return "cool"
    return "idle"


def simulate_inside_temp_step(
    inside_c: float,
    target_c: float | None,
    outside_c: float | None,
    mode: str,
) -> float:
    if target_c is None:
        if outside_c is not None:
            return inside_c + (outside_c - inside_c) * SHORT_TERM_IDLE_DRIFT
        return inside_c

    gap = target_c - inside_c
    if mode == "heat":
        return inside_c + SHORT_TERM_HEAT_RATE_C * min(2.0, max(gap, 0.0))
    if mode == "cool":
        return inside_c - SHORT_TERM_COOL_RATE_C * min(2.0, max(-gap, 0.0))
    if outside_c is not None:
        return inside_c + (outside_c - inside_c) * SHORT_TERM_IDLE_DRIFT
    return inside_c


def current_inside_temp(reference_at: pd.Timestamp) -> float:
    status = temperature_status_at(snapshots_df, reference_at)
    if status and status.get("insideC") is not None:
        return float(status["insideC"])

    recent = snapshots_df[snapshots_df["last_seen_at"] <= reference_at]
    if recent.empty:
        recent = snapshots_df
    if recent.empty:
        return float(EVENT_TEMP_C)
    latest_time = recent["last_seen_at"].max()
    subset = recent[recent["last_seen_at"] == latest_time]
    return round(float(subset["status_temperature_in_celsius"].mean()), 1)


def build_short_term_forecast_simple(
    hours: int,
    reference_at: pd.Timestamp | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
) -> dict:
    effective = effective_forecast_reference(reference_at)
    horizon_hours = max(1, min(int(hours), MAX_SHORT_TERM_FORECAST_HOURS))
    horizon_end = effective + pd.Timedelta(hours=horizon_hours)

    forecast_snapshots = forecast_model_snapshots(reference_at)
    forecast_model = build_outside_forecast_model(
        forecast_snapshots,
        latitude=latitude,
        longitude=longitude,
    )
    range_events = events_for_range(effective, horizon_end)

    first_bucket = effective.ceil(f"{SHORT_TERM_FORECAST_INTERVAL_MINUTES}min")
    if first_bucket < effective:
        first_bucket += pd.Timedelta(minutes=SHORT_TERM_FORECAST_INTERVAL_MINUTES)

    inside_c = current_inside_temp(effective)
    slots: list[dict] = []

    for bucket in pd.date_range(
        first_bucket,
        horizon_end,
        freq=f"{SHORT_TERM_FORECAST_INTERVAL_MINUTES}min",
    ):
        outside_c = forecast_outside_at(forecast_model, bucket, effective)
        outside_rounded = round(outside_c, 1) if outside_c is not None else None
        target_c = resolve_target_temp_at(bucket, outside_c, range_events, effective)
        mode = resolve_short_term_operation_mode(inside_c, target_c, outside_c)
        inside_c = simulate_inside_temp_step(inside_c, target_c, outside_c, mode)

        slots.append(
            {
                "timestamp": bucket.strftime("%Y-%m-%d %H:%M:%S"),
                "operationMode": mode,
                "insideTempC": round(inside_c, 1),
                "targetTempC": target_c,
                "outsideTempC": outside_rounded,
            }
        )

    return {
        "referenceAt": effective.strftime("%Y-%m-%d %H:%M UTC"),
        "horizonHours": horizon_hours,
        "intervalMinutes": SHORT_TERM_FORECAST_INTERVAL_MINUTES,
        "generatedAt": wall_clock_now(reference_at).strftime("%Y-%m-%d %H:%M UTC"),
        "weatherSource": forecast_model.get("source"),
        "startingInsideTempC": current_inside_temp(effective),
        "predictionModel": "simple",
        "slots": slots,
    }


def build_short_term_forecast(
    hours: int,
    reference_at: pd.Timestamp | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    model: str = "simple",
    dummy_preset: str | None = None,
) -> dict:
    normalized = (model or "simple").strip().lower()
    preset = (dummy_preset or "off").strip().lower()
    if preset not in {"off", "base", "cooling", "heating"}:
        preset = "off"
    if normalized == "thermal":
        from thermal_forecast import build_short_term_forecast_thermal

        return build_short_term_forecast_thermal(
            hours=hours,
            reference_at=reference_at,
            latitude=latitude,
            longitude=longitude,
            main=sys.modules[__name__],
            dummy_preset=None if preset == "off" else preset,
        )
    if normalized == "simulator":
        from simulator_forecast import build_short_term_forecast_simulator

        return build_short_term_forecast_simulator(
            hours=hours,
            reference_at=reference_at,
            latitude=latitude,
            longitude=longitude,
            main=sys.modules[__name__],
            dummy_preset=None if preset == "off" else preset,
        )
    return build_short_term_forecast_simple(
        hours=hours,
        reference_at=reference_at,
        latitude=latitude,
        longitude=longitude,
    )


def get_target_for_timestamp(
    ts: pd.Timestamp,
    reference_at: pd.Timestamp,
    custom_events: pd.DataFrame,
) -> float:
    if custom_events.empty:
        return EVENT_TEMP_C

    mask = (
        (custom_events["starts_at"] <= ts)
        & (custom_events["ends_at"] >= ts)
        & (custom_events["starts_at"] > reference_at)
    )
    matching = custom_events[mask]
    if matching.empty:
        return EVENT_TEMP_C

    row = matching.iloc[0]
    if pd.notna(row.get("target_temperature_c")):
        return float(row["target_temperature_c"])
    return EVENT_TEMP_C


def compute_event_forecast(
    event_start: pd.Timestamp,
    event_end: pd.Timestamp,
    reference_at: pd.Timestamp,
    model: dict,
    target_c: float,
) -> dict | None:
    effective = effective_forecast_reference(reference_at)
    if event_start > effective + pd.Timedelta(days=WEATHER_PROGNOSIS_HORIZON_DAYS):
        return None

    sample_start = max(event_start, effective)
    sample_end = min(
        event_end,
        effective + pd.Timedelta(days=WEATHER_PROGNOSIS_HORIZON_DAYS),
    )
    if sample_end < sample_start:
        sample_end = event_end

    samples = pd.date_range(sample_start, sample_end, freq="3h")
    if len(samples) == 0:
        midpoint = event_start + (event_end - event_start) / 2
        samples = [midpoint]

    outside_values = [
        forecast_outside_at(model, pd.Timestamp(sample), effective)
        for sample in samples
    ]
    avg_outside = sum(outside_values) / len(outside_values)
    delta = avg_outside - target_c
    season = "Cooling" if delta > 0 else "Heating"

    return {
        "season": season,
        "outsideC": round(avg_outside, 1),
        "deltaC": round(delta, 1),
    }


def forecast_event_season(
    event_start: pd.Timestamp,
    event_end: pd.Timestamp,
    target_c: float,
    reference_at: pd.Timestamp,
    model: dict,
) -> str | None:
    forecast = compute_event_forecast(
        event_start,
        event_end,
        reference_at,
        model,
        target_c,
    )
    return forecast["season"] if forecast else None


def merge_forecast_timeseries_points(
    points: list[dict],
    range_start: pd.Timestamp,
    range_end: pd.Timestamp,
    reference_at: pd.Timestamp,
    model: dict,
) -> list[dict]:
    horizon_end = reference_at + pd.Timedelta(days=WEATHER_PROGNOSIS_HORIZON_DAYS)
    if range_end <= reference_at:
        return points

    point_map = {point["timestamp"]: dict(point) for point in points}

    grid_start = range_start.floor(f"{BUCKET_MINUTES}min")
    grid_end = range_end.floor(f"{BUCKET_MINUTES}min")
    if grid_start > grid_end:
        return points

    for bucket in pd.date_range(grid_start, grid_end, freq=f"{BUCKET_MINUTES}min"):
        if bucket <= reference_at or bucket > horizon_end:
            continue

        ts_str = bucket.strftime("%Y-%m-%d %H:%M:%S")
        outside = forecast_outside_at(model, bucket, reference_at)
        if outside is None:
            continue
        existing = point_map.get(ts_str, {"timestamp": ts_str})
        existing.update(
            {
                "outsideTemp": round(outside, 2),
                "insideTemp": None,
                "returnTemp": None,
                "targetTemp": None,
                "forecast": True,
            }
        )
        point_map[ts_str] = existing

    combined = list(point_map.values())
    combined.sort(key=lambda point: point["timestamp"])
    return combined


def merge_event_target_points(
    points: list[dict],
    range_start: pd.Timestamp,
    range_end: pd.Timestamp,
    events: pd.DataFrame,
    reference_at: pd.Timestamp | None = None,
) -> list[dict]:
    if events.empty:
        return points

    point_map = {point["timestamp"]: dict(point) for point in points}

    for _, event in events.iterrows():
        if pd.notna(event.get("target_temperature_c")):
            target = float(event["target_temperature_c"])
        else:
            target = EVENT_TEMP_C

        event_start = max(event["starts_at"], range_start)
        event_end = min(event["ends_at"], range_end)
        if event_end < event_start:
            continue

        grid_start = event_start.floor(f"{BUCKET_MINUTES}min")
        grid_end = event_end.floor(f"{BUCKET_MINUTES}min")
        if grid_start > grid_end:
            continue

        for bucket in pd.date_range(grid_start, grid_end, freq=f"{BUCKET_MINUTES}min"):
            if reference_at is not None and bucket <= reference_at:
                continue
            ts_str = bucket.strftime("%Y-%m-%d %H:%M:%S")
            existing = point_map.get(ts_str, {"timestamp": ts_str})
            existing["targetTemp"] = round(target, 2)
            existing["targetIsStandby"] = False
            point_map[ts_str] = existing

    combined = list(point_map.values())
    combined.sort(key=lambda point: point["timestamp"])
    return combined


def serialize_space_events(
    reference_at: pd.Timestamp,
    start: pd.Timestamp | None = None,
    end: pd.Timestamp | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
) -> list[dict]:
    source_events = events_for_range(start, end)
    deduped = source_events.drop_duplicates(subset=["starts_at", "ends_at"]).sort_values(
        "starts_at"
    )
    items = []
    forecast_snapshots = forecast_model_snapshots(reference_at)
    forecast_model = build_outside_forecast_model(
        forecast_snapshots,
        latitude=latitude,
        longitude=longitude,
    )
    effective_ref = effective_forecast_reference(reference_at)
    custom_events = ensure_custom_events_dtypes(custom_events_df)

    for _, row in deduped.iterrows():
        if row["ends_at"] < reference_at:
            status = "historic"
        elif row["starts_at"] > reference_at:
            status = "future"
        else:
            status = "current"

        weather_prognosis = event_has_weather_prognosis(row["starts_at"], reference_at)
        is_custom = bool(pd.notna(row.get("id"))) if "id" in row.index else False
        target_temp = None
        if is_custom:
            if pd.notna(row.get("target_temperature_c")):
                target_temp = round(float(row["target_temperature_c"]), 1)
            elif pd.notna(row.get("targetTemperatureC")):
                target_temp = round(float(row["targetTemperatureC"]), 1)

        event_target = target_temp if target_temp is not None else EVENT_TEMP_C
        forecast = None
        if status == "future" and weather_prognosis:
            forecast = compute_event_forecast(
                row["starts_at"],
                row["ends_at"],
                effective_ref,
                forecast_model,
                event_target,
            )

        items.append(
            {
                "id": row["id"] if is_custom else None,
                "name": row["name"],
                "startsAt": row["starts_at"].strftime("%Y-%m-%d %H:%M:%S"),
                "endsAt": row["ends_at"].strftime("%Y-%m-%d %H:%M:%S"),
                "status": status,
                "season": row["season"] if not is_custom and "season" in row.index else None,
                "targetTemperatureC": target_temp,
                "forecastSeason": forecast["season"] if forecast else None,
                "forecastOutsideTempC": forecast["outsideC"] if forecast else None,
                "forecastTempDeltaC": forecast["deltaC"] if forecast else None,
                "weatherPrognosisAvailable": weather_prognosis,
                "custom": is_custom,
            }
        )
    return items


class SpaceEventInput(BaseModel):
    name: str
    startsAt: str
    endsAt: str
    targetTemperatureC: float


class PredictionInput(BaseModel):
    status_temperature_in_celsius: float
    status_temperature_outside_in_celsius: float
    status_target_temperature_in_celsius: float


@app.get("/api/overview")
def get_overview(
    start: str | None = Query(None),
    end: str | None = Query(None),
):
    start_ts = parse_optional_datetime(start)
    end_ts = parse_optional_datetime(end)

    filtered_power = filter_power_by_range(power_df, start_ts, end_ts)
    filtered_intervals = filter_intervals_by_range(df, start_ts, end_ts)
    filtered_snapshots = filter_snapshots_by_range(snapshots_df, start_ts, end_ts)
    checked_at = event_check_time(start_ts, end_ts)
    reference_events = events_for_range(start_ts, end_ts)
    temperature_status = temperature_status_at(filtered_snapshots, checked_at)

    return {
        "energyDrawKwh": energy_draw_kwh(filtered_power),
        "energyDrawLabel": format_energy_label(start_ts, end_ts),
        "powerDetail": build_power_detail(filtered_power),
        "eventActive": is_event_active(reference_events, checked_at),
        "eventCheckedAt": checked_at.strftime("%Y-%m-%d %H:%M UTC"),
        "temperatureStatus": temperature_status,
        "comfortMaintainedPercent": comfort_maintained_percent(filtered_intervals),
        "comfortTargetRange": f"Target: {EVENT_TEMP_C} °C (occupied), {MIN_TEMP_C} °C or {MAX_STANDBY_TEMP_C} °C standby when forecast is outside the band (future only)",
        "displayRangeStart": display_range_start,
        "displayRangeEnd": display_range_end,
        "availableDates": available_dates,
        "datasetPeriods": dataset_periods,
        "weatherPrognosisHorizonDays": WEATHER_PROGNOSIS_HORIZON_DAYS,
        "forecastReferenceAt": effective_forecast_reference(
            event_check_time(start_ts, end_ts)
        ).strftime("%Y-%m-%d %H:%M UTC"),
    }


@app.get("/api/timeseries")
def get_timeseries(
    start: str | None = Query(None),
    end: str | None = Query(None),
    referenceAt: str | None = Query(None),
    forecastFuture: bool = Query(False),
    latitude: float | None = Query(None),
    longitude: float | None = Query(None),
):
    start_ts = parse_optional_datetime(start)
    end_ts = parse_optional_datetime(end)
    filtered_snapshots = filter_snapshots_by_range(snapshots_df, start_ts, end_ts)
    filtered_power = filter_power_by_range(power_df, start_ts, end_ts)
    reference_at = parse_reference_at(referenceAt) if referenceAt else None
    return build_timeseries_payload(
        filtered_snapshots,
        filtered_power,
        start_ts,
        end_ts,
        reference_at=reference_at,
        include_forecast=forecastFuture and reference_at is not None,
        latitude=latitude,
        longitude=longitude,
    )


@app.get("/api/space-events")
def get_space_events(
    referenceAt: str | None = Query(None),
    start: str | None = Query(None),
    end: str | None = Query(None),
    latitude: float | None = Query(None),
    longitude: float | None = Query(None),
):
    reference_at = parse_reference_at(referenceAt)
    start_ts = parse_optional_datetime(start)
    end_ts = parse_optional_datetime(end)
    return serialize_space_events(
        reference_at,
        start_ts,
        end_ts,
        latitude=latitude,
        longitude=longitude,
    )


def assert_future_custom_event(
    event_id: str,
    reference_at: pd.Timestamp,
    *,
    action: str,
) -> int:
    events = ensure_custom_events_dtypes(custom_events_df)
    mask = events["id"] == event_id
    if not mask.any():
        raise HTTPException(status_code=404, detail="Event not found")

    row = events.loc[mask].iloc[0]
    if row["starts_at"] <= reference_at:
        raise HTTPException(
            status_code=400,
            detail=f"Only future events can be {action}",
        )
    return events.index[mask][0]


@app.post("/api/space-events")
def create_space_event(body: SpaceEventInput):
    global custom_events_df

    starts_at = pd.to_datetime(body.startsAt)
    ends_at = pd.to_datetime(body.endsAt)
    if ends_at <= starts_at:
        raise HTTPException(status_code=400, detail="End must be after start")

    event_id = str(uuid.uuid4())
    row = {
        "id": event_id,
        "name": body.name.strip() or "Untitled event",
        "type": "SINGLETON",
        "source": "DASHBOARD",
        "starts_at": starts_at,
        "ends_at": ends_at,
        "target_temperature_c": round(float(body.targetTemperatureC), 1),
    }
    custom_events_df = ensure_custom_events_dtypes(
        pd.concat([custom_events_df, pd.DataFrame([row])], ignore_index=True)
    )
    save_custom_events(custom_events_df)
    return {"id": event_id}


@app.put("/api/space-events/{event_id}")
def update_space_event(
    event_id: str,
    body: SpaceEventInput,
    referenceAt: str | None = Query(None),
):
    global custom_events_df

    reference_at = parse_reference_at(referenceAt)
    row_index = assert_future_custom_event(event_id, reference_at, action="edited")

    starts_at = pd.to_datetime(body.startsAt)
    ends_at = pd.to_datetime(body.endsAt)
    if ends_at <= starts_at:
        raise HTTPException(status_code=400, detail="End must be after start")

    custom_events_df = ensure_custom_events_dtypes(custom_events_df.copy())
    custom_events_df.loc[row_index, "name"] = body.name.strip() or "Untitled event"
    custom_events_df.loc[row_index, "starts_at"] = starts_at
    custom_events_df.loc[row_index, "ends_at"] = ends_at
    custom_events_df.loc[row_index, "target_temperature_c"] = round(
        float(body.targetTemperatureC), 1
    )
    save_custom_events(custom_events_df)
    return {"id": event_id}


@app.delete("/api/space-events/{event_id}")
def delete_space_event(
    event_id: str,
    referenceAt: str | None = Query(None),
):
    global custom_events_df

    reference_at = parse_reference_at(referenceAt)
    row_index = assert_future_custom_event(event_id, reference_at, action="deleted")
    custom_events_df = ensure_custom_events_dtypes(custom_events_df)
    custom_events_df = custom_events_df.drop(index=row_index).reset_index(drop=True)
    save_custom_events(custom_events_df)
    return {"ok": True}


@app.get("/api/short-term-forecast")
def get_short_term_forecast(
    hours: int = Query(DEFAULT_SHORT_TERM_FORECAST_HOURS, ge=1, le=MAX_SHORT_TERM_FORECAST_HOURS),
    referenceAt: str | None = Query(None),
    latitude: float | None = Query(None),
    longitude: float | None = Query(None),
    model: str = Query(
        "simple",
        description="Inside prediction model: 'simple', 'thermal', or 'simulator' (ML decision model)",
    ),
    dummyPreset: str | None = Query(
        None,
        description="Dummy history scenario for thermal/simulator models: 'off', 'base', 'cooling', or 'heating'",
    ),
):
    reference_at = parse_reference_at(referenceAt) if referenceAt else None
    normalized = (model or "simple").strip().lower()
    if normalized not in {"simple", "thermal", "simulator"}:
        normalized = "simple"
    return build_short_term_forecast(
        hours=hours,
        reference_at=reference_at,
        latitude=latitude,
        longitude=longitude,
        model=normalized,
        dummy_preset=dummyPreset,
    )


@app.post("/api/predict")
def predict(input: PredictionInput):
    delta_temp = (
        input.status_target_temperature_in_celsius
        - input.status_temperature_in_celsius
    )

    predicted_minutes = max(0, delta_temp * 9)
    predicted_kwh = max(0, delta_temp * 0.42)

    return {
        "predictedMinutes": round(predicted_minutes, 1),
        "predictedKwh": round(predicted_kwh, 2),
    }
