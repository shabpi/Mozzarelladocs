"""Self-contained thermal model for the dashboard backend.

Heat-pump room model: dT/dt = G*duty - loss [C/h]. Capacities (G) and a
weather-driven idle-drift model are fit from the historical windows; the
AUTO act/idle controller (`decide`) and `predict_curve` then roll a future
room-temperature curve forward from an outside-temperature forecast.
"""

import numpy as np
import pandas as pd

DUTY_CAP = 0.68
CONTROL_MIN = 15
CONTROL_FREQ = f"{CONTROL_MIN}min"
DT_H = CONTROL_MIN / 60
FIT_FREQ = "1h"
SEED_H = 24
SET, LO, HI = 21.0, 20.5, 21.5
HARD_LO, HARD_HI = 11.0, 30.0
MARGIN = 1.15
HYST = 0.15
ALPHA_ACT = 0.3
ALPHA_OFF = 0.6
RATE_FLOOR = 0.1
BAND_HALF = (HI - LO) / 2


def _device_avg(data_dir, freq):
    df = pd.read_csv(
        f"{data_dir}/heat_pump_snapshots.csv",
        parse_dates=["last_seen_at"],
        usecols=[
            "last_seen_at",
            "status_operation_mode",
            "status_temperature_in_celsius",
            "status_temperature_outside_in_celsius",
            "status_is_compressor_active",
            "status_is_defrost_active",
        ],
    )
    df = (
        df[df["status_is_defrost_active"].fillna(0) == 0]
        .set_index("last_seen_at")
        .sort_index()
    )
    return (
        pd.DataFrame(
            {
                "room": df["status_temperature_in_celsius"].resample(freq).mean(),
                "out": df["status_temperature_outside_in_celsius"]
                .resample(freq)
                .mean(),
                "duty": df["status_is_compressor_active"].resample(freq).mean(),
                "cool": (df["status_operation_mode"] == "COOL").resample(freq).mean(),
            }
        )
        .interpolate(limit=3)
        .dropna()
    )


def load_steps(data_dir):
    g = _device_avg(data_dir, CONTROL_FREQ)
    ev = pd.read_csv(
        f"{data_dir}/space_events.csv", parse_dates=["starts_at", "ends_at"]
    )

    in_ev = pd.Series(False, index=g.index)
    for _, e in ev.iterrows():
        in_ev |= (g.index >= e["starts_at"]) & (g.index <= e["ends_at"])
    g["in_event"] = in_ev

    starts = np.sort(ev["starts_at"].unique())
    nxt = pd.Series(pd.NaT, index=g.index, dtype="datetime64[ns]")
    free = g.index[~in_ev]
    fut_idx = np.searchsorted(starts, free.values, side="right")
    nxt.loc[free] = [starts[k] if k < len(starts) else pd.NaT for k in fut_idx]
    g["next_event"] = nxt

    return g


def fit_model(data_dir, is_heating=True, seed_only=True):
    freq = FIT_FREQ if is_heating else CONTROL_FREQ
    step_h = pd.Timedelta(freq) / pd.Timedelta(hours=1)
    duty_floor = 0.0 if is_heating else 0.1

    h = _device_avg(data_dir, freq)
    h["dT"] = (h["room"].shift(-1) - h["room"]) / step_h
    h = h.dropna(subset=["dT"])
    if seed_only:
        h = h[h.index < h.index[0] + pd.Timedelta(hours=SEED_H)]

    L = -h.loc[h["duty"] < 0.05, "dT"].mean()

    if is_heating:
        hu = h[(h["duty"] > duty_floor) & (h["cool"] <= 0.5)]
        G = np.linalg.lstsq(
            hu["duty"].values[:, None], (hu["dT"] + L).values, rcond=None
        )[0][0]
        return G, L

    h["duty_prev"] = h["duty"].shift(1)
    hu = h[(h["duty"] > duty_floor) & (h["cool"] > 0.5)].dropna(subset=["duty_prev"])
    X = np.column_stack([hu["duty"].values, hu["duty_prev"].values])
    coef = np.linalg.lstsq(X, (hu["dT"] + L).values, rcond=None)[0]
    G = coef.sum()

    return G, L


