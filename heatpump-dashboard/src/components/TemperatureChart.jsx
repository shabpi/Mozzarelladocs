import { useMemo, useState, useEffect } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ComfortDeltaLayer from "./ComfortDeltaLayer";
import Co2QualityZonesLayer from "./Co2QualityZonesLayer";
import OperationModeForecastLayer from "./OperationModeForecastLayer";
import ChartZoomBrush from "./ChartZoomBrush";
import EventBandsLayer from "./EventBandsLayer";
import {
  BUCKET_MS,
  axisTickStyle,
  buildAdaptiveDayTicks,
  buildChartTimeline,
  buildTimeDomain,
  clipGapsToDomain,
  findNearestDataPoint,
  formatAxisTick,
  formatTooltipTime,
  getChartMargins,
  hasCo2SeriesData,
  hasTemperatureSeriesData,
  parseSpaceEventTime,
  parseTimestamp,
  resolveNowMarkerMs,
  spaceEventKey,
} from "../utils/chartUtils";
import { formatOperationMode } from "../utils/operationModeUtils";
import {
  enrichChartSeries,
  enrichPointForDisplay,
} from "../utils/temperatureDisplayUtils";

const chartStyles = {
  grid: "rgba(255, 255, 255, 0.1)",
  axis: "#cacaca",
  tooltip: {
    backgroundColor: "#1e4268",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    borderRadius: "0.75rem",
    color: "#fff",
  },
};

const noPrognosisStyle = {
  fill: "#94a3b8",
  fillOpacity: 0.34,
  stroke: "#cbd5e1",
  strokeOpacity: 0.85,
  strokeDasharray: "5 5",
};

const seasonEventStyles = {
  Heating: {
    historic: {
      fill: "#ff6148",
      fillOpacity: 0.32,
      stroke: "#ff6148",
      strokeOpacity: 0.7,
    },
    current: {
      fill: "#10b981",
      fillOpacity: 0.35,
      stroke: "#10b981",
      strokeOpacity: 0.8,
    },
    plannedWithPrognosis: {
      fill: "#c084fc",
      fillOpacity: 0.28,
      stroke: "#a855f7",
      strokeOpacity: 0.75,
      strokeDasharray: "4 4",
    },
  },
  Cooling: {
    historic: {
      fill: "#0b75b7",
      fillOpacity: 0.32,
      stroke: "#0b75b7",
      strokeOpacity: 0.7,
    },
    current: {
      fill: "#10b981",
      fillOpacity: 0.35,
      stroke: "#10b981",
      strokeOpacity: 0.8,
    },
    plannedWithPrognosis: {
      fill: "#2dd4bf",
      fillOpacity: 0.28,
      stroke: "#14b8a6",
      strokeOpacity: 0.75,
      strokeDasharray: "4 4",
    },
  },
};

const overlayLegendItems = [
  { label: "Heating event", color: "bg-lb-accent/70" },
  { label: "Cooling event", color: "bg-lb-accent-blue/70" },
  { label: "Current", color: "bg-emerald-500" },
  { label: "Planned heating", color: "bg-violet-400/70" },
  { label: "Planned cooling", color: "bg-teal-400/70" },
  { label: "Planned (no forecast)", color: "bg-slate-300/60" },
];

const missingPowerStyle = {
  fill: "#7c3aed",
  fillOpacity: 0.18,
  stroke: "#a78bfa",
  strokeOpacity: 0.55,
  strokeDasharray: "4 4",
};

function LegendEntry({ label, color, gradient, swatchStyle, swatchClassName, compact = false }) {
  return (
    <span className={`flex items-center ${compact ? "gap-2" : "gap-1.5"}`}>
      <span
        className={
          swatchClassName ??
          `inline-block shrink-0 rounded-sm ${gradient ? "h-4 w-2" : "h-2.5 w-2.5"} ${color ?? ""}`
        }
        style={
          swatchClassName
            ? undefined
            : gradient
              ? { background: gradient }
              : swatchStyle
                ? swatchStyle
                : undefined
        }
      />
      <span className={compact ? "text-xs text-lb-text" : undefined}>{label}</span>
    </span>
  );
}

