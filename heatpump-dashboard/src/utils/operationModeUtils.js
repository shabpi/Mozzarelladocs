export const OPERATION_MODE_STYLES = {
  heat: {
    label: "Heating",
    shortLabel: "Heat",
    fill: "#f97316",
    fillOpacity: 0.55,
    stroke: "#fb923c",
    dot: "bg-orange-400",
    badge: "bg-orange-500/20 text-orange-200 border-orange-400/40",
  },
  cool: {
    label: "Cooling",
    shortLabel: "Cool",
    fill: "#38bdf8",
    fillOpacity: 0.55,
    stroke: "#7dd3fc",
    dot: "bg-sky-400",
    badge: "bg-sky-500/20 text-sky-200 border-sky-400/40",
  },
  idle: {
    label: "Idle",
    shortLabel: "Idle",
    fill: "#94a3b8",
    fillOpacity: 0.45,
    stroke: "#cbd5e1",
    dot: "bg-slate-400",
    badge: "bg-slate-500/20 text-slate-200 border-slate-400/40",
  },
};

export function getOperationModeStyle(mode) {
  return OPERATION_MODE_STYLES[mode] ?? OPERATION_MODE_STYLES.idle;
}

export function formatOperationMode(mode) {
  return getOperationModeStyle(mode).label;
}

/** Mirrors backend `resolve_short_term_operation_mode` (comfort band ±2 °C). */
export function resolveShortTermOperationMode(insideC, targetC, outsideC, toleranceC = 2) {
  if (insideC == null || targetC == null) return "idle";

  const gap = targetC - insideC;
  if (Math.abs(gap) <= toleranceC) return "idle";
  if (gap > toleranceC) return "heat";
  if (gap < -toleranceC && outsideC != null && outsideC > targetC) return "cool";
  return "idle";
}
