import { buildRangeQuery } from "../api";
import {
  BUCKET_MS,
  formatLocalTimestamp,
  parseTimestamp,
  resolveForecastReferenceMs,
  timeRangeToSelection,
} from "./chartUtils";
import { resolveShortTermOperationMode } from "./operationModeUtils";

export const DASHBOARD_FORECAST_HOUR_OPTIONS = [3, 4, 5, 6];
export const DEFAULT_DASHBOARD_FORECAST_HOURS = 6;
export const FORECAST_PREDICTION_MIN_HOURS = 3;
export const FORECAST_PREDICTION_MAX_HOURS = 6;
export const FORECAST_PREDICTION_MODELS = [
  { id: "simple", label: "Simple" },
  { id: "thermal", label: "Thermal" },
  { id: "simulator", label: "Simulator" },
];
export const FORECAST_LOOKBACK_MIN_HOURS = 0;
/** Chart view can extend without cap; knob visuals compress beyond this. */
export const FORECAST_CHART_VISUAL_CAP_HOURS = 12;
/** Minimum 15-min buckets with measured inside temps to skip auto dummy history (1 h). */
export const FORECAST_MIN_HISTORIC_BUCKETS = 4;

/** Dummy history before "now" in forecast view: off → base → cooling → heating → off. */
export const FORECAST_DUMMY_MODES = {
  off: "off",
  base: "base",
  cooling: "cooling",
  heating: "heating",
};

export function cycleForecastDummyMode(mode) {
  if (mode === FORECAST_DUMMY_MODES.off) return FORECAST_DUMMY_MODES.base;
  if (mode === FORECAST_DUMMY_MODES.base) return FORECAST_DUMMY_MODES.cooling;
  if (mode === FORECAST_DUMMY_MODES.cooling) return FORECAST_DUMMY_MODES.heating;
  return FORECAST_DUMMY_MODES.off;
}

export function isForecastDummyActive(mode) {
  return (
    mode === FORECAST_DUMMY_MODES.base ||
    mode === FORECAST_DUMMY_MODES.cooling ||
    mode === FORECAST_DUMMY_MODES.heating
  );
}

export function forecastDummyModeLabel(mode) {
  if (mode === FORECAST_DUMMY_MODES.base) return "base";
  if (mode === FORECAST_DUMMY_MODES.cooling) return "cooling";
  if (mode === FORECAST_DUMMY_MODES.heating) return "heating";
  return "off";
}

/** Chart range from optional lookback through the visible forward window (may exceed prediction). */
export function buildShortTermForecastRangeQuery(
  chartForwardHours,
  nowMs = Date.now(),
  { lookbackHours = 0, includeLookback } = {},
) {
  const effectiveLookback =
    lookbackHours > 0
      ? lookbackHours
      : includeLookback
        ? chartForwardHours
        : 0;
  const startMs =
    effectiveLookback > 0 ? nowMs - effectiveLookback * 60 * 60 * 1000 : nowMs;
  const endMs = nowMs + Math.max(0, chartForwardHours) * 60 * 60 * 1000;
  const selection = timeRangeToSelection(startMs, endMs);
  return buildRangeQuery(
    selection.startDate,
    selection.startTime,
    selection.endDate,
    selection.endTime,
  );
}

/** Count distinct 15-min buckets with measured inside/return temps before reference. */
export function countHistoricMeasuredBuckets(points, referenceMs, lookbackMs) {
  const rangeStartMs = referenceMs - lookbackMs;
  const buckets = new Set();

  for (const point of points ?? []) {
    if (point?.isDummy) continue;
    const time = point.time ?? parseTimestamp(point.timestamp);
    if (Number.isNaN(time) || time < rangeStartMs || time > referenceMs) continue;
    if (point.insideTemp == null && point.returnTemp == null) continue;
    buckets.add(Math.floor(time / BUCKET_MS) * BUCKET_MS);
  }

  return buckets.size;
}

/** True when lookback has too little measured history to show a useful forecast context. */
export function shouldAutoEnableForecastDummyHistory(
  points,
  hours,
  referenceMs = Date.now(),
) {
  const lookbackMs = hours * 60 * 60 * 1000;
  const measuredBuckets = countHistoricMeasuredBuckets(points, referenceMs, lookbackMs);
  const expectedBuckets = hours * 4;
  const minimumRequired = Math.max(
    FORECAST_MIN_HISTORIC_BUCKETS,
    Math.ceil(expectedBuckets * 0.25),
  );
  return measuredBuckets < minimumRequired;
}

