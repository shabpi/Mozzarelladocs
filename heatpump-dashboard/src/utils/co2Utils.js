import { BUCKET_MS, parseTimestamp } from "./chartUtils";

export const CO2_SCALE_MIN = 400;
export const CO2_SCALE_MAX = 1200;

export const CO2_NO_DATA_VALUE = 0;

/** Display value for CO₂ text boxes — missing readings become 0. */
export function normalizeCo2Ppm(ppm) {
  if (ppm == null || Number.isNaN(Number(ppm))) return CO2_NO_DATA_VALUE;
  return Number(ppm);
}

/** True when the point carries a real sensor reading (not a gap / missing slot). */
export function hasCo2Reading(ppm) {
  const value = ppm == null ? null : Number(ppm);
  return value != null && !Number.isNaN(value) && value > 0;
}

/** CO₂ at the hovered timestamp only — never borrowed from a nearby bucket. */
export function resolveCo2PpmAtTime(points, timeMs) {
  if (timeMs == null || Number.isNaN(timeMs) || !points?.length) return null;

  const halfBucket = BUCKET_MS / 2;

  for (const point of points) {
    if (point.domainAnchor) continue;
    const t = point.time ?? parseTimestamp(point.timestamp);
    if (Number.isNaN(t)) continue;
    if (Math.abs(t - timeMs) <= halfBucket) {
      return point.co2Ppm ?? null;
    }
  }

  return null;
}

export const CO2_QUALITY_ZONES = [
  { min: 400, max: 600, label: "Excellent", color: "rgba(34, 197, 94, 0.14)" },
  { min: 600, max: 800, label: "Good", color: "rgba(132, 204, 22, 0.14)" },
  { min: 800, max: 1000, label: "Fair", color: "rgba(234, 179, 8, 0.14)" },
  { min: 1000, max: 1200, label: "Moderate", color: "rgba(249, 115, 22, 0.14)" },
  { min: 1200, max: 1600, label: "Poor", color: "rgba(239, 68, 68, 0.14)" },
];

export function co2RingProgress(ppm) {
  if (ppm == null || Number.isNaN(ppm)) return 0;
  const span = CO2_SCALE_MAX - CO2_SCALE_MIN;
  return Math.min(1, Math.max(0, (ppm - CO2_SCALE_MIN) / span));
}

export function getCo2Quality(ppm) {
  if (ppm == null || Number.isNaN(ppm) || ppm <= 0) {
    return {
      label: "No reading",
      color: "#94a3b8",
      description: "CO₂ reading unavailable",
    };
  }

  if (ppm <= 600) {
    return {
      label: "Excellent",
      color: "#22c55e",
      description: "Fresh air quality",
    };
  }
  if (ppm <= 800) {
    return {
      label: "Good",
      color: "#84cc16",
      description: "Comfortable indoor air",
    };
  }
  if (ppm <= 1000) {
    return {
      label: "Fair",
      color: "#eab308",
      description: "Ventilation recommended",
    };
  }
  if (ppm <= 1200) {
    return {
      label: "Moderate",
      color: "#f97316",
      description: "Consider increasing airflow",
    };
  }
  return {
    label: "Poor",
    color: "#ef4444",
    description: "Improve ventilation",
  };
}
