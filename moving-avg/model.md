# Thermal model & control policy

This document explains the model behind `sim_policy.py` (and the analysis in
`fit_rates.py`): what it predicts, how it was derived from the IHL dataset, why
it has the form it does, how it was validated, and how the preheat policy uses
it. Heating window (`2026-03-30 → 2026-04-05`) throughout.

---

## 1. The problem

The room is controlled in discrete time steps. The brief proposes 90 s snapshots;
we make decisions every **15 minutes** instead (justified in §7 — it is the
coarsest interval that still holds comfort). At each step we make one binary
decision:

- **ON** — run the heat pump toward the 21 °C setpoint, or
- **OFF** — let the room drift.

Constraints:

- always `11 °C < T < 30 °C`,
- during a booked event, `20.5 °C < T < 21.5 °C` (the comfort band).

Objective: keep comfort while minimizing heating effort (the brief's "minimize
the number of turn-on steps"). To plan that we need to predict how the room
temperature `T` responds to ON/OFF decisions — that is what the model does.

---

## 2. State, control, disturbance

| Symbol | Meaning | Source |
|---|---|---|
| `T` | room air temperature (°C) | `status_temperature_in_celsius`, averaged over the 4 devices |
| `duty` | compressor duty fraction in `[0, 0.68]` | `status_is_compressor_active`, device-averaged |
| `T_out` | outside air temperature (°C) | `status_temperature_outside_in_celsius` |
| `Δt` | one control step = 15 min = `1/4` h | decision interval (§7) |

The control is the ON/OFF decision. **ON commands the duty cap (0.68); OFF
commands 0.** The cap is empirical: across the whole week the compressor never
exceeds ~0.68 duty even when 100 % heating is demanded (see §5), so it is the
ceiling of what "ON" can physically deliver.

---

## 3. Model form

$$\frac{dT}{dt} = G\cdot\text{duty} \;-\; L$$

- `G` (= `gross`, °C/h) — heating contribution per unit duty,
- `L` (°C/h) — a **constant** heat-loss rate.

Discrete per control step (Euler, `Δt = 1/4 h`):

$$T_{k+1} = T_k + \big(G\cdot\text{duty}_k - L\big)\cdot \tfrac{1}{4}$$

That's it: one state, two parameters, linear. It is deliberately simple because
(a) it is all the data supports and (b) it is used in a re-observe-every-step
loop where short-horizon accuracy is what matters (§6). Because it is a *rate*
model (°C/h), the same `G`, `L` apply at any step size.

### 3.1 Why constant loss and not a gap/RC term

The textbook choice is an RC model with conduction loss proportional to the
indoor–outdoor gap:

$$\frac{dT}{dt} = G\cdot\text{duty} - b\,(T - T_{out}) + c .$$

We tried it and **rejected it.** The gap term *looks* predictive across all idle
hours — cooling correlates with the indoor-outdoor gap at +0.71 — but that is a
**daytime-solar confound, not conduction.** Split by time of day:

| idle hours | mean cooling | corr(cool, gap) |
|---|---|---|
| all (n=37) | 0.50 °C/h | +0.71 |
| **night only** (n=25) | 0.77 °C/h | **−0.25** |
| day only (n=7) | −0.09 °C/h (room *warms*) | — |

Daytime idle hours have a small gap *and* solar gain (room barely cools, even
warms); nighttime idle hours have a big gap *and* no sun (room cools ~0.8 °C/h).
Control for time of day and the gap signal vanishes (−0.25, noise at n=25), so a
gap slope would just encode "day vs night." Further symptoms of the bad fit:

- The fitted RC equilibrium was nonsensical: "if held ON forever the room
  settles at `T_out + 47 °C`."
- A 7-day open-loop free-run of the RC model drifted with a sign that *flipped
  with outside temperature*. One straight `b·gap` line cannot fit both regimes.

Free-run RMSE over the week (lower is better):

| Model | RMSE |
|---|---|
| gap/RC loss `−b(T−T_out)+c` | 4.07 °C |
| constant loss `−L` | **2.93 °C** |

Constant loss wins and is simpler, so that is the production model. The rejected
RC fit is left in `fit_rates.py` only to document the comparison.

---

## 4. How the parameters are fit

### 4.1 Data preparation
1. Load `heat_pump_snapshots.csv`, keep `room`, `T_out`, compressor flag.
2. Drop defrost snapshots (`status_is_defrost_active == 1`, only 14 rows) — they
   corrupt the deltas. There are zero alarms in the heating week, so no other
   health filtering is needed.
3. Average across the 4 devices and resample to a regular grid.

### 4.2 Fit on sustained (hourly) windows — even though control runs at 15 min
This is the key methodological point: **the controller runs at 15 min, but the
rates are fit on hourly windows.** Two noise problems force that split.

1. *Measurement noise.* Per-90 s deltas are essentially pure noise — std ≈
   0.044 °C/step vs a real signal of ≈ 0.007 °C/step; a per-step regression gives
   R² ≈ 0. The per-step signal-to-noise of the loss rate grows with the window:
   ~0.28 at 90 s, ~0.70 at 15 min, ~1.0 at 1 h.
2. *Cycling bias on the loss.* More subtly, `L` is biased **toward zero** at fine
   resolution. A 90 s (or even 15 min) "compressor-off" step is usually just the
   unit cycling at setpoint with ΔT ≈ 0, not genuine cooling. Real free-cooling
   is only visible over a *sustained* off-stretch.

Fitted values by window confirm it:

| fit window | `G` (°C/h) | `L` (°C/h) |
|---|---|---|
| 90 s | 0.34 | **0.09** ← biased to ~0 |
| 15 min | 1.82 | 0.42 |
| **1 h** | **2.29** | **0.50** ← true free-cool rate |

So the rates are fit hourly and applied at the 15-min step. The resulting models
validate **identically** at the 1–3 h preheat horizon (§6), so nothing is lost by
fitting coarse.

### 4.3 The two parameters
- **`L` (loss):** mean cooling rate over **free-cooling hours** (compressor
  off): `L = −mean(ΔT_hour | duty = 0)`.
- **`G` (heat-per-duty):** with `L` fixed, least-squares slope of `(ΔT + L)` on
  `duty` over **heating hours** (`duty > 0`), no intercept.

This cleanly separates the two regimes the controller switches between.

---

## 5. Fitted values (heating week)

```
dT/dt = 2.29 · duty − 0.50      [°C/h]
```

| Quantity | Value | Note |
|---|---|---|
| `G` (heat per unit duty) | 2.29 °C/h | at duty = 1 (never reached) |
| `L` (constant loss) | 0.50 °C/h | overnight free-cool rate |
| duty cap | 0.68 | hardware ceiling, never exceeded |
| **max heat-up (ON at cap)** | `2.29·0.68 − 0.50` = **1.06 °C/h** | the binding capacity limit |

**Consequence:** recovering from a typical overnight low of 16 °C up to 21 °C
takes `(21−16)/1.06 ≈ 4.7 h` of heating. This slow capacity — not cycling cost —
is the central constraint of the whole problem.

---

## 6. Validation — the right way

The brief is a **receding-horizon** scheme: *predict the next snapshots, decide,
then observe the actual change.* So the model is validated as a **short-horizon
predictor that is re-anchored to the real temperature each horizon** — not as a
7-day free-run (which no one-state model survives here, because of unmodeled
solar/occupancy gain).

Re-anchored prediction error (reset sim to actual `T`, roll forward `H`, compare):

| Horizon | RMSE | Bias |
|---|---|---|
| 15 min | 0.16 °C | ≈ 0 |
| 1 h | **0.35 °C** | −0.03 °C |
| 3 h | **0.84 °C** | −0.08 °C |

The 3 h figure matters most: it is the preheat-planning horizon. ~0.85 °C
uncertainty there is why the policy carries a lead-time safety margin (§8) and
why the simulated "100 % in-band" should be read as "high, not literally
perfect." The small negative bias means the model predicts slightly *cooler*
than reality — conservative for a heating controller.

Run `python3 sim_policy.py` to reproduce all of these numbers.

---

## 7. Choosing the control interval — why 15 minutes

The decision interval is itself a design choice, and it has a clean optimum.
Running the *same* preheat policy at different intervals:

| control interval | in-band % | event temp min/max | energy (duty-h) |
|---|---|---|---|
| 90 s | 100 % | 21.0 / 21.1 | 37.2 |
| **15 min** | **100 %** | 20.7 / 21.4 | 37.2 |
| 1 h | **56 %** | 20.1 / **22.1** | 37.4 |

The driver is **actuation granularity**. At full power the room moves
~1.06 °C/h, so:

- a **15-min** step changes it ~0.27 °C — comfortably inside the 1 °C-wide band;
- a **1-h** step changes it ~1.06 °C — bang-bang overshoots to 22.1 °C and
  comfort collapses to 56 %;
- **90 s** is no better than 15 min (same 100 %, same energy) — just 10× more
  decisions.

So 15 min is the coarsest interval that still holds the band: fine enough for
comfort, coarse enough to be operationally sane, to fit rates against, and to
make a full dynamic-programming search tractable (672 steps/week, not 6720).
It is also the dataset's own aggregation grid — `heat_pump_intervals.csv` reports
15-min buckets, and its `median_temperature_in_celsius` matches our raw-resampled
mean to **0.013 °C** (so the resolution choice doesn't change the signal). That
file lacks compressor duty and outside temp, though, so fitting still uses the
raw snapshots; its `was_adjusting_temperature` is heating *demand*, not run-time.

Energy is ~37 duty-h at every interval — a consequence of the invariance in §8.2.

---

## 8. The control policy

A bang-bang controller with three modes, evaluated every **15 min**
(`make_floor_policy` in `sim_policy.py`):

1. **During an event** — hold the setpoint: ON if `T < 21.1`, else OFF
   (`±0.1 °C` hysteresis to avoid chatter).
2. **Pre-event preheat** — turn ON early enough to reach 21 °C by the event
   start. The lead time is back-solved from the capacity rate:

   $$\text{lead} = \frac{21 - T}{G\cdot 0.68 - L}\times 1.15$$

   i.e. distance to target ÷ max heat-up rate, with a **1.15× safety margin**
   for model/weather uncertainty. The policy starts heating once
   `time_to_event ≤ lead`.
3. **Otherwise** — maintain an optional overnight floor (ON if `T < floor`).

### 8.1 The overnight floor is (almost) a no-op
Sweeping the floor from 11 → 20 °C changes total heating by < 0.2 % (all give
54 ON-hours). Reason: holding the room warmer overnight costs energy, but it
*also shortens the preheat* by almost exactly the same amount — the two cancel,
because either way you are heating the same room to the same target. Since the
policy already **holds 21 during events**, each night starts warm and only
coasts to ~18 °C before preheat begins, so floors below ~19 never even bind.

**The levers that actually matter are: (1) reach 21 during events, and (2)
preheat ~3 h early.** Not the floor. Recommendation: coast freely (floor = 11,
simplest).

### 8.2 Why the floor (and the heating *schedule*) can't change energy
This is a property of the model, not a coincidence. Integrate `dT/dt = G·duty − L`
over any off-phase of duration `D` that starts and ends at 21 °C:

$$G\!\int\!\text{duty}\,dt - L\,D = 0 \;\Rightarrow\; \int\text{duty}\,dt = \frac{L\,D}{G}.$$

The energy is fixed by the endpoints and the duration — **independent of the
heating pattern**. Coast-then-ramp, hold-flat, or random pulses all cost the
same (verified numerically: 1.53 duty-h for a 7 h off-phase, every schedule). So
under this model there is nothing to optimize in the off-phase shape. That
invariance is a *limitation* of the constant-coefficient model: it cannot see the
two effects that would reward smarter scheduling — COP that varies with outside
temperature (heat when it's milder) and losses that grow with room temperature
(coast lower). Capturing those requires a richer cost model and a DP search.

---

## 9. Result vs the existing controller

| | In comfort band | Mean event temp | Compressor run |
|---|---|---|---|
| Existing (recorded) | **11.4 %** | 19.48 °C | 34.4 duty-h |
| Preheat policy | **~100 %** | 21.16 °C | 37.1 duty-h |

The existing controller under-heats — it tops out around 19.5 °C and essentially
never reaches 21 °C, because its preheat starts too late (~2.5 h) for the
1.06 °C/h capacity. The policy reaches and holds the band at **the same
compressor effort**. Figure: `policy_vs_baseline.png`.

---

## 10. Assumptions & limitations

- **Heating window only.** The cooling window needs the rates refit (`L` sign
  flips, the duty cap may differ).
- **Constant loss** absorbs solar/occupancy/ventilation into one number; it is a
  short-horizon predictor, not a multi-day simulator. Valid roughly in the
  15–21 °C operating range. Note `L = 0.50` is the all-hours average; the true
  *overnight* cooling rate (when preheat/coast actually happen) is ~0.77 °C/h, so
  the model slightly under-predicts night coasting. The closed-loop re-observation
  and the 1.15× preheat margin absorb this; a day/night two-value `L` would remove
  it if needed.
- **Duty as a heat proxy.** Per-decision energy is reported as compressor
  running time, not kWh: site power is dominated by aux/ventilation (~4.7 kW idle
  vs 20–64 kW heating), so a clean kWh-per-decision mapping isn't identifiable
  from this data. This also means the model can't yet exploit COP-vs-temperature
  for smarter scheduling (§8.2).
- **"100 % in-band" is model-optimistic.** Real compliance is high but bounded
  by the 0.84 °C 3-h prediction uncertainty; the 1.15× lead margin hedges it.

---

## 11. Adaptive-rate AUTO controller (both windows)

`adaptive_controller.py` is an AUTOMATIC-mode controller whose only per-step
decision is **binary — ACT or IDLE** (the brief's "turn on / turn off"). When it
acts, the **direction is automatic**, set by room temp vs the 21 °C target: heat
if below, cool if above. This matches the space config (Mode = AUTOMATIC) and
means a warm day inside the heating week is handled by *cooling*, not by
overshooting.

Rates are estimated **online** (EWMA of the realized ΔT each step): `r_heat`
while heating, `r_cool` while cooling, `r_off` while idle. They carry outside
temp / solar / occupancy implicitly and need **no per-season refit**; the fitted
constants only seed them, and the estimate self-corrects near equilibrium
(observed slope flattens → forecast flattens), removing the "cools forever"
artefact. Hardware capacities reused in both windows: `gross_heat = +2.29`,
`gross_cool = −1.74 °C/h` (the latter only identifiable from the cooling week's
rare COOL-mode bursts — that window is 95 % HEAT-mode/idle).

**Evaluation = disturbance-replay plant** (`drift_k = ΔT_real − G_real·duty_real`):
reproduces reality under the recorded policy, so counterfactual ACT decisions get
the real disturbance on top of the chosen heat/cool capacity. Stricter and more
honest than the clean-model plant of §6–§9 (hence heating is 95 %, not 100 %).

Results (15-min control):

| window | controller | in-band % | below | above | duty-h |
|---|---|---|---|---|---|
| Heating | baseline (recorded) | 11.4 | 88.6 | 0.0 | 34.4 |
| Heating | **AUTO adaptive** | **95.4** | 4.1 | 0.4 | 54.9 |
| Cooling | baseline (recorded) | 20.0 | 10.5 | 69.5 | 7.3 |
| Cooling | **AUTO adaptive** | **73.7** | 4.2 | 22.1 | 15.3 |

Honest readout:
- **Heating 11 → 95 %:** the AUTO controller cools on the warm day (04-05) instead
  of overshooting, so above-band collapses from 12 % (heat-only) to 0.4 %. Cost:
  more compressor time (35 → 55 duty-h) — it holds the tight band and cools midday,
  vs the baseline that simply under-conditioned.
- **Cooling 20 → 74 %:** allowing it to heat fixed the below-band; the remaining
  22 % above-band is a genuine **capacity limit** — on the hottest events the
  ~−1.1 °C/h cooling can't fully counter the gain.
- Adaptive vs constant-seed is still close on the comfort metric (in-event control
  is reactive bang-bang); adaptivity's measurable wins are prediction accuracy,
  robustness to a wrong prior, and no per-season refit. **The act/idle +
  auto-direction redesign is what moved the comfort numbers**, by removing the
  heat-only limitation.
- Minor: some HEAT/COOL chatter at the band edges (bang-bang crossing the
  deadband); a minimum on/off time would smooth it.

Figures: `adaptive_week_heating.png`, `adaptive_first_day_heating.png` (cold-day
preheat), `adaptive_warm_day_heating.png` (warm-day cooling).

---

## 12. Reproduce

```bash
python3 fit_rates.py          # rate analysis, duty cap, baseline comfort, model-choice rationale
python3 sim_policy.py         # fixed-model fit + 15-min validation + floor sweep
python3 plot_policy.py        # -> policy_vs_baseline.png (fixed model, clean plant)
python3 adaptive_controller.py# AUTO act/idle adaptive controller, both windows
python3 plot_adaptive.py      # -> adaptive_week / first_day / warm_day _heating.png
```