export function findShortTermForecastSlot(slots, timeMs) {
  if (timeMs == null || Number.isNaN(timeMs) || !slots?.length) return null;

  let nearest = null;
  let nearestDistance = Infinity;

  for (const slot of slots) {
    const slotMs = parseTimestamp(slot.timestamp);
    if (Number.isNaN(slotMs)) continue;
    const distance = Math.abs(slotMs - timeMs);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = slot;
    }
  }

  const halfBucket = 7.5 * 60 * 1000;
  return nearestDistance <= halfBucket ? nearest : null;
}

function findNearestMeasuredPoint(points, bucketTime, maxDistance = BUCKET_MS / 2) {
  let nearest = null;
  let nearestDistance = Infinity;

  for (const point of points) {
    const time = point.time ?? parseTimestamp(point.timestamp);
    if (Number.isNaN(time)) continue;
    if (point.insideTemp == null && point.returnTemp == null) continue;

    const distance = Math.abs(time - bucketTime);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = { ...point, time };
    }
  }

  return nearestDistance <= maxDistance ? nearest : null;
}

/**
 * Classify heat pump mode (heat / cool / idle) for each 15-min bucket up to "now".
 * Used on the forecast dashboard for measured or dummy history.
 */
export function annotateHistoricOperationModes(points, referenceAt, rangeStartMs) {
  if (!points?.length || !referenceAt) return points ?? [];

  const referenceMs = resolveForecastReferenceMs(referenceAt);
  if (Number.isNaN(referenceMs)) return points ?? [];

  const normalized = (points ?? []).map((point) => ({
    ...point,
    time: point.time ?? parseTimestamp(point.timestamp),
  }));

  const times = normalized.map((point) => point.time).filter((time) => !Number.isNaN(time));
  const effectiveRangeStart =
    rangeStartMs ?? (times.length ? Math.min(...times) : null);

  if (
    effectiveRangeStart == null ||
    Number.isNaN(effectiveRangeStart) ||
    effectiveRangeStart >= referenceMs
  ) {
    return points;
  }

  const firstBucket = Math.ceil(effectiveRangeStart / BUCKET_MS) * BUCKET_MS;
  const byTime = new Map(normalized.map((point) => [point.time, point]));

  for (let bucketTime = firstBucket; bucketTime <= referenceMs; bucketTime += BUCKET_MS) {
    const exact = byTime.get(bucketTime);
    const source = exact ?? findNearestMeasuredPoint(normalized, bucketTime);
    if (!source) continue;

    const insideC = source.insideTemp ?? source.returnTemp;
    if (insideC == null) continue;

    const operationMode = resolveShortTermOperationMode(
      insideC,
      source.targetTemp,
      source.outsideTemp,
    );

    if (exact) {
      exact.operationMode = operationMode;
      continue;
    }

    byTime.set(bucketTime, {
      time: bucketTime,
      timestamp: formatLocalTimestamp(bucketTime),
      operationMode,
      operationModeHistoric: true,
    });
  }

  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

export function isAfterForecastReference(timeMs, referenceAt) {
  const referenceMs = resolveForecastReferenceMs(referenceAt);
  if (Number.isNaN(referenceMs) || timeMs == null) return false;
  return timeMs > referenceMs;
}

/** Attach predicted inside temps and operation modes to chart points. */
export function mergeShortTermForecastIntoPoints(points, slots, referenceAt) {
  if (!slots?.length) return points ?? [];

  const referenceMs = referenceAt ? resolveForecastReferenceMs(referenceAt) : Date.now();
  const byTime = new Map(
    (points ?? []).map((point) => {
      const time = point.time ?? parseTimestamp(point.timestamp);
      return [time, { ...point, time }];
    }),
  );

  for (const slot of slots) {
    const time = parseTimestamp(slot.timestamp);
    if (Number.isNaN(time)) continue;

    const existing = byTime.get(time) ?? {
      time,
      timestamp: slot.timestamp,
      insideTemp: null,
      outsideTemp: slot.outsideTempC ?? null,
      returnTemp: null,
      targetTemp: slot.targetTempC ?? null,
    };

    if (time > referenceMs) {
      existing.insideTempPredicted = slot.insideTempC;
      existing.operationMode = slot.operationMode;
      if (slot.outsideTempC != null) existing.outsideTemp = slot.outsideTempC;
      if (slot.targetTempC != null) existing.targetTemp = slot.targetTempC;
      existing.insideTempForecast = true;
    }

    byTime.set(time, existing);
  }

  const futureSlots = slots
    .map((slot) => ({
      slot,
      time: parseTimestamp(slot.timestamp),
    }))
    .filter(({ time }) => !Number.isNaN(time) && time > referenceMs)
    .sort((a, b) => a.time - b.time);

  if (futureSlots.length > 0) {
    const { slot: firstSlot } = futureSlots[0];
    const bridge =
      byTime.get(referenceMs) ?? {
        time: referenceMs,
        timestamp: formatLocalTimestamp(referenceMs),
        insideTemp: null,
        outsideTemp: firstSlot.outsideTempC ?? null,
        returnTemp: null,
        targetTemp: firstSlot.targetTempC ?? null,
      };
    bridge.insideTempPredicted = firstSlot.insideTempC;
    bridge.operationMode = firstSlot.operationMode;
    bridge.insideTempForecast = true;
    if (firstSlot.outsideTempC != null) bridge.outsideTemp = firstSlot.outsideTempC;
    if (firstSlot.targetTempC != null) bridge.targetTemp = firstSlot.targetTempC;
    byTime.set(referenceMs, bridge);
  }

  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

/** Synthetic measured points every 15 min from range start up to (and including) now. */
export function buildDummyHistoryUntilNow({
  rangeStartMs,
  referenceMs,
  startingInsideTempC = 20,
  startingOutsideTempC = 14,
  targetTempC = 21,
  preset = FORECAST_DUMMY_MODES.base,
}) {
  if (preset === FORECAST_DUMMY_MODES.cooling) {
    return buildCoolingDummyHistoryUntilNow({
      rangeStartMs,
      referenceMs,
      startingInsideTempC,
      startingOutsideTempC,
      targetTempC,
    });
  }

  if (preset === FORECAST_DUMMY_MODES.heating) {
    return buildHeatingDummyHistoryUntilNow({
      rangeStartMs,
      referenceMs,
      startingOutsideTempC,
      targetTempC,
    });
  }

  return buildBaseDummyHistoryUntilNow({
    rangeStartMs,
    referenceMs,
    startingInsideTempC,
    startingOutsideTempC,
    targetTempC,
  });
}

function buildBaseDummyHistoryUntilNow({
  rangeStartMs,
  referenceMs,
  startingInsideTempC = 20,
  startingOutsideTempC = 14,
  targetTempC = 21,
}) {
  if (
    rangeStartMs == null ||
    referenceMs == null ||
    Number.isNaN(rangeStartMs) ||
    Number.isNaN(referenceMs) ||
    rangeStartMs >= referenceMs
  ) {
    return [];
  }

  const firstBucket = Math.ceil(rangeStartMs / BUCKET_MS) * BUCKET_MS;
  const points = [];
  let index = 0;

  for (let time = firstBucket; time <= referenceMs; time += BUCKET_MS) {
    const progress =
      referenceMs > rangeStartMs ? (time - rangeStartMs) / (referenceMs - rangeStartMs) : 1;
    const wobble = Math.sin(index * 0.7) * 0.4 + Math.cos(index * 0.45) * 0.25;
    const baseInside = startingInsideTempC - 0.8 + progress * 0.8 + wobble;
    const insideTemp =
      time >= referenceMs - BUCKET_MS / 2
        ? startingInsideTempC
        : Math.round(baseInside * 10) / 10;

    points.push({
      time,
      timestamp: formatLocalTimestamp(time),
      insideTemp,
      outsideTemp: startingOutsideTempC,
      targetTemp: targetTempC,
      returnTemp: Math.round((insideTemp - 1.2) * 10) / 10,
      isDummy: true,
    });
    index += 1;
  }

  if (points.length) {
    points[points.length - 1].insideTemp = startingInsideTempC;
  }

  return points;
}

/** Cold-room heating scenario: inside rises to target exactly at "now". */
function buildHeatingDummyHistoryUntilNow({
  rangeStartMs,
  referenceMs,
  startingOutsideTempC = 14,
  targetTempC = 21,
}) {
  if (
    rangeStartMs == null ||
    referenceMs == null ||
    Number.isNaN(rangeStartMs) ||
    Number.isNaN(referenceMs) ||
    rangeStartMs >= referenceMs
  ) {
    return [];
  }

  const firstBucket = Math.ceil(rangeStartMs / BUCKET_MS) * BUCKET_MS;
  const coldStartInside = targetTempC - 4;
  const coolOutside = Math.min(startingOutsideTempC, targetTempC - 2);
  const points = [];
  let index = 0;

  for (let time = firstBucket; time <= referenceMs; time += BUCKET_MS) {
    const progress =
      referenceMs > rangeStartMs ? (time - rangeStartMs) / (referenceMs - rangeStartMs) : 1;
    const wobble = Math.sin(index * 0.65) * 0.2 + Math.cos(index * 0.4) * 0.12;
    const heatedInside =
      coldStartInside + progress * (targetTempC - coldStartInside) + wobble;
    const insideTemp =
      time >= referenceMs - BUCKET_MS / 2
        ? targetTempC
        : Math.round(Math.min(heatedInside, targetTempC - 0.3) * 10) / 10;
    const outsideTemp =
      Math.round((coolOutside + Math.sin(index * 0.2) * 0.4) * 10) / 10;

    points.push({
      time,
      timestamp: formatLocalTimestamp(time),
      insideTemp,
      outsideTemp,
      targetTemp: targetTempC,
      returnTemp: Math.round((insideTemp - 1.0) * 10) / 10,
      isDummy: true,
      dummyPreset: FORECAST_DUMMY_MODES.heating,
    });
    index += 1;
  }

  if (points.length) {
    points[points.length - 1].insideTemp = targetTempC;
  }

  return points;
}

/** Hot-room cooling scenario: inside drifts down toward now while outside stays warm. */
function buildCoolingDummyHistoryUntilNow({
  rangeStartMs,
  referenceMs,
  startingInsideTempC = 24,
  startingOutsideTempC = 28,
  targetTempC = 21,
}) {
  if (
    rangeStartMs == null ||
    referenceMs == null ||
    Number.isNaN(rangeStartMs) ||
    Number.isNaN(referenceMs) ||
    rangeStartMs >= referenceMs
  ) {
    return [];
  }

  const firstBucket = Math.ceil(rangeStartMs / BUCKET_MS) * BUCKET_MS;
  const hotStartInside = Math.max(startingInsideTempC + 5, 27);
  const warmOutside = Math.max(startingOutsideTempC, 26);
  const points = [];
  let index = 0;

  for (let time = firstBucket; time <= referenceMs; time += BUCKET_MS) {
    const progress =
      referenceMs > rangeStartMs ? (time - rangeStartMs) / (referenceMs - rangeStartMs) : 1;
    const wobble = Math.sin(index * 0.55) * 0.25 + Math.cos(index * 0.35) * 0.15;
    const cooledInside =
      hotStartInside - progress * (hotStartInside - startingInsideTempC) + wobble;
    const insideTemp =
      time >= referenceMs - BUCKET_MS / 2
        ? startingInsideTempC
        : Math.round(cooledInside * 10) / 10;
    const outsideTemp =
      Math.round((warmOutside + Math.sin(index * 0.25) * 0.6) * 10) / 10;

    points.push({
      time,
      timestamp: formatLocalTimestamp(time),
      insideTemp,
      outsideTemp,
      targetTemp: targetTempC,
      returnTemp: Math.round((insideTemp - 1.4) * 10) / 10,
      isDummy: true,
      dummyPreset: FORECAST_DUMMY_MODES.cooling,
    });
    index += 1;
  }

  if (points.length) {
    points[points.length - 1].insideTemp = startingInsideTempC;
  }

  return points;
}

/** Fill missing measured inside temps before now with dummy history (never overrides real data). */
export function mergeDummyHistoryIntoPoints(points, dummyPoints, referenceMs) {
  if (!dummyPoints?.length) return points ?? [];

  const byTime = new Map(
    (points ?? []).map((point) => {
      const time = point.time ?? parseTimestamp(point.timestamp);
      return [time, { ...point, time }];
    }),
  );

  for (const dummy of dummyPoints) {
    if (dummy.time > referenceMs) continue;
    const existing = byTime.get(dummy.time);
    if (existing?.insideTemp != null && !existing.isDummy) continue;
    byTime.set(dummy.time, {
      ...(existing ?? {}),
      ...dummy,
      insideTemp: dummy.insideTemp,
      isDummy: true,
    });
  }

  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

/** Remove measured inside/return temps after "now" so forecast lines start at the Now marker. */
export function clipMeasuredTempsAfterReference(points, referenceAt) {
  const referenceMs = resolveForecastReferenceMs(referenceAt);
  if (Number.isNaN(referenceMs)) return points ?? [];

  return (points ?? []).map((point) => {
    const time = point.time ?? parseTimestamp(point.timestamp);
    if (Number.isNaN(time) || time <= referenceMs) return point;
    if (point.insideTemp == null && point.returnTemp == null) return point;
    return {
      ...point,
      time,
      insideTemp: null,
      returnTemp: null,
      isDummy: false,
    };
  });
}
