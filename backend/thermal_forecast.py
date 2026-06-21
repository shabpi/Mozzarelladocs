"""Thermal-model short-term inside temperature forecast.

Fits hardware capacities + weather drift once at import, then drives the
AUTO controller forward over the same 15-minute grid as the simple forecast.
"""

from pathlib import Path

import numpy as np
import pandas as pd

import thermal_model as tmodel
from simulator_forecast import apply_dummy_preset_to_outside

DATASET_DIR = Path(__file__).resolve().parent.parent / "ihl_research_dataset"
HEATING_DIR = DATASET_DIR / "heating_2026-03-30_to_2026-04-05"
COOLING_DIR = DATASET_DIR / "cooling_2026-05-25_to_2026-05-31"

GROSS_HEAT = tmodel.fit_model(HEATING_DIR, is_heating=True)[0]
GROSS_COOL = tmodel.fit_model(COOLING_DIR, is_heating=False, seed_only=False)[0]
DRIFT_MODEL = tmodel.fit_drift_model([HEATING_DIR, COOLING_DIR])


def build_forecast_steps(
    grid: pd.DatetimeIndex,
    events: pd.DataFrame,
    event_temp: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    n = len(grid)
    in_event = np.zeros(n, dtype=bool)
    setpoint = np.full(n, float(event_temp))
    hrs_to_event = np.full(n, np.nan)

    if events is None or events.empty:
        return in_event, setpoint, hrs_to_event

    evs = events.dropna(subset=["starts_at", "ends_at"]).sort_values("starts_at")

    def target_of(row) -> float:
        value = row.get("target_temperature_c")
        return float(value) if pd.notna(value) else float(event_temp)

    for k, t in enumerate(grid):
        covering = evs[(evs["starts_at"] <= t) & (evs["ends_at"] >= t)]
        if not covering.empty:
            in_event[k] = True
            setpoint[k] = target_of(covering.iloc[0])
            continue
        upcoming = evs[evs["starts_at"] > t]
        if not upcoming.empty:
            nxt = upcoming.iloc[0]
            hrs_to_event[k] = (nxt["starts_at"] - t) / pd.Timedelta(hours=1)
            setpoint[k] = target_of(nxt)

    return in_event, setpoint, hrs_to_event


def build_short_term_forecast_thermal(
    *,
    hours: int,
    reference_at: pd.Timestamp | None,
    latitude: float | None,
    longitude: float | None,
    main,
    dummy_preset: str | None = None,
) -> dict:
    """Same response shape as main.build_short_term_forecast_simple."""
    effective = main.effective_forecast_reference(reference_at)
    horizon_hours = max(1, min(int(hours), main.MAX_SHORT_TERM_FORECAST_HOURS))
    horizon_end = effective + pd.Timedelta(hours=horizon_hours)

    forecast_snapshots = main.forecast_model_snapshots(reference_at)
    forecast_model = main.build_outside_forecast_model(
        forecast_snapshots,
        latitude=latitude,
        longitude=longitude,
    )
    range_events = main.events_for_range(effective, horizon_end)

    first_bucket = effective.ceil(f"{main.SHORT_TERM_FORECAST_INTERVAL_MINUTES}min")
    if first_bucket < effective:
        first_bucket += pd.Timedelta(minutes=main.SHORT_TERM_FORECAST_INTERVAL_MINUTES)

    grid = pd.date_range(
        first_bucket,
        horizon_end,
        freq=f"{main.SHORT_TERM_FORECAST_INTERVAL_MINUTES}min",
    )
    if len(grid) == 0:
        return {
            "referenceAt": effective.strftime("%Y-%m-%d %H:%M UTC"),
            "horizonHours": horizon_hours,
            "intervalMinutes": main.SHORT_TERM_FORECAST_INTERVAL_MINUTES,
            "generatedAt": main.wall_clock_now(reference_at).strftime("%Y-%m-%d %H:%M UTC"),
            "weatherSource": forecast_model.get("source"),
            "startingInsideTempC": main.current_inside_temp(effective),
            "predictionModel": "thermal",
            "slots": [],
        }

    start_temp = main.current_inside_temp(effective)

    outside = np.array(
        [main.forecast_outside_at(forecast_model, t, effective) for t in grid],
        dtype="float64",
    )
    outside = pd.Series(outside).ffill().bfill().to_numpy()
    if not np.isfinite(outside).all():
        outside = np.nan_to_num(outside, nan=float(forecast_model.get("baseline", 15.0)))

    outside = apply_dummy_preset_to_outside(
        outside,
        dummy_preset,
        inside_c=start_temp,
    )

    in_event, setpoint, hrs_to_event = build_forecast_steps(
        grid, range_events, main.EVENT_TEMP_C
    )

    r_off0 = DRIFT_MODEL(float(outside[0]), grid[0].hour)
    seeds = {
        "r_heat": GROSS_HEAT * tmodel.DUTY_CAP + r_off0,
        "r_cool": GROSS_COOL * tmodel.DUTY_CAP + r_off0,
        "r_off": r_off0,
    }

    rooms, acts = tmodel.predict_curve_detailed(
        start_temp,
        grid,
        outside,
        in_event,
        setpoint,
        hrs_to_event,
        GROSS_HEAT,
        GROSS_COOL,
        DRIFT_MODEL,
        seeds,
    )

    slots: list[dict] = []
    for k, bucket in enumerate(grid):
        outside_rounded = round(float(outside[k]), 1)
        target_c = (
            round(float(setpoint[k]), 1)
            if bool(in_event[k])
            else main.resolve_target_temp_at(
                bucket, outside_rounded, range_events, effective
            )
        )
        slots.append(
            {
                "timestamp": bucket.strftime("%Y-%m-%d %H:%M:%S"),
                "operationMode": tmodel.act_to_operation_mode(int(acts[k])),
                "insideTempC": round(float(rooms[k]), 1),
                "targetTempC": target_c,
                "outsideTempC": outside_rounded,
            }
        )

    return {
        "referenceAt": effective.strftime("%Y-%m-%d %H:%M UTC"),
        "horizonHours": horizon_hours,
        "intervalMinutes": main.SHORT_TERM_FORECAST_INTERVAL_MINUTES,
        "generatedAt": main.wall_clock_now(reference_at).strftime("%Y-%m-%d %H:%M UTC"),
        "weatherSource": forecast_model.get("source"),
        "startingInsideTempC": round(float(start_temp), 1),
        "predictionModel": "thermal",
        "grossHeat": round(float(GROSS_HEAT), 3),
        "grossCool": round(float(GROSS_COOL), 3),
        "slots": slots,
    }
