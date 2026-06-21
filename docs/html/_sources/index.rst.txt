=====================================
Automatic predictive thermal control
=====================================

A single-state predictive controller for the lecture-hall heat pump. It models
how the room temperature responds to ON/OFF compressor decisions, then runs a
re-observe-every-step loop that keeps each booked event inside the
:math:`20.5\text{–}21.5\,^\circ\text{C}` comfort band at minimal heating effort.


Introduction: the physical differential equation
=================================================

The room is treated as a single lumped thermal mass. Its temperature changes at
a rate set by the heat the compressor injects minus the heat lost to ambient:

.. math::

   C\,\frac{dT}{dt} \;=\; \underbrace{Q_\text{hp}}_{\text{compressor}}
                         \;-\; \underbrace{Q_\text{loss}}_{\text{to ambient}} .

Dividing by the heat capacity :math:`C` and absorbing constants into rate
coefficients gives the working model — one state :math:`T`, two parameters:

.. math::

   \frac{dT}{dt} \;=\; G \cdot \text{duty} \;-\; L ,

where

- :math:`T` is room air temperature (°C), the average over the four devices,
- :math:`\text{duty}\in[0,\,0.68]` is the compressor duty fraction (0.68 is the
  empirical hardware ceiling — ON commands the cap, OFF commands 0),
- :math:`G` (°C/h) is the heating contribution per unit duty, and
- :math:`L` (°C/h) is a **constant** heat-loss rate.

The loss is taken constant rather than as an RC gap term
:math:`-\,b\,(T-T_{out})`: across the dataset that gap term is a daytime-solar
confound, not conduction, so a single net loss predicts better at the control
horizon and does not blow up in open loop.

**Generalized to AUTOMATIC mode.** When the controller may both heat and cool,
the gross term becomes directional and the *direction is automatic*, set by the
room temperature relative to the :math:`T^{*}=21\,^\circ\text{C}` target:

.. math::

   \frac{dT}{dt} \;=\; G_{\sigma}\cdot\text{duty} \;-\; L ,
   \qquad
   \sigma \;=\;
   \begin{cases}
     \text{HEAT}, & T < T^{*} \\[2pt]
     \text{COOL}, & T > T^{*}
   \end{cases}

with :math:`G_\text{HEAT}=+2.29` and :math:`G_\text{COOL}=-1.74\;^\circ\text{C/h}`.
Idling sets :math:`\text{duty}=0`, leaving the passive drift
:math:`dT/dt=-L`. Discretised for the controller's step (forward Euler,
:math:`\Delta t = \tfrac{1}{4}\,\text{h}`):

.. math::

   T_{k+1} \;=\; T_k + \bigl(G_{\sigma_k}\cdot\text{duty}_k - L\bigr)\,\Delta t .

On the heating week the fit is :math:`dT/dt = 2.29\,\text{duty} - 0.50`, so the
maximum heat-up at the duty cap is
:math:`2.29\cdot0.68 - 0.50 = 1.06\;^\circ\text{C/h}` — the slow capacity that is
the binding constraint of the whole problem.


Generalized heuristic moving average
====================================

The two fixed coefficients :math:`(G, L)` are accurate but season-specific: they
must be refit when conditions change, and they cannot see solar gain, occupancy
or shifting outdoor temperature. The generalized controller replaces them with
**online rate estimates** — an exponentially weighted moving average (EWMA) of
the *realised* temperature change in each mode. Because the estimates are built
from observed :math:`\Delta T`, they absorb every disturbance implicitly and need
no per-season refit; the fitted constants only seed them.

Driving equations
-----------------

At each step the controller observes the realised instantaneous rate over the
step just completed:

.. math::

   \rho_k \;=\; \frac{T_k - T_{k-1}}{\Delta t} \qquad [^\circ\text{C/h}] .

It maintains one rate per mode, :math:`r_m` for
:math:`m\in\{\text{HEAT},\text{COOL},\text{IDLE}\}`, and updates **only the mode
that was actually applied** over the last step, with smoothing
:math:`\alpha\in(0,1]`:

.. math::

   r_{\sigma_{k-1}} \;\leftarrow\; \alpha\,\rho_k \;+\; (1-\alpha)\,r_{\sigma_{k-1}} .

Each :math:`r_m` is therefore a *net* rate: it already contains the loss and the
disturbance, not just the compressor contribution. The estimates are seeded from
the physical fit:

.. math::

   r_\text{HEAT}^{(0)} = G_\text{HEAT}\,u_\text{cap} - L = +1.06,
   \qquad
   r_\text{IDLE}^{(0)} = -L = -0.50,
   \qquad
   r_\text{COOL}^{(0)} = G_\text{COOL}\,u_\text{cap} - L .

Forecasting a candidate mode over a horizon :math:`H` is then a single linear
extrapolation from the *current* measured temperature (re-anchored every step):

.. math::

   \hat{T}_m(\tau) \;=\; T_k + r_m\,\tau , \qquad \tau\in[0, H] .

The act/idle decision compares the coast forecast (:math:`r_\text{IDLE}`) against
the band. To preheat, the lead time is back-solved from the acting rate in the
auto-selected direction :math:`d_k`, with a 1.15× safety margin for residual
model and weather error:

.. math::

   \text{lead}_k \;=\; \frac{T^{*} - T_k}{r_{d_k}}\times 1.15 .

Self-correction near equilibrium is automatic: as the room approaches steady
state the realised :math:`\rho_k` flattens, so the EWMA flattens the forecast
too — removing the "cools forever" artefact that a fixed slope would produce.

The general loop
----------------

The controller is a receding-horizon loop run every :math:`\Delta t = 15`
minutes. Each step:

#. **Sense** the room temperature :math:`T_k` (average of the four devices).
#. **Update** the EWMA for the mode just applied:
   :math:`r_{\sigma_{k-1}} \leftarrow \alpha\,\rho_k + (1-\alpha)\,r_{\sigma_{k-1}}`.
#. **Choose direction** automatically:
   :math:`d_k = \text{HEAT}` if :math:`T_k < T^{*}`, else :math:`\text{COOL}`.
#. **Forecast** the coast and the acting trajectories over the horizon using
   :math:`\hat{T}_m(\tau) = T_k + r_m\,\tau`, and compute :math:`\text{lead}_k`.
#. **Decide ACT or IDLE** — act in direction :math:`d_k` at the duty cap if
   coasting would leave the band within the lead horizon (or an event is within
   :math:`\text{lead}_k`); otherwise idle.
#. **Apply** the chosen mode for one step, observe :math:`T_{k+1}`, set
   :math:`k\leftarrow k+1`, and repeat.

The fixed-coefficient model is the special case :math:`\alpha\to 0`: the rates
stay frozen at their physical seeds and the loop reduces to the constant
:math:`(G, L)` predictor.