def fit_drift_model(data_dirs):
    feats, targets = [], []
    for data_dir in data_dirs:
        h = _device_avg(data_dir, CONTROL_FREQ)
        h["dT"] = (h["room"].shift(-1) - h["room"]) / DT_H
        idle = h[(h["duty"] < 0.05)].dropna(subset=["dT"])
        if idle.empty:
            continue
        hour = idle.index.hour.to_numpy()
        feats.append(
            np.column_stack(
                [
                    idle["out"].to_numpy(),
                    np.sin(2 * np.pi * hour / 24),
                    np.cos(2 * np.pi * hour / 24),
                    np.ones(len(idle)),
                ]
            )
        )
        targets.append(idle["dT"].to_numpy())

    X = np.vstack(feats)
    y = np.concatenate(targets)
    coef = np.linalg.lstsq(X, y, rcond=None)[0]

    def drift_rate(outside, hour):
        return float(
            coef[0] * outside
            + coef[1] * np.sin(2 * np.pi * hour / 24)
            + coef[2] * np.cos(2 * np.pi * hour / 24)
            + coef[3]
        )

    drift_rate.coef = coef
    return drift_rate


def decide(T, in_event, hrs_to_event, r_heat, r_cool, r_off, setpoint=SET):
    lo, hi = setpoint - BAND_HALF, setpoint + BAND_HALF
    T_base = T + r_off * DT_H

    if in_event:
        if T_base < lo:
            return 1
        if T_base > hi:
            return -1
        return 0

    if T_base < HARD_LO + 1.0:
        return 1
    if T_base > HARD_HI - 1.0:
        return -1
    if np.isnan(hrs_to_event):
        return 0

    if T_base < lo:
        T_evt = T_base + r_heat * (hrs_to_event - DT_H)
        return 1 if T_evt < lo else 0

    T_evt = T_base + r_cool * (hrs_to_event - DT_H)
    return -1 if T_evt > hi else 0


def predict_curve(
    T0,
    timestamps,
    outside,
    in_event,
    setpoint,
    hrs_to_event,
    gross_heat,
    gross_cool,
    drift_model,
    seeds,
):
    rooms, _acts = predict_curve_detailed(
        T0,
        timestamps,
        outside,
        in_event,
        setpoint,
        hrs_to_event,
        gross_heat,
        gross_cool,
        drift_model,
        seeds,
    )
    return rooms


def predict_curve_detailed(
    T0,
    timestamps,
    outside,
    in_event,
    setpoint,
    hrs_to_event,
    gross_heat,
    gross_cool,
    drift_model,
    seeds,
):
    """Return (room_temps, controller_actions) for each step."""
    n = len(timestamps)
    r_heat, r_cool, r_off = seeds["r_heat"], seeds["r_cool"], seeds["r_off"]
    rooms = np.empty(n)
    acts = np.empty(n, dtype=int)
    T = float(T0)

    for k in range(n):
        act = decide(
            T, in_event[k], hrs_to_event[k], r_heat, r_cool, r_off, setpoint[k]
        )
        acts[k] = act
        rooms[k] = T

        drift = drift_model(outside[k], timestamps[k].hour)

        if act == 1:
            dT = gross_heat * DT_H * DUTY_CAP + drift * DT_H
            r_heat = (1 - ALPHA_ACT) * r_heat + ALPHA_ACT * (dT / DT_H)
        elif act == -1:
            dT = gross_cool * DT_H * DUTY_CAP + drift * DT_H
            r_cool = (1 - ALPHA_ACT) * r_cool + ALPHA_ACT * (dT / DT_H)
        else:
            dT = drift * DT_H
            r_off = (1 - ALPHA_OFF) * r_off + ALPHA_OFF * (dT / DT_H)

        T = min(max(T + dT, HARD_LO), HARD_HI)

    return rooms, acts


def act_to_operation_mode(act: int) -> str:
    if act == 1:
        return "heat"
    if act == -1:
        return "cool"
    return "idle"
