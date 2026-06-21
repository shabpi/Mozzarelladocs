import {
  formatDateDdMmYyyy,
  formatTimeHhMm,
  fromApiDateTime,
} from "./spaceEventDateUtils";

export const BUCKET_MS = 15 * 60 * 1000;

export function spaceEventKey(event) {
  if (!event) return "";
  return event.id ?? `${event.status}-${event.startsAt}-${event.endsAt}`;
}

export function parseTimestamp(value) {
  if (value == null) return NaN;
  const normalized = String(value).includes("T")
    ? String(value)
    : String(value).replace(" ", "T");
  return new Date(normalized).getTime();
}

/** Space events use local wall-clock date/time from the dashboard (not UTC). */
export function parseSpaceEventTime(value) {
  if (value == null) return NaN;
  const text = String(value).trim().replace(/\s*UTC\b/i, "").replace("T", " ");
  return fromApiDateTime(text.slice(0, 16)).getTime();
}

/**
 * Resolve the chart "Now" marker to the same local wall-clock axis as space events.
 * Backend labels wall-clock now with a misleading " UTC" suffix.
 */
export function resolveNowMarkerMs(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;

  if (/\bUTC\b/i.test(text)) {
    const ms = parseSpaceEventTime(text);
    return Number.isNaN(ms) ? null : ms;
  }

  const ms = parseTimestamp(text);
  return Number.isNaN(ms) ? null : ms;
}

/** Single "now" axis for forecast split — matches the chart Now marker and local events. */
export function resolveForecastReferenceMs(referenceAt) {
  if (referenceAt == null) return Date.now();
  const aligned = resolveNowMarkerMs(referenceAt);
  if (aligned != null) return aligned;
  const api = parseApiTimestamp(referenceAt);
  return Number.isNaN(api) ? Date.now() : api;
}

/** Parse backend timestamps (naive UTC wall time, or explicit " UTC" suffix). */
export function parseApiTimestamp(value) {
  if (value == null) return NaN;
  const text = String(value).trim();
  if (!text) return NaN;

  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  if (/\bUTC\b/i.test(normalized)) {
    return Date.parse(normalized.replace(/\s*UTC\b/i, "Z"));
  }
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    return Date.parse(normalized);
  }
  return Date.parse(`${normalized}Z`);
}

