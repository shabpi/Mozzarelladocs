"""
model.py — self-contained heat-pump thermal model + AUTO adaptive controller.

Single-file version of the whole pipeline: data loading, rate fitting (heating &
cooling), the AUTOMATIC act/idle adaptive controller, evaluation on a
disturbance-replay plant, and the figures. Run `python3 model.py` to reproduce
the results table and the PNGs.

The original split files (fit_rates.py, sim_policy.py, adaptive_controller.py,
plot_adaptive.py) are kept as development history; this file supersedes them and
has no project-internal imports. See model.md for the full write-up.

Model:  dT/dt = G*duty - loss   [C/h], constant loss (the outside-temp dependence
is a daytime-solar confound, not conduction — see model.md). The controller's
only decision each 15-min step is binary ACT/IDLE; when it acts the DIRECTION is
automatic (heat if room < 21, cool if room > 21), matching the space's AUTOMATIC
mode. Rates r_heat / r_cool / r_off are estimated online (EWMA of realized dT).
"""
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

# ----------------------------------------------------------------- constants
DUTY_CAP = 0.68             # compressor never exceeds this, even at 100% demand
CONTROL_MIN = 15           # decision interval (minutes)
CONTROL_FREQ = f"{CONTROL_MIN}min"
DT_H = CONTROL_MIN / 60    # one control step in hours (= 0.25)
FIT_FREQ = "1h"           # rates fit on SUSTAINED windows, applied at DT_H
SET, LO, HI = 21.0, 20.5, 21.5     # setpoint + comfort band during events
HARD_LO, HARD_HI = 11.0, 30.0      # hard limits at all times
MARGIN = 1.15              # pre-condition lead safety factor
HYST = 0.15               # idle deadband around setpoint (> one step's move)
ALPHA = 0.2               # EWMA weight for online rate estimates
RATE_FLOOR = 0.1          # min |approach rate| used in lead calc

WINDOWS = {
    "heating": (Path.cwd() / "ihl_research_dataset/heating_2026-03-30_to_2026-04-05", +1),
    "cooling": (Path.cwd() /"ihl_research_dataset/cooling_2026-05-25_to_2026-05-31", -1),
}


# -------------------------------------------------------------- data loading
def _device_avg(data_dir, freq):
    """Room/outside/duty (compressor-active fraction) averaged over devices."""
    df = pd.read_csv(
        f"{data_dir}/heat_pump_snapshots.csv", parse_dates=["last_seen_at"],
        usecols=["last_seen_at", "status_temperature_in_celsius",
                 "status_temperature_outside_in_celsius",
                 "status_is_compressor_active", "status_is_defrost_active"],
    )
    df = df[df["status_is_defrost_active"].fillna(0) == 0].set_index("last_seen_at").sort_index()
    return pd.DataFrame({
        "room": df["status_temperature_in_celsius"].resample(freq).mean(),
        "out":  df["status_temperature_outside_in_celsius"].resample(freq).mean(),
        "duty": df["status_is_compressor_active"].resample(freq).mean(),
    }).interpolate(limit=3).dropna()


def load_steps(data_dir):
    """Control grid (15 min) with in_event flag and next-event-start time."""
    g = _device_avg(data_dir, CONTROL_FREQ)
    ev = pd.read_csv(f"{data_dir}/space_events.csv", parse_dates=["starts_at", "ends_at"])
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


# ----------------------------------------------------------------- rate fits
def fit_model(data_dir):
    """Heating: (gross, L) = heat-per-duty and constant loss [C/h].

    Fit on sustained hourly windows so the loss isn't biased toward zero by
    setpoint-cycling 'off' steps (a 90 s/15 min off-step is mostly cycling at
    setpoint, dT~0; real free-cooling only shows over a sustained off-stretch)."""
    h = _device_avg(data_dir, FIT_FREQ)
    h["dT"] = h["room"].shift(-1) - h["room"]
    h = h.dropna(subset=["dT"])
    L = -h.loc[h["duty"] == 0, "dT"].mean()
    hu = h[h["duty"] > 0]
    gross = np.linalg.lstsq(hu["duty"].values[:, None], (hu["dT"] + L).values, rcond=None)[0][0]
    return gross, L


