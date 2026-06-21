import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TemperatureChart from "./TemperatureChart";
import { buildRangeQuery, deleteSpaceEvent, getSpaceEvents, getTimeseries } from "../api";
import { useForecastLocation } from "../hooks/useForecastBootstrap";
import ForecastLocationModal from "./ForecastLocationModal";
import {
  parseRangeBoundary,
  spaceEventKey,
  timeRangeToSelection,
} from "../utils/chartUtils";
import { eventsToFullRangeQuery } from "../utils/eventsUtils";
import {
  formatDateDdMmYyyy,
  formatIsoDateTimeString,
  formatTimeHhMm,
  fromApiDateTime,
} from "../utils/spaceEventDateUtils";
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

export { spaceEventKey as eventKey };

export default function EventsDetailView({
  referenceAt,
  forecastReferenceAt,
  referenceAtForActions,
  weatherPrognosisHorizonDays = 10,
  onBack,
  onAddEvent,
  onEditEvent,
  onEventsChanged,
  onRegisterRefresh,
}) {
  const [allEvents, setAllEvents] = useState([]);
  const [localTimeseries, setLocalTimeseries] = useState(EMPTY_TIMESERIES);
  const [chartLoading, setChartLoading] = useState(true);
  const [focusedEventKey, setFocusedEventKey] = useState(null);
  const [pinSelectedCard, setPinSelectedCard] = useState(false);
  const [zoomSelectMode, setZoomSelectMode] = useState(false);
  const [zoomHistory, setZoomHistory] = useState([]);
  const [showPowerOverlay, setShowPowerOverlay] = useState(false);
  const [showComfortOverlay, setShowComfortOverlay] = useState(false);
  const [showCo2Overlay, setShowCo2Overlay] = useState(false);
  const [showOutsideOnChart, setShowOutsideOnChart] = useState(true);
  const [showReturnOnChart, setShowReturnOnChart] = useState(false);
  const [returnHighlightEventKey, setReturnHighlightEventKey] = useState(null);
  const [localForecastReferenceAt, setLocalForecastReferenceAt] = useState(
    forecastReferenceAt ?? null,
  );
  const [forecastUpdating, setForecastUpdating] = useState(false);
  const forecastLocation = useForecastLocation();
  const [showForecastLocationModal, setShowForecastLocationModal] = useState(false);
  const [weatherSource, setWeatherSource] = useState(null);
  const prevFocusedEventKeyRef = useRef(null);
  const stickyPanelRef = useRef(null);
  const itemRefs = useRef(new Map());
  const lastScrolledRangeRef = useRef(null);
  const localTimeseriesRef = useRef(EMPTY_TIMESERIES);

  useEffect(() => {
    localTimeseriesRef.current = localTimeseries;
  }, [localTimeseries]);

  const loadChartData = useCallback(
    async (range = {}) => {
      setChartLoading(true);
      try {
        const data = await getTimeseries(range, {
          referenceAt: referenceAtForActions,
          forecastFuture: true,
          latitude: forecastLocation.latitude,
          longitude: forecastLocation.longitude,
        });
        setLocalTimeseries(data);
        if (data.forecastReferenceAt) {
          setLocalForecastReferenceAt(data.forecastReferenceAt);
        }
        if (data.weatherSource) {
          setWeatherSource(data.weatherSource);
        }
      } catch (error) {
        console.error(error);
      } finally {
        setChartLoading(false);
      }
    },
    [forecastLocation, referenceAtForActions],
  );

  const refreshAllEvents = useCallback(async () => {
    try {
      const data = await getSpaceEvents(referenceAtForActions, {}, {
        latitude: forecastLocation.latitude,
        longitude: forecastLocation.longitude,
      });
      setAllEvents(data);
      return data;
    } catch (error) {
      console.error(error);
      return [];
    }
  }, [forecastLocation, referenceAtForActions]);

  const loadFullEventTimeline = useCallback(async () => {
    const events = await refreshAllEvents();
    await loadChartData(eventsToFullRangeQuery(events));
  }, [loadChartData, refreshAllEvents]);

  const reloadEventsAndChart = useCallback(async () => {
    const events = await refreshAllEvents();
    const currentRange = rangeQueryFromTimeseries(localTimeseriesRef.current);
    const rangeQuery =
      currentRange.start || currentRange.end
        ? currentRange
        : eventsToFullRangeQuery(events);
    await loadChartData(rangeQuery);
    return events;
  }, [loadChartData, refreshAllEvents]);

  useEffect(() => {
    onRegisterRefresh?.(reloadEventsAndChart);
    return () => onRegisterRefresh?.(null);
  }, [onRegisterRefresh, reloadEventsAndChart]);

  useEffect(() => {
    if (!referenceAtForActions) return;
    loadFullEventTimeline();
  }, [forecastLocation, loadFullEventTimeline, referenceAtForActions]);

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

  const { rangeStart, rangeEnd } = localTimeseries;
  const isTimelineSubsection = zoomHistory.length > 0 || Boolean(focusedEventKey);

  const firstInRangeEventKey = useMemo(() => {
    if (!isTimelineSubsection || !rangeStart || !rangeEnd) return null;
    const first = chronologicalEvents.find((event) =>
      eventOverlapsTimeline(event, rangeStart, rangeEnd),
    );
    return first ? spaceEventKey(first) : null;
  }, [chronologicalEvents, isTimelineSubsection, rangeEnd, rangeStart]);

  const pushCurrentRangeToHistory = useCallback(() => {
    const snapshot = rangeQueryFromTimeseries(localTimeseriesRef.current);
    setZoomHistory((history) => [...history, snapshot]);
  }, []);

  const clearSelection = useCallback(async () => {
    setFocusedEventKey(null);
    setPinSelectedCard(false);
    setZoomSelectMode(false);
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

  function handleChartZoomSelect(startMs, endMs) {
    pushCurrentRangeToHistory();
    setFocusedEventKey(null);
    setZoomSelectMode(false);
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
      "--events-list-scroll-margin",
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
  }, [updatePinState, focusedEventKey, localTimeseries]);

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
        "--events-sticky-top",
        `${header.getBoundingClientRect().height}px`,
      );
      syncScrollMargin();
    };

    syncHeaderOffset();
    const observer = new ResizeObserver(syncHeaderOffset);
    observer.observe(header);
    return () => observer.disconnect();
  }, [syncScrollMargin]);

  async function handleUpdateForecast() {
    setForecastUpdating(true);
    try {
      const range = rangeQueryFromTimeseries(localTimeseriesRef.current);
      await Promise.all([loadChartData(range), refreshAllEvents()]);
    } finally {
      setForecastUpdating(false);
    }
  }

  async function handleForecastLocationSave(nextLocation) {
    setForecastLocation(nextLocation);
  }

  async function handleEventsChanged() {
    await reloadEventsAndChart();
    await onEventsChanged?.();
  }

  const hasPrev = focusedIndex > 0;
  const hasNext =
    focusedIndex >= 0 && focusedIndex < chronologicalEvents.length - 1;

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
        key: "co2",
        label: "CO₂",
        title: "Indoor CO₂ level",
        active: showCo2Overlay,
        onToggle: () => setShowCo2Overlay((v) => !v),
        color: "bg-emerald-400",
      },
    ],
    [
      showCo2Overlay,
      showComfortOverlay,
      showOutsideOnChart,
      showPowerOverlay,
      showReturnOnChart,
    ],
  );

  return (
    <>
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
            <h1 className="gradient-heading text-3xl font-bold">Space Events</h1>
            <p className="text-sm text-lb-text-muted">
              Dataset reference: {formatIsoDateTimeString(referenceAt)}
            </p>
            {localForecastReferenceAt && localForecastReferenceAt !== referenceAt && (
              <p className="text-sm text-lb-text-muted">
                Forecast from: {formatIsoDateTimeString(localForecastReferenceAt)} (
                {weatherPrognosisHorizonDays}-day outlook
                {weatherSource === "open_meteo" ? `, ${forecastLocation.label}` : ""})
              </p>
            )}
            <p className="text-sm text-lb-text-muted">
              Weather location: {forecastLocation.label}
            </p>
          </div>
        </div>
        {onAddEvent && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowForecastLocationModal(true)}
              className="rounded-lg border border-sky-400/50 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-200 transition-colors hover:border-sky-300 hover:bg-sky-500/20"
            >
              Set forecast location
            </button>
            <button
              type="button"
              onClick={onAddEvent}
              className="rounded-lg bg-lb-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              + Add event
            </button>
          </div>
        )}
      </div>

      <div
        ref={stickyPanelRef}
        className="sticky top-[var(--events-sticky-top,57px)] z-40 -mx-8 mb-8 space-y-3 border-b border-[var(--surface-border)] bg-lb-bg/95 px-8 pb-4 backdrop-blur-md"
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
            data={localTimeseries.points}
            rangeStart={localTimeseries.rangeStart}
            rangeEnd={localTimeseries.rangeEnd}
            gaps={localTimeseries.gaps ?? []}
            events={allEvents}
            showEventsOverlay
            showPowerOverlay={showPowerOverlay}
            showComfortOverlay={showComfortOverlay}
            showCo2Overlay={showCo2Overlay}
            showOutsideTemp={showOutsideOnChart}
            showReturnTemp={showReturnOnChart}
            weatherPrognosisHorizonDays={weatherPrognosisHorizonDays}
            showForecastTemperatureLines
            showEventBandLabels
            selectedEventKey={focusedEventKey}
            highlightedEventKey={returnHighlightEventKey}
            showEventBandLabels
            onChartPointerMove={handleChartPointerMove}
            onEventClick={handleChartEventClick}
            zoomSelectMode={zoomSelectMode}
            canZoomBack={zoomHistory.length > 0}
            zoomBackSteps={zoomHistory.length}
            onToggleZoomSelectMode={handleToggleZoomSelectMode}
            onZoomBack={handleZoomBack}
            onZoomSelect={handleChartZoomSelect}
            overlayControls={chartOverlayControls}
            onUpdateForecast={handleUpdateForecast}
            updatingForecast={forecastUpdating}
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
            className={`w-full cursor-pointer rounded-r-lg px-4 py-3 text-left ring-2 ring-lb-accent/70 transition-colors hover:bg-white/5 ${getEventStyle(focusedEvent, focusedEvent.status).row}`}
            aria-pressed
          >
            <EventRowContent
              event={focusedEvent}
              style={getEventStyle(focusedEvent, focusedEvent.status)}
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
              const canModify =
                event.custom &&
                event.status === "future" &&
                Boolean(onEventsChanged);

              async function handleDelete() {
                if (!canModify || !event.id) return;
                if (!window.confirm(`Delete "${event.name}"?`)) return;
                await deleteSpaceEvent(event.id, referenceAtForActions);
                if (focusedEventKey === key) clearSelection();
                await handleEventsChanged();
              }

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
                  style={{ scrollMarginTop: "var(--events-list-scroll-margin, 420px)" }}
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
                      canModify={canModify}
                      onEditEvent={onEditEvent}
                      onDelete={handleDelete}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
    <ForecastLocationModal
      open={showForecastLocationModal}
      currentLocation={forecastLocation}
      onClose={() => setShowForecastLocationModal(false)}
      onSave={handleForecastLocationSave}
    />
    </>
  );
}

export {
  EventRowContent,
  eventOverlapsTimeline,
  eventToRangeQuery,
  getEventStyle,
  rangeQueryFromTimeseries,
} from "../utils/eventDetailShared";
