import { getCo2Quality } from "../../utils/co2Utils";

function HudChip({ label, value, unit = "°C", accent = "#94a3b8", sublabel }) {
  const display =
    value == null || value === ""
      ? "—"
      : unit === "" || unit === "°C"
        ? `${value}${unit === "°C" ? "°C" : unit}`
        : `${value}${unit}`;

  return (
    <div
      className="rounded-md border bg-black/75 px-2.5 py-1.5 text-[10px] text-white shadow-lg backdrop-blur-sm"
      style={{ borderColor: accent }}
    >
      <p className="font-medium text-white/85">{label}</p>
      <p className="text-sm font-semibold" style={{ color: accent }}>
        {display}
      </p>
      {sublabel && <p className="text-[9px] text-white/60">{sublabel}</p>}
    </div>
  );
}

export default function RoomSceneHud({
  insideTemp,
  targetTemp,
  targetIsStandby,
  returnTemp,
  outsideTemp,
  co2Ppm,
  hvacMode,
  powerKw,
  eventActive,
  eventName,
}) {
  const pumpLabel =
    hvacMode === "heating"
      ? "Heating"
      : hvacMode === "cooling"
        ? "Cooling"
        : "Standby";

  const co2Quality = getCo2Quality(co2Ppm);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3">
      <div className="flex max-w-[min(100%,42rem)] flex-wrap gap-2">
        <HudChip
          label={targetIsStandby ? "Target (standby)" : "Target"}
          value={targetTemp?.toFixed?.(1)}
          accent="#0b75b7"
        />
        <HudChip
          label="Inside"
          value={insideTemp?.toFixed?.(1)}
          accent="#ff6148"
        />
        <HudChip
          label="Recorded (return)"
          value={returnTemp?.toFixed?.(1)}
          accent="#a78bfa"
        />
        <HudChip
          label="Outside"
          value={outsideTemp?.toFixed?.(1)}
          accent="#38bdf8"
        />
        {co2Ppm != null && (
          <HudChip
            label="CO₂"
            value={Math.round(co2Ppm)}
            unit=" ppm"
            accent={co2Quality.color}
            sublabel={co2Quality.label}
          />
        )}
        <HudChip
          label="Power"
          value={
            powerKw != null
              ? `${pumpLabel} · ${powerKw.toFixed(1)} kW`
              : pumpLabel
          }
          unit=""
          accent={
            hvacMode === "heating"
              ? "#f97316"
              : hvacMode === "cooling"
                ? "#38bdf8"
                : "#94a3b8"
          }
        />
      </div>

      {eventActive && (
        <div className="max-w-[13rem] shrink-0 rounded-lg border-2 border-amber-400/90 bg-amber-950/75 px-3 py-2 shadow-lg backdrop-blur-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">
            Event in progress
          </p>
          <p className="mt-0.5 text-xs leading-snug text-amber-100/95">
            {eventName ?? "Occupied period"}
          </p>
          <p className="mt-1 text-[10px] text-amber-200/75">
            Occupants shown in seats
          </p>
        </div>
      )}
    </div>
  );
}