def fit_cooling(data_dir):
    """Cooling: (gross<0, L) fit from COOL-mode compressor bursts.

    The cooling window is ~95% HEAT-mode/idle, so a whole-window fit sees no
    cooling; the capacity only shows in the short COOL-mode bursts."""
    df = pd.read_csv(f"{data_dir}/heat_pump_snapshots.csv", parse_dates=["last_seen_at"],
                     usecols=["last_seen_at", "status_operation_mode",
                              "status_temperature_in_celsius",
                              "status_is_compressor_active", "status_is_defrost_active"])
    df = df[df["status_is_defrost_active"].fillna(0) == 0].set_index("last_seen_at").sort_index()
    g = pd.DataFrame({
        "room": df["status_temperature_in_celsius"].resample(CONTROL_FREQ).mean(),
        "cool": (df["status_operation_mode"] == "COOL").resample(CONTROL_FREQ).mean(),
        "duty": df["status_is_compressor_active"].resample(CONTROL_FREQ).mean(),
    }).dropna()
    g["dT"] = g["room"].shift(-1) - g["room"]; g = g.dropna()
    ca = g[(g["cool"] > 0.5) & (g["duty"] > 0.1)]
    idle = g[g["duty"] < 0.05]
    L = -(idle["dT"].mean() / DT_H)
    gross = ((ca["dT"].mean() / DT_H) + L) / ca["duty"].mean()
    return gross, L


# ---------------------------------------------------------- disturbance plant
def build_plant(data_dir, direction, gross_heat, gross_cool):
    """Per-window disturbance-replay plant + online-rate seeds.

    drift_k = dT_real - G_real*duty_real is replayed as a disturbance, so under
    the recorded policy the plant reproduces reality, and counterfactual ACT
    decisions get the real disturbance on top of the chosen heat/cool capacity."""
    g = load_steps(data_dir).copy()
    real_gross = gross_heat if direction > 0 else gross_cool
    g["dT_real"] = g["room"].shift(-1) - g["room"]
    g["drift"] = g["dT_real"] - real_gross * DT_H * g["duty"]
    g = g.iloc[:-1]
    r_off0 = g.loc[g["duty"] < 0.05, "drift"].mean() / DT_H        # signed idle drift
    seeds = {
        "r_heat": gross_heat * DUTY_CAP + r_off0,                  # net heat rate (+)
        "r_cool": gross_cool * DUTY_CAP + r_off0,                  # net cool rate (-)
        "r_off": r_off0,
    }
    return g, seeds


# --------------------------------------------------------------- controller
def decide(T, in_event, hrs_to_event, r_heat, r_cool, r_off):
    """Binary ACT (True) / IDLE (False). Direction is implied by sign(T-SET)."""
    if in_event:
        return abs(T - SET) > HYST                       # act to pull into the band
    if T < HARD_LO + 1.0 or T > HARD_HI - 1.0:           # hard-limit guard
        return True
    if np.isnan(hrs_to_event):
        return False
    T_evt = T + r_off * hrs_to_event                     # predicted coast at event
    if T_evt < LO and T < SET:                           # will be too cold -> preheat
        return hrs_to_event <= (SET - T) / max(r_heat, RATE_FLOOR) * MARGIN
    if T_evt > HI and T > SET:                            # will be too warm -> precool
        return hrs_to_event <= (T - SET) / max(-r_cool, RATE_FLOOR) * MARGIN
    return False