export function parseDateOnly(isoDate) {
  const [year, month, day] = String(isoDate).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function parseRangeBoundary(value, role = "start") {
  if (!value) return null;
  const text = String(value);
  if (text.includes(" ") || text.includes("T")) {
    return parseTimestamp(text);
  }
  const date = parseDateOnly(text);
  if (role === "end") {
    date.setHours(23, 59, 59, 999);
  }
  return date.getTime();
}

export function formatLocalTimestamp(ms) {
  const date = new Date(ms);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function buildTimeDomain(rangeStart, rangeEnd) {
  if (!rangeStart || !rangeEnd) return null;

  let start = parseRangeBoundary(rangeStart, "start");
  let end = parseRangeBoundary(rangeEnd, "end");
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (start > end) [start, end] = [end, start];
  if (start === end) end += 60 * 60 * 1000;
  return [start, end];
}

export function buildDayTicks(rangeStart, rangeEnd) {
  const domain = buildTimeDomain(rangeStart, rangeEnd);
  if (!domain) return [];

  const [startMs, endMs] = domain;
  const start = new Date(startMs);
  const end = new Date(endMs);
  const ticks = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());

  while (cursor <= endDay) {
    ticks.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }

  return ticks;
}

export function buildAdaptiveDayTicks(rangeStart, rangeEnd) {
  const ticks = buildDayTicks(rangeStart, rangeEnd);
  if (ticks.length <= 18) return ticks;

  const step = Math.ceil(ticks.length / 14);
  return ticks.filter((_, index) => index % step === 0 || index === ticks.length - 1);
}

export function buildChartTimeline(rawPoints, rangeStart, rangeEnd) {
  const domain = buildTimeDomain(rangeStart, rangeEnd);
  const points = (rawPoints ?? [])
    .map((point) => ({
      ...point,
      time: point.time ?? parseTimestamp(point.timestamp),
    }))
    .filter((point) => !Number.isNaN(point.time));

  if (!domain) {
    return points.sort((a, b) => a.time - b.time);
  }

  const [startTime, endTime] = domain;
  const byTime = new Map(points.map((point) => [point.time, point]));
  const timelineTimes = new Set([startTime, endTime]);

  buildDayTicks(rangeStart, rangeEnd).forEach((tick) => timelineTimes.add(tick));
  points.forEach((point) => timelineTimes.add(point.time));

  return Array.from(timelineTimes)
    .sort((a, b) => a - b)
    .map((time) => {
      const existing = byTime.get(time);
      if (existing) return existing;
      return {
        time,
        timestamp: formatLocalTimestamp(time),
        insideTemp: null,
        outsideTemp: null,
        returnTemp: null,
        targetTemp: null,
        domainAnchor: true,
      };
    });
}

/** @deprecated use buildChartTimeline */
export function withDomainAnchors(points, rangeStart, rangeEnd) {
  return buildChartTimeline(points, rangeStart, rangeEnd);
}

export function isTimeInGap(timeMs, gaps) {
  if (timeMs == null || Number.isNaN(timeMs) || !gaps?.length) return false;

  for (const gap of gaps) {
    const gapStart = parseTimestamp(gap.start);
    const gapEnd = parseTimestamp(gap.end);
    if (Number.isNaN(gapStart) || Number.isNaN(gapEnd)) continue;
    if (timeMs >= gapStart && timeMs <= gapEnd) return true;
  }

  return false;
}

export function clipGapsToDomain(gaps, rangeStart, rangeEnd) {
  const domain = buildTimeDomain(rangeStart, rangeEnd);
  if (!domain || !gaps?.length) return [];

  const [domainStart, domainEnd] = domain;
  return gaps
    .map((gap) => {
      const gapStart = parseTimestamp(gap.start);
      const gapEnd = parseTimestamp(gap.end);
      const start = Math.max(gapStart, domainStart);
      const end = Math.min(gapEnd, domainEnd);
      if (start >= end) return null;
      return { start, end, key: gap.start };
    })
    .filter(Boolean);
}

export function hasTemperatureSeriesData(points) {
  return (points ?? []).some(
    (point) =>
      !point.domainAnchor &&
      (point.insideTemp != null || point.outsideTemp != null),
  );
}

export function hasCo2SeriesData(points) {
  return (points ?? []).some(
    (point) => !point.domainAnchor && point.co2Ppm != null,
  );
}

export function getChartMargins({ denseAxis, rightAxisCount = 0, operationModeLane = false }) {
  const operationModePadding = operationModeLane ? 22 : 0;
  return {
    top: 6,
    right: rightAxisCount > 0 ? 6 + rightAxisCount * 28 : 6,
    bottom: (denseAxis ? 36 : 6) + operationModePadding,
    left: 2,
  };
}

export const axisTickStyle = { fontSize: 11, fill: "#cacaca" };

/** 0 °C → green, 2.5 °C → yellow, 5 °C+ → red */
export function deltaToColor(delta, alpha = 0.62) {
  const magnitude = Math.min(Math.abs(delta), 5);
  const hue = 120 - (magnitude / 5) * 120;
  return `hsla(${hue}, 78%, 46%, ${alpha})`;
}

export const COMFORT_TARGET_COLOR = "hsla(120, 78%, 46%, 0.62)";

export function formatAxisTick(time) {
  const date = new Date(time);
  return formatDateDdMmYyyy(date);
}

export function formatTooltipTime(time) {
  const date = new Date(time);
  return `${formatDateDdMmYyyy(date)} ${formatTimeHhMm(date)}`;
}

export function findNearestDataPoint(points, hoverTime, maxDistanceMs = 30 * 60 * 1000) {
  if (hoverTime == null || Number.isNaN(hoverTime) || !points?.length) {
    return null;
  }

  let nearest = null;
  let nearestDistance = Infinity;

  for (const point of points) {
    if (point.domainAnchor) continue;
    if (
      point.insideTemp == null &&
      point.co2Ppm == null &&
      point.outsideTemp == null &&
      point.targetTemp == null
    ) {
      continue;
    }
    const distance = Math.abs(point.time - hoverTime);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = point;
    }
  }

  if (nearest && nearestDistance > maxDistanceMs) {
    return null;
  }

  return nearest;
}

export function isEventActiveAt(events, timestamp) {
  if (!timestamp || !events?.length) return false;
  const time =
    typeof timestamp === "number"
      ? timestamp
      : resolveNowMarkerMs(timestamp) ?? parseTimestamp(timestamp);
  if (time == null || Number.isNaN(time)) return false;

  return events.some((event) => {
    const start = parseSpaceEventTime(event.startsAt);
    const end = parseSpaceEventTime(event.endsAt);
    return time >= start && time <= end;
  });
}

export const COMFORT_TOLERANCE_C = 2;

export const MIN_ZOOM_SPAN_MS = 15 * 60 * 1000;

export function timeRangeToSelection(startMs, endMs) {
  let start = Math.min(startMs, endMs);
  let end = Math.max(startMs, endMs);
  if (end - start < MIN_ZOOM_SPAN_MS) {
    end = start + MIN_ZOOM_SPAN_MS;
  }

  const startDate = new Date(start);
  const endDate = new Date(end);
  const pad = (part) => String(part).padStart(2, "0");

  return {
    startDate: `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}`,
    endDate: `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}`,
    startTime: `${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`,
    endTime: `${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`,
  };
}

export function cloneSelection(selection) {
  if (!selection) return null;
  return {
    startDate: selection.startDate,
    endDate: selection.endDate,
    startTime: selection.startTime ?? "00:00",
    endTime: selection.endTime ?? "23:59",
  };
}
