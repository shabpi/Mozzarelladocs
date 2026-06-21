import { buildRangeQuery } from "../api";
import { parseRangeBoundary, parseTimestamp, timeRangeToSelection } from "./chartUtils";
import { rangeQueryFromTimeseries } from "./eventDetailShared";
import { fromApiDateTime } from "./spaceEventDateUtils";

export function rangeQueryToSelection(rangeQuery) {
  if (!rangeQuery?.start || !rangeQuery?.end) {
    return {
      startDate: null,
      endDate: null,
      startTime: "00:00",
      endTime: "23:59",
    };
  }

  const parseBoundary = (value) => {
    const normalized = String(value).replace("T", " ");
    const [date, timePart = "00:00:00"] = normalized.split(" ");
    return { date, time: timePart.slice(0, 5) };
  };

  const start = parseBoundary(rangeQuery.start);
  const end = parseBoundary(rangeQuery.end);
  return {
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
  };
}

export function mergeRangeQueries(...queries) {
  let minMs = Infinity;
  let maxMs = -Infinity;

  for (const query of queries) {
    if (!query?.start || !query?.end) continue;
    minMs = Math.min(minMs, parseTimestamp(query.start));
    maxMs = Math.max(maxMs, parseTimestamp(query.end));
  }

  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) return {};

  const selection = timeRangeToSelection(minMs, maxMs);
  return buildRangeQuery(
    selection.startDate,
    selection.startTime,
    selection.endDate,
    selection.endTime,
  );
}

export function eventsToFullRangeQuery(events) {
  if (!events?.length) return {};

  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const event of events) {
    minMs = Math.min(minMs, fromApiDateTime(event.startsAt).getTime());
    maxMs = Math.max(maxMs, fromApiDateTime(event.endsAt).getTime());
  }

  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) return {};

  const selection = timeRangeToSelection(minMs, maxMs);
  return buildRangeQuery(
    selection.startDate,
    selection.startTime,
    selection.endDate,
    selection.endTime,
  );
}

/** Range from “Now” through the forecast horizon (for future standby / outside temps). */
export function buildForecastHorizonRangeQuery(referenceAt, horizonDays = 7) {
  if (!referenceAt) return {};

  const refMs = parseTimestamp(referenceAt);
  if (!Number.isFinite(refMs)) return {};

  const endMs = refMs + horizonDays * 24 * 60 * 60 * 1000;
  const selection = timeRangeToSelection(refMs, endMs);
  return buildRangeQuery(
    selection.startDate,
    selection.startTime,
    selection.endDate,
    selection.endTime,
  );
}

/** Timeline span for the CO₂ page: dataset display range + all events. */
export function buildCo2TimelineRangeQuery({
  displayRangeStart,
  displayRangeEnd,
  events = [],
}) {
  return mergeRangeQueries(
    buildRangeQuery(displayRangeStart, "00:00", displayRangeEnd, "23:59"),
    eventsToFullRangeQuery(events),
  );
}

/** Events that start after the local “now” instant (or marked future by the API). */
export function filterFutureEvents(events, nowMs = Date.now()) {
  return (events ?? []).filter((event) => {
    if (event.status === "future") return true;
    const startMs = fromApiDateTime(event.startsAt).getTime();
    return Number.isFinite(startMs) && startMs > nowMs;
  });
}

/** Timeline span for the 3D room: dashboard range + all events + forecast window. */
export function buildRoomTimelineRangeQuery({
  rangeStart,
  rangeEnd,
  events = [],
  referenceAt,
  horizonDays = 7,
}) {
  return mergeRangeQueries(
    rangeQueryFromTimeseries({ rangeStart, rangeEnd }),
    eventsToFullRangeQuery(events),
    buildForecastHorizonRangeQuery(referenceAt, horizonDays),
  );
}

/** Full data span for the dashboard on load / reset. */
export function buildInitialDashboardRangeQuery({
  displayRangeStart,
  displayRangeEnd,
  events = [],
  nowMs = Date.now(),
}) {
  if (!displayRangeStart || !displayRangeEnd) return {};

  const startMs = parseRangeBoundary(`${displayRangeStart} 00:00:00`, "start");
  if (startMs == null || Number.isNaN(startMs)) {
    return buildRangeQuery(displayRangeStart, "00:00", displayRangeEnd, "23:59");
  }

  const dataEndMs = parseRangeBoundary(`${displayRangeEnd} 23:59:59`, "end");
  const futureEvents = filterFutureEvents(events, nowMs);

  let endMs;
  if (futureEvents.length > 0) {
    endMs = nowMs;
    for (const event of futureEvents) {
      const eventEndMs = fromApiDateTime(event.endsAt).getTime();
      if (Number.isFinite(eventEndMs)) {
        endMs = Math.max(endMs, eventEndMs);
      }
    }
    if (Number.isFinite(dataEndMs)) {
      endMs = Math.max(endMs, dataEndMs);
    }
  } else {
    endMs = nowMs;
  }

  if (Number.isNaN(endMs)) {
    return buildRangeQuery(displayRangeStart, "00:00", displayRangeEnd, "23:59");
  }

  const selection = timeRangeToSelection(startMs, endMs);
  return buildRangeQuery(
    selection.startDate,
    selection.startTime,
    selection.endDate,
    selection.endTime,
  );
}
