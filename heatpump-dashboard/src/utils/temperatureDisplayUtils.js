import {
  findNearestDataPoint,
  isTimeInGap,
  parseSpaceEventTime,
  parseTimestamp,
  resolveNowMarkerMs,
} from "./chartUtils";
import {
  DEFAULT_EVENT_TARGET_C,
  energySavingTargetC,
  MIN_STANDBY_TARGET_C,
} from "./targetTempUtils";

export { MIN_STANDBY_TARGET_C, DEFAULT_EVENT_TARGET_C };

export function resolveOutsideTempForPoint(point, currentTimeX, useForecastSplit = true) {
  if (!point) return null;
  if (!useForecastSplit) return point.outsideTemp ?? null;

  const isAfterNow =
    currentTimeX != null && point.time != null && point.time > currentTimeX;

  if (!isAfterNow && !point.forecast) {
    return point.outsideTemp ?? null;
  }

  if (point.outsideTemp != null) {
    return point.outsideTemp;
  }

  return null;
}

export function resolveTargetTempForPoint(
  point,
  events,
  currentTimeX,
  { eventsOnlyTarget = false } = {},
) {
  const isFuture =
    currentTimeX != null && point?.time != null && point.time > currentTimeX;
  const isHistorical =
    currentTimeX != null && point?.time != null && point.time <= currentTimeX;

  const overlapping =
    point?.time == null
      ? []
      : events.filter((event) => {
          const start = parseSpaceEventTime(event.startsAt);
          const end = parseSpaceEventTime(event.endsAt);
          if (Number.isNaN(start) || Number.isNaN(end)) return false;
          return point.time >= start && point.time <= end;
        });

  if (overlapping.length > 0) {
    const customWithTarget = overlapping.find(
      (event) => event.custom && event.targetTemperatureC != null,
    );
    if (customWithTarget) {
      return {
        targetTemp: customWithTarget.targetTemperatureC,
        fromSavedEvent: true,
        isStandby: false,
      };
    }

    const withTarget = overlapping.find((event) => event.targetTemperatureC != null);
    if (withTarget) {
      return {
        targetTemp: withTarget.targetTemperatureC,
        fromSavedEvent: true,
        isStandby: false,
      };
    }

    if (isFuture && !eventsOnlyTarget) {
      return {
        targetTemp: DEFAULT_EVENT_TARGET_C,
        fromSavedEvent: false,
        isStandby: false,
      };
    }

    if (point?.targetTemp != null && !point?.targetIsStandby) {
      return {
        targetTemp: point.targetTemp,
        fromSavedEvent: false,
        isStandby: false,
      };
    }

    return { targetTemp: null, fromSavedEvent: false, isStandby: false };
  }

  if (isHistorical) {
    if (point?.targetTemp != null && !point?.targetIsStandby) {
      return {
        targetTemp: point.targetTemp,
        fromSavedEvent: false,
        isStandby: false,
      };
    }
    return { targetTemp: null, fromSavedEvent: false, isStandby: false };
  }

  if (eventsOnlyTarget) {
    return { targetTemp: null, fromSavedEvent: false, isStandby: false };
  }

  if (isFuture || point?.forecast) {
    const targetTemp = energySavingTargetC(point?.outsideTemp);
    return {
      targetTemp,
      fromSavedEvent: false,
      isStandby: targetTemp != null,
    };
  }

  if (point?.targetTemp != null && !point?.targetIsStandby) {
    return {
      targetTemp: point.targetTemp,
      fromSavedEvent: false,
      isStandby: false,
    };
  }

  return { targetTemp: null, fromSavedEvent: false, isStandby: false };
}

function normalizePoints(rawPoints) {
  return (rawPoints ?? [])
    .map((point) => ({
      ...point,
      time: point.time ?? parseTimestamp(point.timestamp),
    }))
    .filter((point) => !Number.isNaN(point.time));
}

function findNearestOutsideDonor(points, hoverTime) {
  if (hoverTime == null || Number.isNaN(hoverTime)) return null;

  let nearest = null;
  let nearestDistance = Infinity;

  for (const point of points) {
    if (point.domainAnchor || point.outsideTemp == null) continue;
    const distance = Math.abs(point.time - hoverTime);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = point;
    }
  }

  return nearest;
}

