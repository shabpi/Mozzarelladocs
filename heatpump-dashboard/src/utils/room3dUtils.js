export function tempToColor(insideTemp, targetTemp) {
  if (insideTemp == null || targetTemp == null) return "#0b75b7";

  const diff = insideTemp - targetTemp;
  if (diff < -1) return "#3b82f6";
  if (diff > 1) return "#ef4444";
  return "#22c55e";
}

export function tempToHexOpacity(insideTemp, targetTemp) {
  if (insideTemp == null || targetTemp == null) return 0.28;
  const diff = Math.abs(insideTemp - targetTemp);
  return Math.min(0.55, 0.22 + diff * 0.08);
}

export function co2ToColor(ppm) {
  if (ppm == null) return "#64748b";
  if (ppm < 800) return "#22c55e";
  if (ppm < 1200) return "#eab308";
  return "#ef4444";
}

export function co2ToOpacity(ppm) {
  if (ppm == null) return 0.08;
  return Math.min(0.45, 0.1 + (ppm / 2000) * 0.35);
}

export function parseTimestampMs(timestamp) {
  if (!timestamp) return null;
  const ms = Date.parse(String(timestamp).replace(" ", "T"));
  return Number.isFinite(ms) ? ms : null;
}

export function findNearestPoint(points, timestampMs) {
  if (!points?.length || timestampMs == null) return null;

  let nearest = null;
  let nearestDistance = Infinity;

  for (const point of points) {
    const ms = parseTimestampMs(point.timestamp);
    if (ms == null) continue;
    const distance = Math.abs(ms - timestampMs);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = point;
    }
  }

  return nearest;
}

export function getPointTimestampMs(point) {
  return parseTimestampMs(point?.timestamp);
}

export function listScrubTimestamps(points) {
  return (points ?? [])
    .map((point) => ({
      ms: parseTimestampMs(point.timestamp),
      timestamp: point.timestamp,
    }))
    .filter((entry) => entry.ms != null)
    .sort((a, b) => a.ms - b.ms);
}

export function resolveHvacMode({ powerKw, insideTemp, targetTemp }) {
  const powerOn = (powerKw ?? 0) > 0.05;
  if (!powerOn) return "idle";
  if (insideTemp != null && targetTemp != null) {
    if (insideTemp < targetTemp - 0.3) return "heating";
    if (insideTemp > targetTemp + 0.3) return "cooling";
  }
  return "active";
}

export function airflowColor(mode) {
  if (mode === "heating") return { color: "#fb923c", emissive: "#ea580c" };
  if (mode === "cooling") return { color: "#38bdf8", emissive: "#0284c7" };
  return { color: "#94a3b8", emissive: "#64748b" };
}
