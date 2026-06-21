"""ML simulator short-term forecast — wraps ml_forecast.decision for the dashboard API."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

import thermal_model as tmodel
from ml_forecast import decision as ml_decision

DATASET_DIR = Path(__file__).resolve().parent.parent / "ihl_research_dataset"
ML_STEP_MINUTES = 30


@lru_cache(maxsize=1)
def _device_id_to_label() -> dict[str, str]:
    devices_path = DATASET_DIR / "devices.csv"
    if not devices_path.exists():
        return {}
    frame = pd.read_csv(devices_path)
    return {
        str(row["device_id"]): str(row["label"]).lower().replace(" ", "_")
        for _, row in frame.iterrows()
    }


def _label_to_device_name(label: str) -> str:
    return label.replace("_", " ").title()


def plan_act_to_operation_mode(act: int) -> str:
    return tmodel.act_to_operation_mode(int(act))


def operation_mode_to_plan_act(mode: str) -> int:
    if mode == "heat":
        return 1
    if mode == "cool":
        return -1
    return 0


def resolve_hrs_to_event(events: pd.DataFrame, at: pd.Timestamp) -> float | None:
    if events is None or events.empty:
        return None

    evs = events.dropna(subset=["starts_at", "ends_at"]).sort_values("starts_at")
    covering = evs[(evs["starts_at"] <= at) & (evs["ends_at"] >= at)]
    if not covering.empty:
        return 0.0

    upcoming = evs[evs["starts_at"] > at]
    if upcoming.empty:
        return None

    return float((upcoming.iloc[0]["starts_at"] - at) / pd.Timedelta(hours=1))


def resolve_comfort_target_c(
    events: pd.DataFrame,
    at: pd.Timestamp,
    *,
    default_c: float,
) -> float:
    if events is None or events.empty:
        return float(default_c)

    evs = events.dropna(subset=["starts_at", "ends_at"]).sort_values("starts_at")
    covering = evs[(evs["starts_at"] <= at) & (evs["ends_at"] >= at)]
    if not covering.empty:
        row = covering.iloc[0]
        if pd.notna(row.get("target_temperature_c")):
            return float(row["target_temperature_c"])

    upcoming = evs[evs["starts_at"] > at]
    if not upcoming.empty:
        row = upcoming.iloc[0]
        if pd.notna(row.get("target_temperature_c")):
            return float(row["target_temperature_c"])

    return float(default_c)


def build_ml_feature_data(main, reference_at: pd.Timestamp, outside_c: float | None) -> dict:
    device_map = _device_id_to_label()
    recent_snaps = main.snapshots_df[main.snapshots_df["last_seen_at"] <= reference_at]
    if recent_snaps.empty:
        recent_snaps = main.snapshots_df

    inside_c = main.current_inside_temp(reference_at)
    outside_fallback = outside_c if outside_c is not None else inside_c

    feature_data: dict = {
        "last_temp": float(inside_c),
        "status_temperature_in_celsius": float(inside_c),
    }

    for device_id, label in device_map.items():
        device_snaps = recent_snaps[recent_snaps["device_id"] == device_id]
        if device_snaps.empty:
            mode_val = 1.0
            outside_val = outside_fallback
            return_val = inside_c
            power_kw = 0.0
        else:
            latest = device_snaps.loc[device_snaps["last_seen_at"].idxmax()]
            mode_raw = latest.get("status_operation_mode", "HEAT")
            mode_val = 1.0 if str(mode_raw).upper() == "HEAT" else 0.0
            outside_val = float(latest.get("status_temperature_outside_in_celsius", outside_fallback))
            return_val = float(latest.get("status_temperature_return_in_celsius", inside_c))
            power_kw = _latest_device_power_kw(
                main.power_df, _label_to_device_name(label), reference_at
            )

        feature_data[f"{label}_status_operation_mode"] = mode_val
        feature_data[f"{label}_status_temperature_outside_in_celsius"] = float(outside_val)
        feature_data[f"{label}_status_temperature_return_in_celsius"] = float(return_val)
        feature_data[f"{label}_power_draw_kw"] = float(power_kw)

    return ml_decision.sync_prediction_features(feature_data)


def apply_dummy_preset_to_outside(
    outside: np.ndarray,
    preset: str | None,
    *,
    inside_c: float,
) -> np.ndarray:
    """Align the first outside sample with the active dummy history scenario."""
    if not preset or preset == "off" or len(outside) == 0:
        return outside

    adjusted = outside.copy()
    inside = float(inside_c)
    if preset == "cooling":
        adjusted[0] = max(float(adjusted[0]), 26.0)
    elif preset in {"base", "heating"}:
        outside0 = float(adjusted[0])
        adjusted[0] = min(outside0, inside - 2.0) if outside0 >= inside else outside0
    return adjusted


def apply_dummy_preset_to_features(
    feature_data: dict,
    preset: str | None,
    *,
    inside_c: float,
    outside_c: float | None,
) -> dict:
    """Seed ML features to match the active forecast dummy history scenario."""
    if not preset or preset == "off":
        return feature_data

    fd = dict(feature_data)
    outside = float(outside_c if outside_c is not None else inside_c)

    if preset == "cooling":
        warm_outside = max(outside, 26.0)
        return_temp = inside_c + 2.5
        for d in range(1, 5):
            prefix = f"device_{d}"
            fd[f"{prefix}_status_operation_mode"] = 0.0
            fd[f"{prefix}_status_temperature_outside_in_celsius"] = warm_outside
            fd[f"{prefix}_status_temperature_return_in_celsius"] = return_temp
            fd[f"{prefix}_power_draw_kw"] = max(
                0.0, float(fd.get(f"{prefix}_power_draw_kw", 0.0))
            )
        fd["force_heating_season"] = False
    elif preset == "base":
        cool_outside = min(outside, inside_c - 2.0) if outside >= inside_c else outside
        return_temp = inside_c - 1.2
        for d in range(1, 5):
            prefix = f"device_{d}"
            fd[f"{prefix}_status_operation_mode"] = 1.0
            fd[f"{prefix}_status_temperature_outside_in_celsius"] = cool_outside
            fd[f"{prefix}_status_temperature_return_in_celsius"] = return_temp
        fd["force_heating_season"] = True
    elif preset == "heating":
        cool_outside = min(outside, inside_c - 2.0) if outside >= inside_c else outside
        return_temp = inside_c - 0.6
        for d in range(1, 5):
            prefix = f"device_{d}"
            fd[f"{prefix}_status_operation_mode"] = 1.0
            fd[f"{prefix}_status_temperature_outside_in_celsius"] = cool_outside
            fd[f"{prefix}_status_temperature_return_in_celsius"] = return_temp
            fd[f"{prefix}_power_draw_kw"] = max(
                0.0, float(fd.get(f"{prefix}_power_draw_kw", 0.0)) * 0.15
            )
        fd["force_heating_season"] = True

    fd["last_temp"] = float(inside_c)
    fd["status_temperature_in_celsius"] = float(inside_c)
    return ml_decision.sync_prediction_features(fd)


def _latest_device_power_kw(power_df: pd.DataFrame, device_name: str, at: pd.Timestamp) -> float:
    recent = power_df[
        (power_df["device_name"] == device_name) & (power_df["timestamp"] <= at)
    ]
    if recent.empty:
        return 0.0
    latest = recent.loc[recent["timestamp"].idxmax()]
    return max(0.0, float(latest["power_draw_kw"]))


def _return_temps_from_features(feature_data: dict) -> dict[int, float]:
    synced = ml_decision.sync_prediction_features(feature_data)
    return {
        d: float(synced[f"device_{d}_status_temperature_return_in_celsius"])
        for d in range(1, 5)
    }


def _update_feature_data_for_step(
    base: dict,
    *,
    room_temp: float,
    outside_c: float,
    act: int,
    power_kw: float | None = None,
    return_temps: dict[int, float] | None = None,
) -> dict:
    """Clone snapshot features and align inside/return temps for the simulated step."""
    fd = ml_decision.sync_prediction_features(base)
    fd["last_temp"] = float(room_temp)
    fd["status_temperature_in_celsius"] = float(room_temp)
    mode_val = 1.0 if act == 1 else (0.0 if act == -1 else None)

    for d in range(1, 5):
        prefix = f"device_{d}"
        fd[f"{prefix}_status_temperature_outside_in_celsius"] = float(outside_c)
        if return_temps is not None and d in return_temps:
            return_val = float(return_temps[d])
        else:
            return_val = float(fd.get(f"{prefix}_status_temperature_return_in_celsius", room_temp - 1.2))
        fd[f"{prefix}_status_temperature_return_in_celsius"] = return_val
        if mode_val is not None:
            fd[f"{prefix}_status_operation_mode"] = mode_val
        if power_kw is not None:
            fd[f"{prefix}_power_draw_kw"] = float(power_kw)

    return ml_decision.sync_prediction_features(fd)


def _force_heating_for_step(
    act: int,
    *,
    room_temp: float,
    outside_c: float,
    target_c: float | None,
    tolerance_c: float,
) -> bool:
    if act == 1:
        return True
    if act == -1:
        return False
    if target_c is None:
        return outside_c < room_temp
    gap = target_c - room_temp
    if gap > tolerance_c:
        return True
    if gap < -tolerance_c and outside_c > target_c:
        return False
    return outside_c < target_c


def _resolve_step_action(
    *,
    step: int,
    event_plan: list[int] | None,
    room_temp: float,
    target_for_mode: float | None,
    outside_c: float,
    main,
) -> int:
    if event_plan is not None and step < len(event_plan):
        act = int(event_plan[step])
        if act == 0:
            mode = main.resolve_short_term_operation_mode(room_temp, target_for_mode, outside_c)
            override = operation_mode_to_plan_act(mode)
            if override != 0:
                return override
        return act

    mode = main.resolve_short_term_operation_mode(room_temp, target_for_mode, outside_c)
    return operation_mode_to_plan_act(mode)


def _interpolate_forecast(
    start_temp: float,
    forecasts: list[float],
    offset_minutes: int,
) -> float:
    """Interpolate 30-min ML forecasts onto a minute offset from reference."""
    if not forecasts or offset_minutes <= 0:
        return float(start_temp)

    step_index = min((offset_minutes - 1) // ML_STEP_MINUTES, len(forecasts) - 1)
    prev_offset = 0 if step_index == 0 else step_index * ML_STEP_MINUTES
    next_offset = (step_index + 1) * ML_STEP_MINUTES
    prev_temp = start_temp if step_index == 0 else float(forecasts[step_index - 1])
    next_temp = float(forecasts[step_index])
    if next_offset <= prev_offset:
        return next_temp
    frac = (offset_minutes - prev_offset) / (next_offset - prev_offset)
    return prev_temp + (next_temp - prev_temp) * frac


def _resolve_event_driven_plan(
    *,
    effective: pd.Timestamp,
    feature_data: dict,
    hrs_to_event: float | None,
    comfort_target: float,
    model_data,
    ml_steps: int,
) -> list[int] | None:
    if hrs_to_event is None or hrs_to_event > ml_decision.TIME_TO_EVENT_THRESHOLD_H:
        return None

    previous_good_temp = ml_decision.GOOD_TEMP
    try:
        ml_decision.GOOD_TEMP = float(comfort_target)
        plan, _ = ml_decision.decide(
            current_time=effective,
            feature_data=feature_data,
            hrs_to_event=hrs_to_event,
            model=model_data,
            forecast_horizon=ml_steps,
            interval="30min",
        )
    finally:
        ml_decision.GOOD_TEMP = previous_good_temp

    if not plan:
        return None
    return [int(value) for value in plan]


def _simulate_ml_horizon(
    *,
    main,
    effective: pd.Timestamp,
    start_temp: float,
    feature_base: dict,
    forecast_model,
    range_events: pd.DataFrame,
    model_data,
    ml_steps: int,
    event_plan: list[int] | None,
) -> tuple[list[int], list[float]]:
    """
    Step the ML model forward every 30 minutes, updating room temp, weather, and mode.
    Mirrors the thermal model's rolling simulation rather than a single passive decide() call.
    """
    room_temp = float(start_temp)
    return_temps = _return_temps_from_features(feature_base)
    plans: list[int] = []
    forecasts: list[float] = []

    for step in range(ml_steps):
        step_start = effective + pd.Timedelta(minutes=ML_STEP_MINUTES * step)
        step_end = effective + pd.Timedelta(minutes=ML_STEP_MINUTES * (step + 1))
        outside_c = main.forecast_outside_at(forecast_model, step_end, effective)
        if outside_c is None:
            outside_c = float(
                feature_base.get("device_1_status_temperature_outside_in_celsius", room_temp)
            )

        chart_target = main.resolve_target_temp_at(step_end, outside_c, range_events, effective)
        comfort_target = resolve_comfort_target_c(
            range_events,
            step_start,
            default_c=main.EVENT_TEMP_C,
        )
        target_for_mode = chart_target if chart_target is not None else comfort_target

        act = _resolve_step_action(
            step=step,
            event_plan=event_plan,
            room_temp=room_temp,
            target_for_mode=target_for_mode,
            outside_c=float(outside_c),
            main=main,
        )

        force_heating = _force_heating_for_step(
            act,
            room_temp=room_temp,
            outside_c=float(outside_c),
            target_c=target_for_mode,
            tolerance_c=main.COMFORT_TOLERANCE_C,
        )

        step_features = _update_feature_data_for_step(
            feature_base,
            room_temp=room_temp,
            outside_c=float(outside_c),
            act=act,
            return_temps=return_temps,
        )

        predicted_returns: dict[int, float] = {}
        previous_good_temp = ml_decision.GOOD_TEMP
        try:
            ml_decision.GOOD_TEMP = float(comfort_target)
            step_forecasts, predicted_returns = ml_decision.predict_room_and_return_temps(
                model_data,
                step_features,
                [act],
                force_heating_season=force_heating,
            )
        finally:
            ml_decision.GOOD_TEMP = previous_good_temp

        if step_forecasts:
            ml_next = float(step_forecasts[0])
            mode = plan_act_to_operation_mode(act)
            simple_next = main.simulate_inside_temp_step(
                room_temp,
                target_for_mode,
                float(outside_c),
                mode,
            )
            if act == -1 and ml_next > room_temp + 0.05:
                room_temp = simple_next
            elif act == 1 and ml_next < room_temp - 0.05:
                room_temp = simple_next
            else:
                room_temp = ml_next

        if predicted_returns:
            return_temps = {int(d): float(value) for d, value in predicted_returns.items()}
        else:
            return_temps = _return_temps_from_features(step_features)
        power_kw = float(step_features.get("device_1_power_draw_kw", 0.0))
        if act != 0:
            power_draw = ml_decision.calc_power_draw_from_plan(
                step_start,
                resolve_hrs_to_event(range_events, step_start),
                [act],
                step_features,
            )
            power_kw = float(power_draw.get("total", [power_kw])[0])

        feature_base = _update_feature_data_for_step(
            feature_base,
            room_temp=room_temp,
            outside_c=float(outside_c),
            act=act,
            power_kw=power_kw,
            return_temps=return_temps,
        )

        plans.append(act)
        forecasts.append(room_temp)

    return plans, forecasts


def build_short_term_forecast_simulator(
    *,
    hours: int,
    reference_at: pd.Timestamp | None,
    latitude: float | None,
    longitude: float | None,
    main,
    dummy_preset: str | None = None,
) -> dict:
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

    start_temp = main.current_inside_temp(effective)
    if len(grid) == 0:
        return _empty_payload(main, reference_at, effective, horizon_hours, forecast_model, start_temp)

    first_outside = main.forecast_outside_at(forecast_model, first_bucket, effective)
    feature_base = build_ml_feature_data(main, effective, first_outside)
    feature_base = apply_dummy_preset_to_features(
        feature_base,
        dummy_preset,
        inside_c=start_temp,
        outside_c=first_outside,
    )
    hrs_to_event = resolve_hrs_to_event(range_events, effective)
    comfort_target = resolve_comfort_target_c(
        range_events,
        effective,
        default_c=main.EVENT_TEMP_C,
    )

    ml_steps = max(1, int(np.ceil(horizon_hours * 60 / ML_STEP_MINUTES)))
    model_data = ml_decision._load_simulator_model()
    event_plan = _resolve_event_driven_plan(
        effective=effective,
        feature_data=feature_base,
        hrs_to_event=hrs_to_event,
        comfort_target=comfort_target,
        model_data=model_data,
        ml_steps=ml_steps,
    )
    plan, forecasts = _simulate_ml_horizon(
        main=main,
        effective=effective,
        start_temp=start_temp,
        feature_base=feature_base,
        forecast_model=forecast_model,
        range_events=range_events,
        model_data=model_data,
        ml_steps=ml_steps,
        event_plan=event_plan,
    )

    while len(plan) < ml_steps:
        plan.append(0)
    while len(forecasts) < ml_steps:
        forecasts.append(forecasts[-1] if forecasts else float(start_temp))

    slots: list[dict] = []
    for bucket in grid:
        offset_minutes = int((bucket - effective).total_seconds() // 60)
        step_index = min(max(offset_minutes - 1, 0) // ML_STEP_MINUTES, len(plan) - 1)
        outside_c = main.forecast_outside_at(forecast_model, bucket, effective)
        outside_rounded = round(outside_c, 1) if outside_c is not None else None
        target_c = main.resolve_target_temp_at(bucket, outside_c, range_events, effective)
        inside_c = _interpolate_forecast(start_temp, forecasts, offset_minutes)

        slots.append(
            {
                "timestamp": bucket.strftime("%Y-%m-%d %H:%M:%S"),
                "operationMode": plan_act_to_operation_mode(plan[step_index]),
                "insideTempC": round(float(inside_c), 1),
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
        "predictionModel": "simulator",
        "comfortTargetC": round(float(comfort_target), 1),
        "slots": slots,
    }


def _empty_payload(main, reference_at, effective, horizon_hours, forecast_model, start_temp) -> dict:
    return {
        "referenceAt": effective.strftime("%Y-%m-%d %H:%M UTC"),
        "horizonHours": horizon_hours,
        "intervalMinutes": main.SHORT_TERM_FORECAST_INTERVAL_MINUTES,
        "generatedAt": main.wall_clock_now(reference_at).strftime("%Y-%m-%d %H:%M UTC"),
        "weatherSource": forecast_model.get("source") if forecast_model else None,
        "startingInsideTempC": round(float(start_temp), 1),
        "predictionModel": "simulator",
        "slots": [],
    }