def simulate(g, gross_heat, gross_cool, seeds, adaptive=True):
    """Roll the plant forward under the AUTO act/idle controller."""
    idx = g.index
    drift = g["drift"].values; in_ev = g["in_event"].values; nxt = g["next_event"].values
    T = g["room"].iloc[0]
    r_heat, r_cool, r_off = seeds["r_heat"], seeds["r_cool"], seeds["r_off"]
    rooms = np.empty(len(idx)); duties = np.empty(len(idx)); acts = np.empty(len(idx))
    for k, t in enumerate(idx):
        hte = ((nxt[k] - np.datetime64(t)) / np.timedelta64(1, "h")
               if not pd.isna(nxt[k]) else np.nan)
        act = decide(T, in_ev[k], hte, r_heat, r_cool, r_off)
        heating = T < SET                                # automatic direction
        rooms[k] = T
        duties[k] = DUTY_CAP if act else 0.0
        acts[k] = (1 if heating else -1) if act else 0
        gross = (gross_heat if heating else gross_cool) if act else 0.0
        dT = gross * DT_H * DUTY_CAP + drift[k]
        rate_obs = dT / DT_H
        if adaptive:                                     # causal: update AFTER deciding
            if act and heating:
                r_heat = (1 - ALPHA) * r_heat + ALPHA * rate_obs
            elif act:
                r_cool = (1 - ALPHA) * r_cool + ALPHA * rate_obs
            else:
                r_off = (1 - ALPHA) * r_off + ALPHA * rate_obs
        T = T + dT
    return pd.DataFrame({"room": rooms, "duty": duties, "act": acts,
                         "out": g["out"].values, "in_event": in_ev}, index=idx)


def metrics(sim):
    ev = sim[sim["in_event"]]
    return {
        "in_band_pct": ((ev["room"] >= LO) & (ev["room"] <= HI)).mean() * 100,
        "below_pct": (ev["room"] < LO).mean() * 100,
        "mean_event_room": ev["room"].mean(),
        "duty_hours": sim["duty"].sum() * DT_H,
    }


# ---------------------------------------------------------------- validation
def horizon_validation(data_dir, gross, L, horizons_h=(0.25, 1, 3)):
    """Re-anchored short-horizon prediction error of the constant-rate model."""
    g = _device_avg(data_dir, CONTROL_FREQ)
    room, duty = g["room"].values, g["duty"].values
    out = {}
    for hh in horizons_h:
        H = max(1, int(round(hh / DT_H)))
        errs = []
        for i in range(0, len(g) - H, H):
            T = room[i]
            for k in range(H):
                T = T + (gross * duty[i + k] - L) * DT_H
            errs.append(T - room[i + H])
        out[hh] = np.sqrt(np.mean(np.square(errs)))
    return out


# ------------------------------------------------------------------ reporting
def run_window(name, data_dir, direction, gross_heat, gross_cool):
    g, seeds = build_plant(data_dir, direction, gross_heat, gross_cool)
    base = metrics(g.assign(room=g["room"], duty=g["duty"]))
    adp = metrics(simulate(g, gross_heat, gross_cool, seeds, adaptive=True))
    con = metrics(simulate(g, gross_heat, gross_cool, seeds, adaptive=False))
    print(f"\n=== {name.upper()} window  (seeds r_heat={seeds['r_heat']:+.2f}, "
          f"r_cool={seeds['r_cool']:+.2f}, r_off={seeds['r_off']:+.2f}) ===")
    print(f"  {'':18s} {'in-band%':>9} {'below%':>7} {'above%':>7} {'mean-evt':>9} {'duty-h':>7}")
    for lbl, m in [("baseline (recorded)", base), ("constant-rate ctrl", con),
                   ("ADAPTIVE ctrl", adp)]:
        ab = 100 - m["in_band_pct"] - m["below_pct"]
        print(f"  {lbl:18s} {m['in_band_pct']:9.1f} {m['below_pct']:7.1f} {ab:7.1f} "
              f"{m['mean_event_room']:9.2f} {m['duty_hours']:7.1f}")