function ChartLegendPopover({ entries, className = "" }) {
  if (!entries.length) return null;

  return (
    <div className={`group relative shrink-0 ${className}`}>
      <button
        type="button"
        aria-label="Show chart legend"
        title="Chart legend"
        className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--surface-border)] bg-white/5 text-xs font-semibold text-lb-text-muted transition-colors hover:border-white/25 hover:bg-white/10 hover:text-lb-heading"
      >
        ?
      </button>
      <div className="pointer-events-none invisible absolute right-0 top-full z-30 w-max max-w-[min(20rem,calc(100vw-2rem))] pt-1.5 opacity-0 transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100">
        <div
          className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-card)]"
          style={{ boxShadow: "var(--shadow-card), 0 8px 24px rgba(0,0,0,0.35)" }}
        >
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-lb-text-muted">
            Legend
          </p>
          <div className="flex flex-col gap-1.5 text-lb-text-muted">
            {entries.map(({ key, label, color, gradient, swatchStyle, swatchClassName }) => (
              <LegendEntry
                key={key}
                label={label}
                color={color}
                gradient={gradient}
                swatchStyle={swatchStyle}
                swatchClassName={swatchClassName}
                compact
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function eventDisplaySeason(event) {
  if (
    event.status === "future" &&
    event.weatherPrognosisAvailable &&
    event.forecastSeason
  ) {
    return event.forecastSeason === "Cooling" ? "Cooling" : "Heating";
  }
  return event.season === "Cooling" ? "Cooling" : "Heating";
}

function getEventStyle(event) {
  const season = eventDisplaySeason(event);
  const status = event.status ?? "historic";

  if (status === "future") {
    if (event.weatherPrognosisAvailable) {
      return seasonEventStyles[season].plannedWithPrognosis;
    }
    return noPrognosisStyle;
  }

  return seasonEventStyles[season][status] ?? seasonEventStyles[season].historic;
}

function eventBandLabel(event) {
  const parts = [event.name];
  if (event.custom && event.targetTemperatureC != null) {
    parts.push(`target ${event.targetTemperatureC}°C`);
  }
  if (event.forecastOutsideTempC != null) {
    parts.push(`outside ${event.forecastOutsideTempC}°C`);
  }
  return {
    value: parts.join(" · "),
    position: "insideTop",
    fill: "#ffffff",
    fontSize: 11,
    fontWeight: 600,
  };
}

function getEventBandEmphasis(style, { isSelected, isHighlighted, isHovered }) {
  if (isSelected) {
    return {
      fillOpacity: Math.min(1, style.fillOpacity + 0.2),
      strokeOpacity: 1,
      strokeWidth: 2,
    };
  }
  if (isHighlighted) {
    return {
      fillOpacity: Math.min(1, style.fillOpacity + 0.18),
      strokeOpacity: 0.95,
      strokeWidth: 2,
    };
  }
  if (isHovered) {
    return {
      fillOpacity: Math.min(1, style.fillOpacity + 0.15),
      strokeOpacity: 0.85,
      strokeWidth: 2,
    };
  }
  return {
    fillOpacity: style.fillOpacity,
    strokeOpacity: style.strokeOpacity,
    strokeWidth: 1,
  };
}

function pointHasTemperatureData(point) {
  return point != null && point.insideTemp != null && !point.domainAnchor;
}

function pointHasHoverData(point) {
  if (!point || point.domainAnchor) return false;
  return (
    point.insideTemp != null ||
    point.targetTemp != null ||
    point.outsideTemp != null ||
    point.returnTemp != null ||
    point.co2Ppm != null ||
    point.powerDrawKw != null
  );
}

function buildPowerMissingRanges(data) {
  const ranges = [];
  let rangeStart = null;
  let rangeEnd = null;

  for (const point of data) {
    if (point.domainAnchor || point.insideTemp == null || !point.powerMissing) {
      if (rangeStart !== null) {
        ranges.push({ start: rangeStart, end: rangeEnd + BUCKET_MS });
        rangeStart = null;
      }
      continue;
    }

    if (rangeStart === null) {
      rangeStart = point.time;
    }
    rangeEnd = point.time;
  }

  if (rangeStart !== null) {
    ranges.push({ start: rangeStart, end: rangeEnd + BUCKET_MS });
  }

  return ranges;
}

export default function TemperatureChart({
  data = [],
  rangeStart,
  rangeEnd,
  gaps = [],
  events = [],
  chartTitle = "Temperature Over Time",
  showEventsOverlay = false,
  weatherPrognosisHorizonDays = 10,
  showForecastTemperatureLines = false,
  eventsOnlyTarget = false,
  showInsideTempPrediction = false,
  showOperationModeForecast = false,
  showOutsideTemp = false,
  showReturnTemp = false,
  showPowerOverlay = false,
  showComfortOverlay = false,
  showCo2Overlay = false,
  showCo2QualityZones = false,
  hideTemperatureSeries = false,
  zoomSelectMode = false,
  canZoomBack = false,
  zoomBackSteps = 0,
  onToggleZoomSelectMode,
  onZoomBack,
  onZoomSelect,
  onHoverPoint,
  onHoverLeave,
  onEventClick,
  selectedEventKey = null,
  highlightedEventKey = null,
  showEventBandLabels = false,
  onChartPointerMove,
  hideZoomControls = false,
  showSelectZoomControls,
  forecastToolbar = null,
  showEventSelectButton = false,
  eventSelectMode = false,
  onToggleEventSelectMode,
  overlayControls = [],
  onUpdateForecast,
  updatingForecast = false,
  powerReferenceLines = [],
  additionalPowerLines = [],
  extraLegendItems = [],
  hidePrimaryPowerSeries = false,
  powerSeriesAsLine = false,
  powerLineOpacity = 1,
  currentTimeMarker = null,
  currentTimeLabel = "Now",
  scrubTimeMarker = null,
  scrubTimeLabel = "Viewing",
  compact = false,
  embedded = false,
}) {
  const overlayEvents = showEventsOverlay ? events : [];
  const displaySelectZoomControls = showSelectZoomControls ?? !hideZoomControls;
  const eventsClickable = Boolean(onEventClick) && !zoomSelectMode;
  const [hoveredEventKey, setHoveredEventKey] = useState(null);
  const broadEventView = showEventBandLabels && !selectedEventKey;

  useEffect(() => {
    setHoveredEventKey(null);
  }, [selectedEventKey]);

  const chartData = useMemo(
    () => buildChartTimeline(data, rangeStart, rangeEnd),
    [data, rangeEnd, rangeStart],
  );

  const currentTimeX = useMemo(() => {
    return resolveNowMarkerMs(currentTimeMarker);
  }, [currentTimeMarker]);

  const scrubTimeX = useMemo(() => {
    if (!scrubTimeMarker) return null;
    const x = parseTimestamp(scrubTimeMarker);
    return Number.isNaN(x) ? null : x;
  }, [scrubTimeMarker]);

  const displayChartData = useMemo(() => {
    if (!showForecastTemperatureLines) return chartData;
    return enrichChartSeries(chartData, data, events, currentTimeMarker, gaps, {
      eventsOnlyTarget,
    });
  }, [
    chartData,
    currentTimeMarker,
    data,
    events,
    eventsOnlyTarget,
    gaps,
    showForecastTemperatureLines,
  ]);

  const domain = useMemo(() => {
    const fixedDomain = buildTimeDomain(rangeStart, rangeEnd);
    if (fixedDomain) return fixedDomain;
    if (chartData.length === 0) return ["auto", "auto"];
    return [chartData[0].time, chartData[chartData.length - 1].time];
  }, [chartData, rangeEnd, rangeStart]);

  const dayTicks = useMemo(
    () => buildAdaptiveDayTicks(rangeStart, rangeEnd),
    [rangeEnd, rangeStart],
  );

  const visibleGaps = useMemo(
    () => clipGapsToDomain(gaps, rangeStart, rangeEnd),
    [gaps, rangeEnd, rangeStart],
  );

  const showEmptyRange = useMemo(() => {
    if (!Array.isArray(domain) || domain.length !== 2) return false;
    if (hasTemperatureSeriesData(data)) return false;
    if (showCo2Overlay && hasCo2SeriesData(data)) return false;
    return visibleGaps.length === 0;
  }, [data, domain, showCo2Overlay, visibleGaps]);

  const denseAxis = dayTicks.length > 14;
  const hasGaps = visibleGaps.length > 0 || showEmptyRange;
  const chartMargins = compact
    ? {
        top: 4,
        right: showPowerOverlay ? 26 : 4,
        bottom: denseAxis ? 28 : 4,
        left: 0,
      }
    : getChartMargins({
        denseAxis,
        rightAxisCount: (showPowerOverlay ? 1 : 0) + (showCo2Overlay ? 1 : 0),
        operationModeLane: showOperationModeForecast,
      });
  const compactAxisTickStyle = { fontSize: 9, fill: "#cacaca" };
  const axisTick = compact ? compactAxisTickStyle : axisTickStyle;

  // Event bands and gap shading use the temp axis by default; when temperature
  // series are hidden (CO₂-focused view), anchor overlays to a visible axis.
  const bandYAxisId = useMemo(() => {
    if (!hideTemperatureSeries) return "temp";
    if (showCo2Overlay) return "co2";
    if (showPowerOverlay) return "power";
    return "temp";
  }, [hideTemperatureSeries, showCo2Overlay, showPowerOverlay]);

  const powerMissingRanges = useMemo(() => {
    if (!showPowerOverlay) return [];
    return buildPowerMissingRanges(chartData);
  }, [chartData, showPowerOverlay]);

  const seriesPointerEvents = zoomSelectMode ? "none" : undefined;

  const eventBands = useMemo(
    () =>
      overlayEvents.map((event) => {
        const style = getEventStyle(event);
        const eventKey = spaceEventKey(event);
        const isSelected =
          selectedEventKey != null && eventKey === selectedEventKey;
        const isHighlighted =
          broadEventView &&
          highlightedEventKey != null &&
          eventKey === highlightedEventKey;
        const isHovered =
          broadEventView && hoveredEventKey != null && eventKey === hoveredEventKey;
        const emphasis = getEventBandEmphasis(style, {
          isSelected,
          isHighlighted,
          isHovered,
        });
        const showLabel =
          broadEventView && (isHighlighted || isHovered) && event.name;

        return {
          key: eventKey,
          event,
          x1: parseSpaceEventTime(event.startsAt),
          x2: parseSpaceEventTime(event.endsAt),
          fill: style.fill,
          fillOpacity: emphasis.fillOpacity,
          stroke: style.stroke,
          strokeOpacity: emphasis.strokeOpacity,
          strokeWidth: emphasis.strokeWidth,
          strokeDasharray: style.strokeDasharray,
          label: showLabel ? eventBandLabel(event).value : null,
          pointerEvents: seriesPointerEvents,
        };
      }),
    [
      broadEventView,
      highlightedEventKey,
      hoveredEventKey,
      overlayEvents,
      selectedEventKey,
      seriesPointerEvents,
    ],
  );

  const operationModeSegments = useMemo(() => {
    if (!showOperationModeForecast) return [];

    const segments = [];

    for (const point of chartData) {
      if (!point?.operationMode) continue;
      segments.push({
        key: `opmode-${point.time}`,
        x1: point.time,
        x2: point.time + BUCKET_MS,
        mode: point.operationMode,
      });
    }

    return segments;
  }, [chartData, showOperationModeForecast]);

  const seriesLegend = [
    { label: "Inside", color: "bg-lb-accent", show: !hideTemperatureSeries },
    {
      label: "Inside (forecast)",
      color: "border border-dashed bg-transparent",
      show: !hideTemperatureSeries && showInsideTempPrediction,
      swatchStyle: { borderColor: "#ff6148" },
    },
    {
      label: "Heating",
      color: "bg-orange-400",
      show: showOperationModeForecast,
    },
    {
      label: "Cooling",
      color: "bg-sky-400",
      show: showOperationModeForecast,
    },
    {
      label: "Idle",
      color: "bg-slate-400",
      show: showOperationModeForecast,
    },
    { label: "Target", color: "bg-lb-accent-blue", show: !hideTemperatureSeries },
    { label: "Outside", color: "bg-sky-400", show: !hideTemperatureSeries && showOutsideTemp },
    { label: "Recorded", color: "bg-violet-400", show: !hideTemperatureSeries && showReturnTemp },
    { label: "Power draw", color: "bg-amber-400", show: showPowerOverlay && !hidePrimaryPowerSeries },
    { label: "CO₂", color: "bg-emerald-400", show: showCo2Overlay },
    {
      label: "Comfort delta",
      gradient: "linear-gradient(to bottom, #22c55e, #eab308, #ef4444)",
      show: showComfortOverlay,
    },
    ...extraLegendItems.map((item) => ({ ...item, show: true })),
    ...powerReferenceLines.map((line) => ({
      label: line.label,
      color: "border border-dashed bg-transparent",
      show: showPowerOverlay,
      swatchStyle: { borderColor: line.color },
    })),
  ].filter((item) => item.show);

  const legendEntries = [
    ...seriesLegend.map((item) => ({ key: item.label, ...item })),
    ...(hasGaps
      ? [{ key: "no-data", label: "No data", color: "bg-gray-600/60" }]
      : []),
    ...(showPowerOverlay && powerMissingRanges.length > 0
      ? [
          {
            key: "missing-power",
            label: "Missing power (0 kW)",
            color: "bg-violet-500/40",
          },
        ]
      : []),
    ...(currentTimeX != null
      ? [
          {
            key: "current-time",
            label: currentTimeLabel,
            swatchClassName: "inline-block h-2.5 w-0.5 shrink-0 rounded-sm bg-lb-accent",
          },
        ]
      : []),
    ...(showEventsOverlay
      ? overlayLegendItems.map((item) => ({ key: item.label, ...item }))
      : []),
  ];

  function handleChartMouseMove(state) {
    if (zoomSelectMode || eventSelectMode || !onHoverPoint) return;

    const hoverSource = showForecastTemperatureLines ? displayChartData : chartData;
    const hoverTime =
      state?.activeLabel != null ? Number(state.activeLabel) : null;
    const payloads = state?.activePayload ?? [];
    let point = payloads.find((entry) => {
      const payload = entry?.payload;
      if (!payload || payload.domainAnchor) return false;
      if (pointHasHoverData(payload)) return true;
      return false;
    })?.payload;

    if (!point) {
      point = findNearestDataPoint(hoverSource, hoverTime, 6 * 60 * 60 * 1000);
    }

    const enriched = enrichPointForDisplay(
      point,
      data,
      events,
      currentTimeMarker,
      hoverTime,
      { eventsOnlyTarget },
    );

    onHoverPoint(enriched);
  }

  function handleChartMouseLeave() {
    if (zoomSelectMode || eventSelectMode) return;
    onHoverLeave?.();
  }

  return (
    <div
      className={`relative w-full ${
        embedded
          ? ""
          : "rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] shadow-[var(--shadow-card)]"
      } ${compact && !embedded ? "p-3" : embedded ? "" : "p-5"}`}
      style={embedded ? undefined : { boxShadow: "var(--shadow-card), var(--shadow-glow)" }}
    >
      {compact ? (
        <div className="mb-2 flex items-center justify-end">
          <ChartLegendPopover entries={legendEntries} />
        </div>
      ) : (
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-lb-heading">{chartTitle}</h2>
          {displaySelectZoomControls && (
            <>
              <button
                type="button"
                onClick={onToggleZoomSelectMode}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  zoomSelectMode
                    ? "border-sky-400 bg-sky-500/20 text-sky-200"
                    : "border-[var(--surface-border)] text-lb-text-muted hover:border-lb-accent hover:text-lb-accent"
                }`}
                aria-pressed={zoomSelectMode}
              >
                {zoomSelectMode ? "Cancel select" : "Select to zoom"}
              </button>
              {canZoomBack && (
                <button
                  type="button"
                  onClick={onZoomBack}
                  className="rounded-lg border border-[var(--surface-border)] px-3 py-1.5 text-xs font-medium text-lb-text-muted transition-colors hover:border-lb-accent hover:text-lb-accent"
                >
                  ← Back{zoomBackSteps > 1 ? ` (${zoomBackSteps})` : ""}
                </button>
              )}
            </>
          )}
          {forecastToolbar}
          {!hideZoomControls && showEventSelectButton && (
            <button
              type="button"
              onClick={onToggleEventSelectMode}
              disabled={zoomSelectMode}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                eventSelectMode
                  ? "border-lb-accent bg-lb-accent/20 text-lb-accent"
                  : "border-[var(--surface-border)] text-lb-text-muted hover:border-lb-accent hover:text-lb-accent"
              } ${zoomSelectMode ? "cursor-not-allowed opacity-40" : ""}`}
              aria-pressed={eventSelectMode}
            >
              {eventSelectMode ? "Cancel event select" : "Select event"}
            </button>
          )}
          {overlayControls.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {overlayControls.map(
                ({ key, label, title, active, onToggle, color, gradient, swatchColor }) => (
                  <button
                    key={key}
                    type="button"
                    title={title ?? label}
                    aria-label={title ?? label}
                    aria-pressed={active}
                    onClick={onToggle}
                    className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors ${
                      active
                        ? "border-white/30 bg-white/10 text-lb-heading"
                        : "border-[var(--surface-border)] text-lb-text-muted hover:border-white/20 hover:text-lb-text"
                    }`}
                  >
                    <span
                      className={`inline-block rounded-sm ${gradient ? "h-3 w-1.5" : "h-2 w-2"} ${color ?? ""}`}
                      style={
                        gradient
                          ? { background: gradient }
                          : swatchColor
                            ? { backgroundColor: swatchColor }
                            : undefined
                      }
                    />
                    <span>{label}</span>
                  </button>
                ),
              )}
              {onUpdateForecast && (
                <button
                  type="button"
                  onClick={onUpdateForecast}
                  disabled={updatingForecast}
                  className="rounded-md border border-sky-400/50 bg-sky-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-sky-200 transition-colors hover:border-sky-300 hover:bg-sky-500/20 disabled:opacity-50"
                >
                  {updatingForecast ? "Updating…" : "Update forecast"}
                </button>
              )}
            </div>
          )}
        </div>
        <ChartLegendPopover entries={legendEntries} />
      </div>
      )}

      <div
        className={`relative ${compact ? "h-28" : "h-96"} ${showEventsOverlay || showPowerOverlay || showComfortOverlay ? "opacity-95" : ""} ${zoomSelectMode ? "cursor-crosshair ring-1 ring-sky-400/40" : ""} ${eventSelectMode ? "ring-1 ring-lb-accent/40" : ""} ${compact ? "cursor-crosshair" : ""}`}
        onMouseMove={() => {
          if (broadEventView && highlightedEventKey && !zoomSelectMode) {
            onChartPointerMove?.();
          }
        }}
        onMouseLeave={zoomSelectMode || eventSelectMode ? undefined : handleChartMouseLeave}
      >
        {(showEventsOverlay || showPowerOverlay) && !zoomSelectMode && !compact && (
          <div className="pointer-events-none absolute inset-0 z-10 bg-black/10" />
        )}

        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={displayChartData}
            margin={chartMargins}
            onMouseMove={zoomSelectMode ? undefined : handleChartMouseMove}
            onMouseLeave={zoomSelectMode ? undefined : handleChartMouseLeave}
          >
            <CartesianGrid stroke={chartStyles.grid} strokeDasharray="3 3" />
            {currentTimeX != null && (
              <ReferenceLine
                yAxisId={bandYAxisId}
                x={currentTimeX}
                stroke="#ff6148"
                strokeDasharray="4 4"
                strokeWidth={compact ? 1 : 1.5}
                label={
                  compact
                    ? undefined
                    : {
                        value: currentTimeLabel,
                        position: "insideTopLeft",
                        fill: "#ff6148",
                        fontSize: 10,
                      }
                }
              />
            )}
            {scrubTimeX != null && (
              <ReferenceLine
                yAxisId={bandYAxisId}
                x={scrubTimeX}
                stroke="#fbbf24"
                strokeWidth={compact ? 2 : 1.5}
                label={
                  compact
                    ? undefined
                    : {
                        value: scrubTimeLabel,
                        position: "insideTopRight",
                        fill: "#fbbf24",
                        fontSize: 10,
                      }
                }
              />
            )}
            {showEmptyRange && Array.isArray(domain) && domain.length === 2 && (
              <ReferenceArea
                yAxisId={bandYAxisId}
                x1={domain[0]}
                x2={domain[1]}
                fill="#374151"
                fillOpacity={0.35}
                stroke="#6b7280"
                strokeOpacity={0.5}
                strokeDasharray="4 4"
              />
            )}
            {visibleGaps.map((gap) => (
              <ReferenceArea
                key={`gap-${gap.key}`}
                yAxisId={bandYAxisId}
                x1={gap.start}
                x2={gap.end}
                fill="#374151"
                fillOpacity={0.35}
                stroke="#6b7280"
                strokeOpacity={0.5}
                strokeDasharray="4 4"
              />
            ))}
            {showPowerOverlay &&
              powerMissingRanges.map((range, index) => (
                <ReferenceArea
                  key={`power-missing-${range.start}-${index}`}
                  yAxisId="power"
                  x1={range.start}
                  x2={range.end}
                  fill={missingPowerStyle.fill}
                  fillOpacity={missingPowerStyle.fillOpacity}
                  stroke={missingPowerStyle.stroke}
                  strokeOpacity={missingPowerStyle.strokeOpacity}
                  strokeDasharray={missingPowerStyle.strokeDasharray}
                />
              ))}
            <XAxis
              dataKey="time"
              type="number"
              scale="linear"
              domain={domain}
              allowDataOverflow
              allowDecimals={false}
              padding={{ left: 0, right: 0 }}
              ticks={dayTicks.length > 0 ? dayTicks : undefined}
              interval={0}
              minTickGap={0}
              angle={denseAxis ? -45 : 0}
              textAnchor={denseAxis ? "end" : "middle"}
              height={denseAxis ? (compact ? 28 : 36) : compact ? 14 : 18}
              tickMargin={compact ? 1 : 2}
              tick={axisTick}
              tickLine={{ stroke: chartStyles.axis }}
              axisLine={{ stroke: chartStyles.axis }}
              tickFormatter={formatAxisTick}
            />
            <YAxis
              yAxisId="temp"
              width={hideTemperatureSeries ? 0 : compact ? 30 : 44}
              tick={hideTemperatureSeries ? false : axisTick}
              tickLine={hideTemperatureSeries ? false : { stroke: chartStyles.axis }}
              axisLine={hideTemperatureSeries ? false : { stroke: chartStyles.axis }}
              tickMargin={compact ? 2 : 4}
              unit={hideTemperatureSeries ? undefined : "°C"}
              hide={hideTemperatureSeries}
            />
            {showCo2Overlay && (
              <YAxis
                yAxisId="co2"
                orientation="right"
                width={44}
                tickMargin={2}
                unit=" ppm"
                domain={showCo2QualityZones ? [400, 1600] : [400, "auto"]}
                tick={{ fill: "#34d399", fontSize: 11 }}
                tickLine={{ stroke: "#34d399" }}
                axisLine={{ stroke: "#34d399" }}
              />
            )}
            {showPowerOverlay && (
              <YAxis
                yAxisId="power"
                orientation="right"
                width={compact ? 24 : 40}
                tickMargin={compact ? 1 : 2}
                unit=" kW"
                offset={showCo2Overlay ? 48 : 0}
                tick={{ fill: "#fbbf24", fontSize: compact ? 9 : 11 }}
                tickLine={{ stroke: "#fbbf24" }}
                axisLine={{ stroke: "#fbbf24" }}
              />
            )}
            <ComfortDeltaLayer
              data={chartData}
              showComfortOverlay={showComfortOverlay}
            />
            <Co2QualityZonesLayer showCo2QualityZones={showCo2QualityZones} />
            <OperationModeForecastLayer segments={operationModeSegments} />
            {showEventsOverlay && (
              <EventBandsLayer
                bands={eventBands}
                clickable={eventsClickable}
                onEventClick={onEventClick}
                onEventHover={(eventKey) => {
                  if (broadEventView) {
                    setHoveredEventKey(eventKey);
                  }
                }}
                onEventHoverEnd={(eventKey) => {
                  if (broadEventView) {
                    setHoveredEventKey((current) =>
                      current === eventKey ? null : current,
                    );
                  }
                }}
              />
            )}
            <Tooltip
              {...(zoomSelectMode || eventSelectMode || compact ? { active: false } : {})}
              contentStyle={chartStyles.tooltip}
              labelFormatter={(label, payload) => {
                const point = payload?.[0]?.payload;
                const timeLabel = formatTooltipTime(label);
                if (showOperationModeForecast && point?.operationMode) {
                  return `${timeLabel} · ${formatOperationMode(point.operationMode)}`;
                }
                return timeLabel;
              }}
              filterNull
              formatter={(value, name, props) => {
                const payload = props?.payload;
                if (payload?.domainAnchor) return [null, null];
                if (value == null) return [null, null];

                const hoverTime = payload?.time;
                const isFuture =
                  currentTimeX != null &&
                  hoverTime != null &&
                  hoverTime > currentTimeX;

                if (name === "Outside") {
                  const suffix = payload?.outsideIsForecast ? " (forecast)" : "";
                  return [`${value} °C${suffix}`, name];
                }

                if (name === "Target") {
                  const suffix = payload?.targetIsSavedFuture
                    ? " (saved)"
                    : payload?.targetIsStandby
                      ? " (standby)"
                      : isFuture
                        ? " (forecast)"
                        : "";
                  return [`${value} °C${suffix}`, name];
                }

                if (name === "Inside (forecast)") {
                  const suffix = payload?.insideTempForecast ? " (forecast)" : "";
                  return [`${value} °C${suffix}`, name];
                }

                if (payload?.operationMode) {
                  return null;
                }

                if (payload?.forecast && !isFuture) {
                  return [null, null];
                }

                if (name === "Power draw") {
                  const missing = payload?.powerMissing;
                  const suffix = missing ? " (no reading, imputed 0)" : "";
                  return [`${value} kW${suffix}`, name];
                }
                if (name === "CO₂") {
                  if (value == null || payload?.co2Ppm == null) return [null, null];
                  return [`${value} ppm`, name];
                }
                if (
                  showComfortOverlay &&
                  payload?.insideTemp != null &&
                  payload?.targetTemp != null &&
                  (name === "Inside" || name === "Target")
                ) {
                  const delta = Math.abs(
                    payload.insideTemp - payload.targetTemp,
                  ).toFixed(1);
                  const targetLabel = isFuture ? "Target (saved)" : "Target";
                  if (name === "Target") {
                    return [`${value} °C`, targetLabel];
                  }
                  return [`${value} °C (Δ ${delta} °C)`, name];
                }
                return [`${value} °C`, name];
              }}
            />
            {showCo2Overlay && (
              <Line
                yAxisId="co2"
                type="monotone"
                dataKey="co2Ppm"
                name="CO₂"
                stroke="#34d399"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                style={{ pointerEvents: seriesPointerEvents }}
              />
            )}
            {showPowerOverlay && !hidePrimaryPowerSeries && !powerSeriesAsLine && (
              <Area
                yAxisId="power"
                type="monotone"
                dataKey="powerDrawKw"
                name="Power draw"
                fill="#fbbf24"
                fillOpacity={0.2}
                stroke="#fbbf24"
                strokeWidth={2}
                dot={false}
                connectNulls
                style={{ pointerEvents: seriesPointerEvents }}
              />
            )}
            {showPowerOverlay && !hidePrimaryPowerSeries && powerSeriesAsLine && (
              <Line
                yAxisId="power"
                type="monotone"
                dataKey="powerDrawKw"
                name="Power draw"
                stroke="#fbbf24"
                strokeOpacity={powerLineOpacity}
                strokeWidth={compact ? 1.25 : 2}
                dot={false}
                connectNulls
                style={{ pointerEvents: seriesPointerEvents }}
              />
            )}
            {showPowerOverlay &&
              additionalPowerLines.map(({ dataKey, name, color, strokeWidth = 2 }) => (
                <Line
                  key={dataKey}
                  yAxisId="power"
                  type="monotone"
                  dataKey={dataKey}
                  name={name}
                  stroke={color}
                  strokeWidth={strokeWidth}
                  dot={false}
                  connectNulls={false}
                  style={{ pointerEvents: seriesPointerEvents }}
                />
              ))}
            {showPowerOverlay &&
              powerReferenceLines.map((line) => (
                <ReferenceLine
                  key={line.key}
                  yAxisId="power"
                  y={line.value}
                  stroke={line.color}
                  strokeDasharray={line.strokeDasharray ?? "6 4"}
                  strokeWidth={1.5}
                  label={{
                    value: line.label,
                    fill: line.color,
                    fontSize: 10,
                    position: "insideTopRight",
                  }}
                />
              ))}
            {!hideTemperatureSeries && (
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="insideTemp"
                name="Inside"
                stroke="#ff6148"
                strokeWidth={compact ? 1.5 : 2}
                dot={false}
                connectNulls={false}
                style={{ pointerEvents: seriesPointerEvents }}
              />
            )}
            {!hideTemperatureSeries && showInsideTempPrediction && (
              <Line
                yAxisId="temp"
                type="linear"
                dataKey="insideTempPredicted"
                name="Inside (forecast)"
                stroke="#ff6148"
                strokeWidth={compact ? 1.5 : 2}
                strokeDasharray="6 4"
                strokeOpacity={0.9}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
                style={{ pointerEvents: seriesPointerEvents }}
              />
            )}
            {!hideTemperatureSeries && (
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="targetTemp"
                name="Target"
                stroke="#0b75b7"
                strokeWidth={compact ? 1.5 : 2}
                dot={false}
                connectNulls={false}
                style={{ pointerEvents: seriesPointerEvents }}
              />
            )}
            {!hideTemperatureSeries && showOutsideTemp && (
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="outsideTemp"
                name="Outside"
                stroke="#38bdf8"
                strokeWidth={2}
                dot={false}
                connectNulls={showForecastTemperatureLines}
                style={{ pointerEvents: seriesPointerEvents }}
              />
            )}
            {!hideTemperatureSeries && showReturnTemp && (
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="returnTemp"
                name="Recorded"
                stroke="#a78bfa"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                style={{ pointerEvents: seriesPointerEvents }}
              />
            )}
            {zoomSelectMode && (
              <ChartZoomBrush
                active
                yAxisId={bandYAxisId}
                onZoomSelect={onZoomSelect}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {compact && (
        <p className="mt-2 text-[10px] text-lb-text-muted/80">
          Move across the chart to scrub time · events shown on the timeline
        </p>
      )}

      {!compact && zoomSelectMode && !eventSelectMode && (
        <p className="mt-3 text-xs text-sky-300/90">
          {selectedEventKey
            ? "Drag across the chart to select a subsection of the current timeframe. The current view is saved — use Back to return."
            : "Drag across the chart to zoom into a time range. Minimum selection is 15 minutes."}
        </p>
      )}

      {!compact && eventSelectMode && showEventsOverlay && !hideZoomControls && (
        <p className="mt-3 text-xs text-lb-accent/90">
          Click an event band to zoom to that event. The previous timeframe is
          saved — use Back to return.
        </p>
      )}

      {!compact && showEmptyRange && !zoomSelectMode && (
        <p className="mt-3 text-xs text-lb-text-muted">
          No temperature data in the selected timeframe — axis spans the full
          selection with day labels.
        </p>
      )}

      {!compact && showComfortOverlay && !showEmptyRange && (
        <p className="mt-3 text-xs text-lb-text-muted">
          Shaded band between inside and target: green at target, grading vertically
          to yellow/red toward inside (0 °C → green, 5 °C+ → red).
        </p>
      )}

      {!compact && showEventsOverlay && overlayEvents.length > 0 && hideZoomControls && (
        <p className="mt-3 text-xs text-lb-text-muted">
          Click an event band on the chart to focus and zoom. Click the same
          event in the list again to show all events.
        </p>
      )}

      {!compact &&
        showEventsOverlay &&
        overlayEvents.length > 0 &&
        displaySelectZoomControls &&
        !eventSelectMode && (
          <p className="mt-3 text-xs text-lb-text-muted">
            Violet/teal dashed bands = forecast heating/cooling from outside vs target
            (7-day outlook). Toggle Outside to show measured (past) and forecast
            (after Now) on the same line; Target shows saved event targets in the
            future. Light grey dashed = planned events beyond the{" "}
            {weatherPrognosisHorizonDays}-day forecast window.
          </p>
        )}
    </div>
  );
}