export function enrichPointForDisplay(
  point,
  allPoints,
  events,
  currentTimeMarker,
  hoverTime = null,
  { eventsOnlyTarget = false } = {},
) {
  const currentTimeX = resolveNowMarkerMs(currentTimeMarker);
  const normalized = normalizePoints(allPoints);
  const time =
    hoverTime ??
    point?.time ??
    (point?.timestamp ? parseTimestamp(point.timestamp) : null);

  let base =
    point && !point.domainAnchor
      ? { ...point, time: point.time ?? parseTimestamp(point.timestamp) }
      : null;

  if (!base || base.domainAnchor) {
    base = findNearestDataPoint(normalized, time, 6 * 60 * 60 * 1000) ?? {
      time,
      timestamp: point?.timestamp,
      domainAnchor: true,
    };
  }

  let outsideTemp = resolveOutsideTempForPoint(base, currentTimeX, true);
  if (outsideTemp == null) {
    const donor = findNearestOutsideDonor(normalized, time);
    outsideTemp = donor
      ? resolveOutsideTempForPoint(donor, currentTimeX, true) ?? donor.outsideTemp
      : null;
  }

  const merged = { ...base, time: time ?? base.time, outsideTemp };
  const { targetTemp, fromSavedEvent, isStandby } = resolveTargetTempForPoint(
    merged,
    events,
    currentTimeX,
    { eventsOnlyTarget },
  );

  return {
    ...merged,
    outsideTemp,
    targetTemp,
    targetIsStandby: isStandby,
    targetIsSavedFuture:
      currentTimeX != null &&
      merged.time != null &&
      merged.time > currentTimeX &&
      fromSavedEvent &&
      targetTemp != null,
    outsideIsForecast:
      currentTimeX != null &&
      merged.time != null &&
      merged.time > currentTimeX &&
      outsideTemp != null,
  };
}

export function buildTemperatureBarValues({
  point,
  allPoints,
  events,
  currentTimeMarker,
  eventsOnlyTarget = false,
}) {
  if (!point && !allPoints?.length) return null;

  const enriched = enrichPointForDisplay(
    point,
    allPoints,
    events,
    currentTimeMarker,
    null,
    { eventsOnlyTarget },
  );

  const hasAny =
    enriched.insideTemp != null ||
    enriched.targetTemp != null ||
    enriched.outsideTemp != null ||
    enriched.returnTemp != null;

  if (!hasAny) return null;

  return {
    insideC: enriched.insideTemp ?? null,
    outsideC: enriched.outsideTemp ?? null,
    returnC: enriched.returnTemp ?? null,
    targetC: enriched.targetTemp ?? null,
    timestamp: enriched.timestamp ?? point?.timestamp ?? null,
    outsideIsForecast: enriched.outsideIsForecast,
    targetIsStandby: enriched.targetIsStandby,
  };
}

function enrichSparseTimelinePoint(
  point,
  time,
  events,
  currentTimeMarker,
  { eventsOnlyTarget = false } = {},
) {
  const currentTimeX = resolveNowMarkerMs(currentTimeMarker);
  const sparse = {
    ...point,
    time,
    insideTemp: null,
    returnTemp: null,
    outsideTemp: null,
    targetTemp: null,
    co2Ppm: point.co2Ppm ?? null,
  };
  const { targetTemp, fromSavedEvent, isStandby } = resolveTargetTempForPoint(
    sparse,
    events,
    currentTimeX,
    { eventsOnlyTarget },
  );

  return {
    ...sparse,
    targetTemp,
    targetIsStandby: isStandby,
    targetIsSavedFuture:
      currentTimeX != null &&
      time != null &&
      time > currentTimeX &&
      fromSavedEvent &&
      targetTemp != null,
    outsideIsForecast:
      currentTimeX != null &&
      time != null &&
      time > currentTimeX &&
      sparse.outsideTemp != null,
  };
}

export function enrichChartSeries(
  timelinePoints,
  rawPoints,
  events,
  currentTimeMarker,
  gaps = [],
  { eventsOnlyTarget = false } = {},
) {
  const normalizedRaw = normalizePoints(rawPoints?.length ? rawPoints : timelinePoints);
  const currentTimeX = resolveNowMarkerMs(currentTimeMarker);

  return (timelinePoints ?? []).map((point) => {
    const time = point.time ?? parseTimestamp(point.timestamp);
    const inGap = isTimeInGap(time, gaps);

    if (point.domainAnchor || inGap) {
      return enrichSparseTimelinePoint(point, time, events, currentTimeMarker, {
        eventsOnlyTarget,
      });
    }

    const enriched = enrichPointForDisplay(
      point,
      normalizedRaw,
      events,
      currentTimeMarker,
      time,
      { eventsOnlyTarget },
    );

    if (currentTimeX != null && time != null && time <= currentTimeX) {
      const measuredTarget =
        point.targetTemp != null && !point.targetIsStandby ? point.targetTemp : null;
      enriched.targetTemp = measuredTarget;
      enriched.targetIsStandby = false;
      enriched.targetIsSavedFuture = false;
    }

    return enriched;
  });
}
