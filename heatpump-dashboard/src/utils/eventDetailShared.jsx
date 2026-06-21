import { buildRangeQuery } from "../api";
import { parseRangeBoundary } from "./chartUtils";
import {
  formatDateDdMmYyyy,
  formatTimeHhMm,
  fromApiDateTime,
} from "./spaceEventDateUtils";

const statusStyles = {
  historic: {
    row: "border-l-4 border-gray-500 bg-gray-600/20",
    badge: "bg-gray-500/30 text-gray-300",
    label: "Historic",
  },
  current: {
    row: "border-l-4 border-emerald-500 bg-emerald-500/15",
    badge: "bg-emerald-500/25 text-emerald-200",
    label: "Current",
  },
  future: {
    row: "border-l-4 border-gray-400 border-dashed bg-gray-400/10",
    badge: "bg-gray-400/20 text-gray-200",
    label: "Future",
  },
};

const seasonBadgeStyles = {
  Heating: "bg-lb-accent/25 text-lb-accent",
  Cooling: "bg-lb-accent-blue/25 text-sky-200",
};

function getFutureEventStyle(event) {
  if (!event.weatherPrognosisAvailable) {
    return {
      row: "border-l-4 border-slate-400 border-dashed bg-slate-400/20",
      badge: "bg-slate-400/35 text-slate-100",
      label: "Planned (no forecast)",
    };
  }

  if (event.forecastSeason === "Cooling") {
    return {
      row: "border-l-4 border-teal-500/70 border-dashed bg-teal-500/15",
      badge: "bg-teal-500/25 text-teal-200",
      label: "Planned (forecast cooling)",
    };
  }

  if (event.forecastSeason === "Heating") {
    return {
      row: "border-l-4 border-violet-500/70 border-dashed bg-violet-500/15",
      badge: "bg-violet-500/25 text-violet-200",
      label: "Planned (forecast heating)",
    };
  }

  if (event.season === "Cooling") {
    return {
      row: "border-l-4 border-teal-500/70 border-dashed bg-teal-500/15",
      badge: "bg-teal-500/25 text-teal-200",
      label: "Planned (forecast)",
    };
  }

  return {
    row: "border-l-4 border-violet-500/70 border-dashed bg-violet-500/15",
    badge: "bg-violet-500/25 text-violet-200",
    label: "Planned (forecast)",
  };
}

function formatEventRange(startsAt, endsAt) {
  const start = fromApiDateTime(startsAt);
  const end = fromApiDateTime(endsAt);
  return `${formatDateDdMmYyyy(start)} ${formatTimeHhMm(start)} – ${formatDateDdMmYyyy(end)} ${formatTimeHhMm(end)}`;
}

export function eventOverlapsTimeline(event, rangeStart, rangeEnd) {
  if (!rangeStart || !rangeEnd) return true;
  const timelineStart = parseRangeBoundary(rangeStart, "start");
  const timelineEnd = parseRangeBoundary(rangeEnd, "end");
  if (timelineStart == null || timelineEnd == null) return true;

  const eventStart = fromApiDateTime(event.startsAt).getTime();
  const eventEnd = fromApiDateTime(event.endsAt).getTime();
  return eventStart < timelineEnd && eventEnd > timelineStart;
}

export function eventToRangeQuery(event) {
  return buildRangeQuery(
    event.startsAt.slice(0, 10),
    event.startsAt.slice(11, 16),
    event.endsAt.slice(0, 10),
    event.endsAt.slice(11, 16),
  );
}

export function rangeQueryFromTimeseries(timeseries) {
  if (!timeseries.rangeStart || !timeseries.rangeEnd) return {};
  return { start: timeseries.rangeStart, end: timeseries.rangeEnd };
}

export function getEventStyle(event, status) {
  const resolved = status ?? event?.status ?? "historic";
  if (resolved === "future") return getFutureEventStyle(event);
  return statusStyles[resolved] ?? statusStyles.historic;
}

export function EventRowContent({
  event,
  style,
  isFocused,
  showClickHint = false,
  onEditEvent,
  onDelete,
  canModify,
}) {
  const safeStyle = style ?? statusStyles.historic;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${safeStyle.badge}`}>
          {safeStyle.label}
        </span>
        {event.custom && (
          <span className="rounded bg-white/10 px-2 py-0.5 text-xs font-medium text-lb-text-muted">
            Custom
          </span>
        )}
        {event.custom && (
          <span className="rounded bg-lb-accent-blue/20 px-2 py-0.5 text-xs font-medium text-sky-200">
            Target {event.targetTemperatureC ?? "—"} °C
          </span>
        )}
        {event.weatherPrognosisAvailable && event.forecastOutsideTempC != null && (
          <span className="rounded bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-200">
            Forecast outside {event.forecastOutsideTempC} °C
          </span>
        )}
        {event.forecastSeason && (event.status === "future" || event.weatherPrognosisAvailable) && (
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              event.forecastSeason === "Cooling"
                ? "bg-teal-500/25 text-teal-200"
                : "bg-violet-500/25 text-violet-200"
            }`}
          >
            Forecast {event.forecastSeason.toLowerCase()}
          </span>
        )}
        {event.forecastTempDeltaC != null && event.weatherPrognosisAvailable && (
          <span className="rounded bg-white/10 px-2 py-0.5 text-xs font-medium text-lb-text-muted">
            Δ outside−target {event.forecastTempDeltaC > 0 ? "+" : ""}
            {event.forecastTempDeltaC} °C
          </span>
        )}
        {event.season && event.targetTemperatureC == null && !event.forecastSeason && (
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              event.status === "future" && !event.weatherPrognosisAvailable
                ? "bg-gray-500/20 text-gray-300"
                : seasonBadgeStyles[event.season] ?? seasonBadgeStyles.Heating
            }`}
          >
            {event.season}
          </span>
        )}
        <span className="font-medium text-lb-heading">{event.name}</span>
        {showClickHint && !isFocused && (
          <span className="ml-auto text-[10px] uppercase tracking-wide text-lb-text-muted/80">
            Click to focus
          </span>
        )}
        {canModify && onEditEvent && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEditEvent(event);
            }}
            className="ml-auto rounded border border-[var(--surface-border)] px-2 py-0.5 text-xs text-lb-text transition-colors hover:border-lb-accent hover:text-lb-accent"
          >
            Edit
          </button>
        )}
        {canModify && onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className={`rounded border border-red-400/40 px-2 py-0.5 text-xs text-red-300 transition-colors hover:bg-red-500/10 ${
              canModify && onEditEvent ? "" : "ml-auto"
            }`}
          >
            Delete
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-lb-text-muted">
        {formatEventRange(event.startsAt, event.endsAt)}
      </p>
    </>
  );
}
