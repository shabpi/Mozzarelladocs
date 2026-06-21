import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildRangeQuery, getSpaceEvents, getTimeseries } from "../api";
import { buildCo2TimelineRangeQuery } from "../utils/eventsUtils";
import { CO2_QUALITY_ZONES, getCo2Quality, normalizeCo2Ppm, resolveCo2PpmAtTime } from "../utils/co2Utils";
import { parseTimestamp, spaceEventKey, timeRangeToSelection } from "../utils/chartUtils";
import { formatDateRangeLabel, formatIsoDateTimeString, fromApiDateTime } from "../utils/spaceEventDateUtils";
import Co2LevelCard from "./Co2LevelCard";
import LoadingIndicator from "./LoadingIndicator";
import TemperatureChart from "./TemperatureChart";
import {
  EventRowContent,
  eventOverlapsTimeline,
  eventToRangeQuery,
  getEventStyle,
  rangeQueryFromTimeseries,
} from "../utils/eventDetailShared";

const EMPTY_TIMESERIES = {
  points: [],
  rangeStart: null,
  rangeEnd: null,
  gaps: [],
};

export default function Co2DetailView({
  referenceAtForActions,
  co2CheckedAt,
  displayRangeStart,
  displayRangeEnd,
  weatherPrognosisHorizonDays = 10,
  onBack,
}) {
  const [timeseries, setTimeseries] = useState(EMPTY_TIMESERIES);
  const [allEvents, setAllEvents] = useState([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [hoverPpm, setHoverPpm] = useState(null);
  const [hoverTimestamp, setHoverTimestamp] = useState(null);
  const [isChartHovering, setIsChartHovering] = useState(false);
  const [showOutsideOnChart, setShowOutsideOnChart] = useState(false);
  const [showReturnOnChart, setShowReturnOnChart] = useState(false);
  const [showPowerOverlay, setShowPowerOverlay] = useState(false);
  const [showComfortOverlay, setShowComfortOverlay] = useState(false);
  const [showEventsOverlay, setShowEventsOverlay] = useState(true);
  const [eventSelectMode, setEventSelectMode] = useState(false);
  const [focusedEventKey, setFocusedEventKey] = useState(null);
  const [pinSelectedCard, setPinSelectedCard] = useState(false);
  const [zoomSelectMode, setZoomSelectMode] = useState(false);
  const [zoomHistory, setZoomHistory] = useState([]);
  const [returnHighlightEventKey, setReturnHighlightEventKey] = useState(null);
  const [forecastReferenceAt, setForecastReferenceAt] = useState(null);

  const stickyPanelRef = useRef(null);
  const itemRefs = useRef(new Map());
  const lastScrolledRangeRef = useRef(null);
  const timeseriesRef = useRef(EMPTY_TIMESERIES);
  const prevFocusedEventKeyRef = useRef(null);

  useEffect(() => {
    timeseriesRef.current = timeseries;
  }, [timeseries]);

  useEffect(() => {
    if (zoomSelectMode) {
      setEventSelectMode(false);
    }
  }, [zoomSelectMode]);

  const loadChartData = useCallback(
    async (range = {}) => {
      if (!referenceAtForActions) return;
      setChartLoading(true);
      setLoadError("");
      try {
        const data = await getTimeseries(range, {
          referenceAt: referenceAtForActions,
          forecastFuture: true,
        });
        setTimeseries(data);
      } catch (error) {
        console.error(error);
        setLoadError("Could not load CO₂ data. Check that the backend is running.");
      } finally {
        setChartLoading(false);
      }
    },
    [referenceAtForActions],
  );

  const refreshAllEvents = useCallback(async () => {
    if (!referenceAtForActions) return [];
    try {
      const events = await getSpaceEvents(referenceAtForActions, {});
      setAllEvents(events);
      return events;
    } catch (error) {
      console.error(error);
      return [];
    }
  }, [referenceAtForActions]);

  const loadFullEventTimeline = useCallback(async () => {
    const events = await refreshAllEvents();
    const chartRange = buildCo2TimelineRangeQuery({
      displayRangeStart,
      displayRangeEnd,
      events,
    });
    await loadChartData(chartRange);
  }, [displayRangeEnd, displayRangeStart, loadChartData, refreshAllEvents]);

  useEffect(() => {
    if (!referenceAtForActions) return;
    loadFullEventTimeline();
  }, [loadFullEventTimeline, referenceAtForActions]);

  const chronologicalEvents = useMemo(
    () =>
      [...allEvents].sort(
        (a, b) =>
          fromApiDateTime(a.startsAt).getTime() -
          fromApiDateTime(b.startsAt).getTime(),
      ),
    [allEvents],
  );

  const focusedEvent = useMemo(
    () => chronologicalEvents.find((e) => spaceEventKey(e) === focusedEventKey) ?? null,
    [chronologicalEvents, focusedEventKey],
  );

  const focusedIndex = focusedEvent
    ? chronologicalEvents.findIndex((e) => spaceEventKey(e) === focusedEventKey)
    : -1;

  const { rangeStart, rangeEnd } = timeseries;
  const isTimelineSubsection = zoomHistory.length > 0 || Boolean(focusedEventKey);

  const firstInRangeEventKey = useMemo(() => {
    if (!isTimelineSubsection || !rangeStart || !rangeEnd) return null;
    const first = chronologicalEvents.find((event) =>
      eventOverlapsTimeline(event, rangeStart, rangeEnd),
    );
    return first ? spaceEventKey(first) : null;
  }, [chronologicalEvents, isTimelineSubsection, rangeEnd, rangeStart]);

  const pushCurrentRangeToHistory = useCallback(() => {
    const snapshot = rangeQueryFromTimeseries(timeseriesRef.current);
    setZoomHistory((history) => [...history, snapshot]);
  }, []);

  const clearSelection = useCallback(async () => {
    setFocusedEventKey(null);
    setPinSelectedCard(false);
    setZoomSelectMode(false);
    setEventSelectMode(false);
    setZoomHistory([]);
    lastScrolledRangeRef.current = null;
    await loadFullEventTimeline();
  }, [loadFullEventTimeline]);

  const selectEvent = useCallback(
    (event, { recordHistory = true } = {}) => {
      if (recordHistory) {
        pushCurrentRangeToHistory();
      }
      setReturnHighlightEventKey(null);
      setFocusedEventKey(spaceEventKey(event));
      setZoomSelectMode(false);
      setEventSelectMode(false);
      lastScrolledRangeRef.current = null;
      loadChartData(eventToRangeQuery(event));
    },
    [loadChartData, pushCurrentRangeToHistory],
  );

  const handleChartPointerMove = useCallback(() => {
    setReturnHighlightEventKey(null);
  }, []);

  useEffect(() => {
    if (prevFocusedEventKeyRef.current && !focusedEventKey) {
      setReturnHighlightEventKey(prevFocusedEventKeyRef.current);
    }
    prevFocusedEventKeyRef.current = focusedEventKey;
  }, [focusedEventKey]);

  const returnHighlightEvent = useMemo(
    () =>
      chronologicalEvents.find((e) => spaceEventKey(e) === returnHighlightEventKey) ??
      null,
    [chronologicalEvents, returnHighlightEventKey],
  );

  const handleChartEventClick = useCallback(
    (event) => {
      const key = spaceEventKey(event);
      if (focusedEventKey === key) return;
      selectEvent(event);
    },
    [focusedEventKey, selectEvent],
  );

  const handleEventClick = useCallback(
    (event) => {
      const key = spaceEventKey(event);
      if (focusedEventKey === key) {
        clearSelection();
        return;
      }
      selectEvent(event);
    },
    [clearSelection, focusedEventKey, selectEvent],
  );

  const goToAdjacentEvent = useCallback(
    (direction) => {
      if (focusedIndex < 0) return;
      const nextIndex = focusedIndex + direction;
      if (nextIndex < 0 || nextIndex >= chronologicalEvents.length) return;
      selectEvent(chronologicalEvents[nextIndex], { recordHistory: false });
    },
    [chronologicalEvents, focusedIndex, selectEvent],
  );

  function handleToggleZoomSelectMode() {
    setZoomSelectMode((open) => !open);
  }

  function handleToggleEventSelectMode() {
    setZoomSelectMode(false);
    setEventSelectMode((open) => !open);
  }

  function handleChartZoomSelect(startMs, endMs) {
    pushCurrentRangeToHistory();
    setFocusedEventKey(null);
    setZoomSelectMode(false);
    setEventSelectMode(false);
    lastScrolledRangeRef.current = null;

    const nextSelection = timeRangeToSelection(startMs, endMs);
    loadChartData(
      buildRangeQuery(
        nextSelection.startDate,
        nextSelection.startTime,
        nextSelection.endDate,
        nextSelection.endTime,
      ),
    );
  }

  function handleZoomBack() {
    if (zoomHistory.length === 0) return;

    const restored = zoomHistory[zoomHistory.length - 1];
    setZoomHistory((history) => history.slice(0, -1));
    setFocusedEventKey(null);
    setZoomSelectMode(false);
    lastScrolledRangeRef.current = null;
    loadChartData(restored);
  }

  const syncScrollMargin = useCallback(() => {
    const header = document.querySelector("header");
    const headerHeight = header?.getBoundingClientRect().height ?? 57;
    const panelHeight = stickyPanelRef.current?.offsetHeight ?? 0;
    document.documentElement.style.setProperty(
      "--co2-list-scroll-margin",
      `${headerHeight + panelHeight + 12}px`,
    );
  }, []);

  const scrollToFirstInRange = useCallback(() => {
    if (!firstInRangeEventKey) return;

    const rangeKey = `${rangeStart}|${rangeEnd}|${firstInRangeEventKey}|${focusedEventKey ?? ""}`;
    if (lastScrolledRangeRef.current === rangeKey) return;
    lastScrolledRangeRef.current = rangeKey;

    requestAnimationFrame(() => {
      syncScrollMargin();
      const el = itemRefs.current.get(firstInRangeEventKey);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [
    firstInRangeEventKey,
    focusedEventKey,
    rangeEnd,
    rangeStart,
    syncScrollMargin,
  ]);

  const updatePinState = useCallback(() => {
    if (!focusedEventKey || !stickyPanelRef.current) {
      setPinSelectedCard(false);
      return;
    }

    const el = itemRefs.current.get(focusedEventKey);
    if (!el) {
      setPinSelectedCard(true);
      return;
    }

    const stickyBottom = stickyPanelRef.current.getBoundingClientRect().bottom;
    const rect = el.getBoundingClientRect();
    const inNaturalSlot =
      rect.top >= stickyBottom - 4 &&
      rect.bottom <= window.innerHeight + 4 &&
      rect.top < window.innerHeight;

    setPinSelectedCard(!inNaturalSlot);
  }, [focusedEventKey]);

  useEffect(() => {
    if (!chartLoading) {
      scrollToFirstInRange();
      requestAnimationFrame(updatePinState);
    }
  }, [chartLoading, scrollToFirstInRange, updatePinState]);

  useEffect(() => {
    lastScrolledRangeRef.current = null;
  }, [focusedEventKey]);

  useEffect(() => {
    updatePinState();
    window.addEventListener("scroll", updatePinState, { passive: true });
    window.addEventListener("resize", updatePinState);

    return () => {
      window.removeEventListener("scroll", updatePinState);
      window.removeEventListener("resize", updatePinState);
    };
  }, [updatePinState, focusedEventKey, timeseries]);

  useEffect(() => {
    if (!stickyPanelRef.current) return undefined;
    const observer = new ResizeObserver(() => {
      syncScrollMargin();
      updatePinState();
    });
    observer.observe(stickyPanelRef.current);
    return () => observer.disconnect();
  }, [syncScrollMargin, updatePinState, focusedEventKey, pinSelectedCard]);

  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return undefined;

    const syncHeaderOffset = () => {
      document.documentElement.style.setProperty(
        "--co2-sticky-top",
        `${header.getBoundingClientRect().height}px`,
      );
      syncScrollMargin();
    };

    syncHeaderOffset();
    const observer = new ResizeObserver(syncHeaderOffset);
    observer.observe(header);
    return () => observer.disconnect();
  }, [syncScrollMargin]);

  const co2Points = useMemo(
    () => timeseries.points?.filter((point) => point.co2Ppm != null) ?? [],
    [timeseries.points],
  );

  const lastCo2Point = co2Points.at(-1) ?? null;
  const rawDisplayPpm = isChartHovering ? hoverPpm : lastCo2Point?.co2Ppm ?? null;
  const displayPpm = normalizeCo2Ppm(rawDisplayPpm);
  const quality = getCo2Quality(displayPpm);

  const timeframeLabel = useMemo(() => {
    if (timeseries.rangeStart && timeseries.rangeEnd) {
      return `${timeseries.rangeStart.slice(0, 10)} – ${timeseries.rangeEnd.slice(0, 10)}`;
    }
    if (displayRangeStart && displayRangeEnd) {
      return formatDateRangeLabel(displayRangeStart, displayRangeEnd);
    }
    return null;
  }, [displayRangeEnd, displayRangeStart, timeseries.rangeEnd, timeseries.rangeStart]);

  const subtitle = hoverTimestamp
    ? `At ${formatIsoDateTimeString(hoverTimestamp)}`
    : lastCo2Point?.timestamp
      ? `Last reading: ${formatIsoDateTimeString(lastCo2Point.timestamp)}`
      : co2CheckedAt
        ? `Last reading: ${co2CheckedAt}`
        : "";

  const showTemperatureOverlays =
    showOutsideOnChart || showReturnOnChart || showComfortOverlay;

  const chartOverlayControls = useMemo(
    () => [
      {
        key: "outside",
        label: "Outside",
        title: "Outside temperature",
        active: showOutsideOnChart,
        onToggle: () => setShowOutsideOnChart((v) => !v),
        color: "bg-sky-400",
      },
      {
        key: "recorded",
        label: "Recorded",
        title: "Recorded (return) temperature",
        active: showReturnOnChart,
        onToggle: () => setShowReturnOnChart((v) => !v),
        color: "bg-violet-400",
      },
      {
        key: "power",
        label: "Power",
        title: "Power draw",
        active: showPowerOverlay,
        onToggle: () => setShowPowerOverlay((v) => !v),
        color: "bg-amber-400",
      },
      {
        key: "comfort",
        label: "Comfort",
        title: "Comfort delta band",
        active: showComfortOverlay,
        onToggle: () => setShowComfortOverlay((v) => !v),
        gradient: "linear-gradient(to bottom, #22c55e, #eab308, #ef4444)",
      },
      {
        key: "events",
        label: "Events",
        title: "Space events",
        active: showEventsOverlay,
        onToggle: () => {
          setShowEventsOverlay((active) => {
            if (active) {
              setEventSelectMode(false);
            }
            return !active;
          });
        },
        color: "bg-emerald-500",
      },
    ],
    [
      showComfortOverlay,
      showEventsOverlay,
      showOutsideOnChart,
      showPowerOverlay,
      showReturnOnChart,
    ],
  );

  function handleHoverPoint(point) {
    setIsChartHovering(true);
    if (point?.timestamp) {
      setHoverTimestamp(point.timestamp);
    } else {
      setHoverTimestamp(null);
    }
    const hoverTime = point?.time ?? parseTimestamp(point?.timestamp);
    setHoverPpm(resolveCo2PpmAtTime(timeseries.points, hoverTime));
  }

  function handleHoverLeave() {
    setIsChartHovering(false);
    setHoverPpm(null);
    setHoverTimestamp(null);
  }

  const hasPrev = focusedIndex > 0;
  const hasNext =
    focusedIndex >= 0 && focusedIndex < chronologicalEvents.length - 1;

  if (chartLoading && timeseries.points.length === 0) {
    return (
      <main className="min-h-screen bg-lb-bg p-8">
        <div className="mb-8 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-[var(--surface-border)] px-4 py-2 text-sm text-lb-text transition-colors hover:border-lb-accent hover:text-lb-accent"
          >
            ← Back to dashboard
          </button>
          <h1 className="gradient-heading text-3xl font-bold">CO₂ Overview</h1>
        </div>
        <LoadingIndicator label="Loading CO₂ data…" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-lb-bg p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-[var(--surface-border)] px-4 py-2 text-sm text-lb-text transition-colors hover:border-lb-accent hover:text-lb-accent"
          >
            ← Back to dashboard
          </button>
          <div>
            <h1 className="gradient-heading text-3xl font-bold">CO₂ Overview</h1>
            {timeframeLabel && (
              <p className="text-sm text-lb-text-muted">{timeframeLabel}</p>
            )}
          </div>
        </div>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Co2LevelCard
          ppm={rawDisplayPpm}
          subtitle={subtitle}
          isHovering={isChartHovering}
          readOnly
        />
        <div
          className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]"
          style={{ boxShadow: "var(--shadow-card), var(--shadow-glow)" }}
        >
          <p className="text-sm text-lb-text-muted">Air quality</p>
          <p className="mt-2 text-2xl font-bold text-lb-heading">
            {Math.round(displayPpm)}{" "}
            <span className="text-lg font-normal text-lb-text-muted">ppm</span>
          </p>
          <p className="mt-2 text-2xl font-bold" style={{ color: quality.color }}>
            {quality.label}
          </p>
          <p className="mt-2 text-sm text-lb-text-muted">{quality.description}</p>
          <p className="mt-3 text-xs text-lb-text-muted/80">
            Event bands are shown by default. Shaded horizontal bands mark air quality
            zones on the chart.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {CO2_QUALITY_ZONES.map((zone) => (
              <span
                key={zone.label}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-[10px] text-lb-text-muted"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: zone.color.replace("0.14", "0.55") }}
                />
                {zone.label} ({zone.min}–{zone.max === 1600 ? "1200+" : zone.max} ppm)
              </span>
            ))}
          </div>
        </div>
      </div>

      {loadError && (
        <p className="mb-4 rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {loadError}
        </p>
      )}

      {!chartLoading && co2Points.length === 0 && !loadError && (
        <p className="mb-4 rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          No CO₂ readings in the loaded timeframe.
        </p>
      )}

      <div
        ref={stickyPanelRef}
        className="sticky top-[var(--co2-sticky-top,57px)] z-40 -mx-8 mb-8 space-y-3 border-b border-[var(--surface-border)] bg-lb-bg/95 px-8 pb-4 backdrop-blur-md"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-lb-text-muted">
            {focusedEvent
              ? `Focused: ${focusedEvent.name}`
              : returnHighlightEvent
                ? `Last viewed: ${returnHighlightEvent.name}`
                : isTimelineSubsection
                  ? "Zoomed timeframe — click an event to focus"
                  : "Click an event on the chart or in the list to focus"}
          </p>
          {(focusedEventKey || isTimelineSubsection) && (
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-lg border border-[var(--surface-border)] px-3 py-1.5 text-xs text-lb-text transition-colors hover:border-lb-accent hover:text-lb-accent"
            >
              Show all events
            </button>
          )}
        </div>

        <div className={chartLoading ? "opacity-60 transition-opacity" : undefined}>
          <TemperatureChart
            chartTitle="CO₂ & environment"
            data={timeseries.points}
            rangeStart={timeseries.rangeStart}
            rangeEnd={timeseries.rangeEnd}
            gaps={timeseries.gaps ?? []}
            events={allEvents}
            showEventsOverlay={showEventsOverlay}
            showEventBandLabels
            showCo2Overlay
            showCo2QualityZones
            hideTemperatureSeries={!showTemperatureOverlays}
            showPowerOverlay={showPowerOverlay}
            showComfortOverlay={showComfortOverlay}
            showOutsideTemp={showOutsideOnChart}
            showReturnTemp={showReturnOnChart}
            weatherPrognosisHorizonDays={weatherPrognosisHorizonDays}
            showForecastTemperatureLines={showTemperatureOverlays}
            currentTimeMarker={forecastReferenceAt ?? referenceAtForActions}
            selectedEventKey={focusedEventKey}
            highlightedEventKey={returnHighlightEventKey}
            onChartPointerMove={handleChartPointerMove}
            onEventClick={
              showEventsOverlay && !zoomSelectMode ? handleChartEventClick : undefined
            }
            zoomSelectMode={zoomSelectMode}
            eventSelectMode={eventSelectMode}
            showEventSelectButton={showEventsOverlay}
            onToggleEventSelectMode={handleToggleEventSelectMode}
            canZoomBack={zoomHistory.length > 0}
            zoomBackSteps={zoomHistory.length}
            onToggleZoomSelectMode={handleToggleZoomSelectMode}
            onZoomBack={handleZoomBack}
            onZoomSelect={handleChartZoomSelect}
            overlayControls={chartOverlayControls}
            onHoverPoint={handleHoverPoint}
            onHoverLeave={handleHoverLeave}
          />
        </div>

        {focusedEventKey && focusedEvent && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => goToAdjacentEvent(-1)}
              disabled={!hasPrev}
              className="rounded-lg border border-[var(--surface-border)] px-3 py-1.5 text-xs text-lb-text transition-colors hover:border-lb-accent hover:text-lb-accent disabled:opacity-30"
              aria-label="Previous event"
            >
              ← Prev
            </button>
            <span className="text-xs text-lb-text-muted">
              {focusedIndex + 1} / {chronologicalEvents.length}
            </span>
            <button
              type="button"
              onClick={() => goToAdjacentEvent(1)}
              disabled={!hasNext}
              className="rounded-lg border border-[var(--surface-border)] px-3 py-1.5 text-xs text-lb-text transition-colors hover:border-lb-accent hover:text-lb-accent disabled:opacity-30"
              aria-label="Next event"
            >
              Next →
            </button>
          </div>
        )}

        {focusedEvent && pinSelectedCard && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => handleEventClick(focusedEvent)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleEventClick(focusedEvent);
              }
            }}
            className={`w-full cursor-pointer rounded-r-lg px-4 py-3 text-left ring-2 ring-lb-accent/70 transition-colors hover:bg-white/5 ${getEventStyle(focusedEvent, focusedEvent.status ?? "historic").row}`}
            aria-pressed
          >
            <EventRowContent
              event={focusedEvent}
              style={getEventStyle(focusedEvent, focusedEvent.status ?? "historic")}
              isFocused
            />
          </div>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-lb-text-muted">
          All events ({chronologicalEvents.length})
        </h2>

        {chronologicalEvents.length === 0 ? (
          <p className="text-lb-text-muted">No events in this dataset.</p>
        ) : (
          <ul className="space-y-2">
            {chronologicalEvents.map((event) => {
              const status = event.status ?? "historic";
              const style = getEventStyle(event, status);
              const key = spaceEventKey(event);
              const isFocused = focusedEventKey === key;
              const isReturnHighlighted = returnHighlightEventKey === key && !isFocused;
              const inTimeline =
                !isTimelineSubsection ||
                eventOverlapsTimeline(event, rangeStart, rangeEnd);

              const rowClassName = [
                style.row,
                "cursor-pointer transition-all duration-200 hover:bg-white/5",
                isFocused ? "ring-2 ring-lb-accent/70" : "",
                isReturnHighlighted ? "ring-2 ring-white/40" : "",
                !inTimeline ? "opacity-35 saturate-50" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <li
                  key={key}
                  ref={(node) => {
                    if (node) itemRefs.current.set(key, node);
                    else itemRefs.current.delete(key);
                  }}
                  className={isFocused && pinSelectedCard ? "invisible" : undefined}
                  aria-hidden={isFocused && pinSelectedCard ? true : undefined}
                  style={{ scrollMarginTop: "var(--co2-list-scroll-margin, 420px)" }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => handleEventClick(event)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleEventClick(event);
                      }
                    }}
                    className={`w-full rounded-r-lg px-4 py-3 text-left ${rowClassName}`}
                    aria-pressed={isFocused}
                  >
                    <EventRowContent
                      event={event}
                      style={style}
                      isFocused={isFocused}
                      showClickHint
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