# -------------------------------------------------------------------- figures
def make_figures(gross_heat, gross_cool):
    """Heating-window figures: week + cold first day + warm day."""
    data_dir, direction = WINDOWS["cooling"]
    g, seeds = build_plant(data_dir, direction, gross_heat, gross_cool)
    sim = simulate(g, gross_heat, gross_cool, seeds, adaptive=True)
    mb, mp = metrics(g.assign(room=g["room"], duty=g["duty"])), metrics(sim)
    ev = pd.read_csv(f"{data_dir}/space_events.csv", parse_dates=["starts_at", "ends_at"]) \
           .drop_duplicates(subset=["starts_at", "ends_at"])

    def shade(ax, t0, t1, band=True):
        for _, e in ev.iterrows():
            if e["ends_at"] < t0 or e["starts_at"] > t1:
                continue
            a, b = max(e["starts_at"], t0), min(e["ends_at"], t1)
            ax.axvspan(a, b, color="0.85", zorder=0)
            if band:
                ax.fill_between([a, b], LO, HI, color="tab:green", alpha=0.25, zorder=1)

    # week
    fig, ax = plt.subplots(figsize=(14, 5))
    shade(ax, g.index[0], g.index[-1])
    ax.plot(g.index, g["room"], color="tab:red", lw=1.0, label=f"Baseline · {mb['in_band_pct']:.0f}% in band")
    ax.plot(sim.index, sim["room"], color="tab:blue", lw=1.0, label=f"AUTO policy · {mp['in_band_pct']:.0f}% in band")
    ax.axhline(SET, color="tab:green", ls=":", lw=1)
    ax.set_ylabel("Room temperature (°C)"); ax.set_ylim(11, 30)
    ax.set_title("AUTO act/idle controller vs baseline — heating week (acts to hold the green band)")
    ax.legend(loc="lower right", fontsize=9)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    fig.tight_layout(); fig.savefig("adaptive_week_cooling.png", dpi=130)

    def day_plot(date, fname, title):
        t0 = pd.Timestamp(date); t1 = t0 + pd.Timedelta(days=1)
        d, db = sim.loc[t0:t1], g.loc[t0:t1]
        fig, (axT, axU) = plt.subplots(2, 1, figsize=(12, 6.5), sharex=True,
                                       gridspec_kw={"height_ratios": [3, 1]})
        shade(axT, t0, t1)
        axT.plot(db.index, db["room"], color="tab:red", lw=1.3, label="Baseline (recorded)")
        axT.plot(d.index, d["room"], color="tab:blue", lw=1.7, label="AUTO policy")
        axT.plot(d.index, d["out"], color="tab:orange", lw=1.0, ls="-.", label="Outside")
        axT.axhline(SET, color="tab:green", ls=":", lw=1)
        axT.set_ylabel("Temperature (°C)"); axT.set_title(title); axT.legend(loc="best", fontsize=9)
        axU.fill_between(d.index, 0, (d["act"] > 0).astype(int), step="post", color="tab:red", alpha=0.55, label="HEAT")
        axU.fill_between(d.index, 0, (d["act"] < 0).astype(int), step="post", color="tab:cyan", alpha=0.7, label="COOL")
        shade(axU, t0, t1, band=False)
        axU.set_yticks([0, 1]); axU.set_yticklabels(["idle", "ACT"]); axU.set_ylim(-0.1, 1.1)
        axU.set_ylabel("Decision"); axU.legend(loc="upper right", fontsize=8, ncol=2)
        axU.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M")); axU.set_xlabel("Time of day (UTC)")
        fig.tight_layout(); fig.savefig(fname, dpi=130)

    day_plot("2026-03-30", "adaptive_first_day_heating.png",
             "Heating — cold first day (2026-03-30): preheat ramp into the band before 04:30")
    day_plot("2026-04-05", "adaptive_warm_day_heating.png",
             "Heating — warm day (2026-04-05): heats at dawn, then COOLS midday as outside hits 24°C")
    print("\nsaved adaptive_week_heating.png, adaptive_first_day_heating.png, adaptive_warm_day_heating.png")


# ----------------------------------------------------------------------- main
def main():
    gh, Lh = fit_model(WINDOWS["heating"][0])
    gc, Lc = fit_cooling(WINDOWS["cooling"][0])
    print(f"hardware capacities: gross_heat={gh:+.2f} C/h, gross_cool={gc:+.2f} C/h")
    val = horizon_validation(WINDOWS["heating"][0], gh, Lh)
    print("constant-model receding-horizon RMSE: "
          + ", ".join(f"{h}h={r:.2f}C" for h, r in val.items()))
    for name, (d, direction) in WINDOWS.items():
        run_window(name, d, direction, gh, gc)
    make_figures(gh, gc)


if __name__ == "__main__":
    main()
