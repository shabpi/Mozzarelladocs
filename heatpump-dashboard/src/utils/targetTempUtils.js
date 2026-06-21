import { parseSpaceEventTime, parseTimestamp, resolveNowMarkerMs } from "./chartUtils";

export const MIN_STANDBY_TARGET_C = 11;
export const MAX_STANDBY_TARGET_C = 30;
export const DEFAULT_EVENT_TARGET_C = 21;

/** Future standby: 30 °C if forecast above band, 11 °C if below, else null (in sweetspot). */
export function energySavingTargetC(outsideTemp) {
  if (outsideTemp == null || Number.isNaN(Number(outsideTemp))) {
    return null;
  }
  const outside = Number(outsideTemp);
  if (outside > MAX_STANDBY_TARGET_C) {
    return MAX_STANDBY_TARGET_C;
  }
  if (outside < MIN_STANDBY_TARGET_C) {
    return MIN_STANDBY_TARGET_C;
  }
  return null;
}

export function findActiveEventAt(events, timestamp) {
  if (!timestamp || !events?.length) return null;
  const time = parseTimestamp(timestamp);
  if (Number.isNaN(time)) return null;

  return (
    events.find((event) => {
      const start = parseSpaceEventTime(event.startsAt);
      const end = parseSpaceEventTime(event.endsAt);
      return time >= start && time <= end;
    }) ?? null
  );
}

export function resolveSceneTargetTemp({
  point,
  outsideTemp,
  timestamp,
  events,
  referenceAtMs,
}) {
  const activeEvent = findActiveEventAt(events, timestamp);
  const tsMs = timestamp != null ? parseTimestamp(timestamp) : null;
  const isFuture =
    referenceAtMs != null && tsMs != null && tsMs > referenceAtMs;

  if (activeEvent?.targetTemperatureC != null) {
    return {
      targetTemp: activeEvent.targetTemperatureC,
      isStandby: false,
      activeEvent,
    };
  }

  if (activeEvent) {
    if (isFuture) {
      return {
        targetTemp: point?.targetTemp ?? DEFAULT_EVENT_TARGET_C,
        isStandby: false,
        activeEvent,
      };
    }
    if (point?.targetTemp != null && !point?.targetIsStandby) {
      return {
        targetTemp: point.targetTemp,
        isStandby: false,
        activeEvent,
      };
    }
    return {
      targetTemp: null,
      isStandby: false,
      activeEvent,
    };
  }

  if (!isFuture) {
    if (point?.targetTemp != null && !point?.targetIsStandby) {
      return {
        targetTemp: point.targetTemp,
        isStandby: false,
        activeEvent: null,
      };
    }
    return {
      targetTemp: null,
      isStandby: false,
      activeEvent: null,
    };
  }

  const outside = outsideTemp ?? point?.outsideTemp;
  const targetTemp = energySavingTargetC(outside);
  return {
    targetTemp,
    isStandby: targetTemp != null,
    activeEvent: null,
  };
}
