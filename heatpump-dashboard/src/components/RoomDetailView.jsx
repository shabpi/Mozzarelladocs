import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildRangeQuery, getTimeseries } from "../api";
import RoomScene from "./Room3D/RoomScene";
import TemperatureChart from "./TemperatureChart";
import {
  resolveSceneTargetTemp,
} from "../utils/targetTempUtils";
import { formatIsoDateTimeString } from "../utils/spaceEventDateUtils";
import {
  findNearestPoint,
  getPointTimestampMs,
  listScrubTimestamps,
  resolveHvacMode,
  tempToColor,
} from "../utils/room3dUtils";
import {
  fetchWeatherForRange,
  getWeatherAtTimestamp,
  resolveMeasuredDataSpan,
} from "../utils/roomWeather";
import { formatLocalTimestamp, parseSpaceEventTime, parseTimestamp, timeRangeToSelection } from "../utils/chartUtils";
import { buildRoomTimelineRangeQuery } from "../utils/eventsUtils";
import { rangeQueryFromTimeseries } from "../utils/eventDetailShared";

const SCENE_PANEL_CLASS = "h-[min(70vh,640px)] min-h-[420px]";

function buildSceneFromPoint(point, defaults, targetInfo) {
  return {
    insideTemp: point?.insideTemp ?? defaults.insideTemp,
    targetTemp: targetInfo.targetTemp,
    targetIsStandby: targetInfo.isStandby,
    returnTemp: point?.returnTemp ?? defaults.returnTemp,
    outsideTemp: point?.outsideTemp ?? defaults.outsideTemp,
    co2Ppm: point?.co2Ppm ?? defaults.co2Ppm,
    powerKw: point?.powerDrawKw ?? defaults.powerKw,
    timestamp: point?.timestamp ?? defaults.timestamp,
    activeEvent: targetInfo.activeEvent,
  };
}

export default function RoomDetailView({
  timeseriesPoints: initialPoints = [],
  rangeStart: initialRangeStart,
  rangeEnd: initialRangeEnd,
  gaps: initialGaps = [],
  spaceEvents = [],
  forecastReferenceAt,
  weatherPrognosisHorizonDays = 7,
  forecastLocation,
  onBack,
}) {
  const [chartData, setChartData] = useState({
    points: initialPoints,
    rangeStart: initialRangeStart,
    rangeEnd: initialRangeEnd,
    gaps: initialGaps,
  });
  const [zoomSelectMode, setZoomSelectMode] = useState(false);
  const [zoomHistory, setZoomHistory] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);

  const chartDataRef = useRef(chartData);
  const timelineBootstrappedRef = useRef(false);

  useEffect(() => {
    chartDataRef.current = chartData;
  }, [chartData]);

  const { points: timeseriesPoints, rangeStart, rangeEnd, gaps } = chartData;

  const scrubEntries = useMemo(
    () => listScrubTimestamps(timeseriesPoints),
    [timeseriesPoints],
  );

  const nowMs = useMemo(() => {
    const fromForecast = getPointTimestampMs({ timestamp: forecastReferenceAt });
    if (fromForecast != null) return fromForecast;
    return scrubEntries.at(-1)?.ms ?? Date.now();
  }, [forecastReferenceAt, scrubEntries]);

  const measuredDataSpan = useMemo(
    () => resolveMeasuredDataSpan(timeseriesPoints, nowMs),
    [timeseriesPoints, nowMs],
  );

  const [selectedMs, setSelectedMs] = useState(nowMs);
  const [weatherMap, setWeatherMap] = useState({});

  useEffect(() => {
    if (!forecastLocation) return undefined;

    let active = true;

    fetchWeatherForRange(
      forecastLocation.latitude,
      forecastLocation.longitude,
      nowMs,
      weatherPrognosisHorizonDays,
      measuredDataSpan.startMs,
      measuredDataSpan.endMs,
      forecastLocation.timezone ?? "Europe/Berlin",
    ).then((map) => {
      if (active) setWeatherMap(map);
    });

    return () => {
      active = false;
    };
  }, [
    forecastLocation,
    measuredDataSpan.endMs,
    measuredDataSpan.startMs,
    nowMs,
    weatherPrognosisHorizonDays,
  ]);

  const loadChartRange = useCallback(
    async (range) => {
      if (!forecastReferenceAt) return;
      setChartLoading(true);
      try {
        const data = await getTimeseries(range, {
          referenceAt: forecastReferenceAt,
          forecastFuture: true,
          latitude: forecastLocation?.latitude,
          longitude: forecastLocation?.longitude,
        });
        setChartData({
          points: data.points ?? [],
          rangeStart: data.rangeStart,
          rangeEnd: data.rangeEnd,
          gaps: data.gaps ?? [],
        });
      } catch (error) {
        console.error(error);
      } finally {
        setChartLoading(false);
      }
    },
    [forecastLocation?.latitude, forecastLocation?.longitude, forecastReferenceAt],
  );

  useEffect(() => {
    if (!forecastReferenceAt || timelineBootstrappedRef.current) return;
    timelineBootstrappedRef.current = true;

    const expandedRange = buildRoomTimelineRangeQuery({
      rangeStart: initialRangeStart,
      rangeEnd: initialRangeEnd,
      events: spaceEvents,
      referenceAt: forecastReferenceAt,
      horizonDays: weatherPrognosisHorizonDays,
    });

    if (Object.keys(expandedRange).length === 0) return;
    loadChartRange(expandedRange);
  }, [
    forecastReferenceAt,
    initialRangeEnd,
    initialRangeStart,
    loadChartRange,
    spaceEvents,
    weatherPrognosisHorizonDays,
  ]);

  useEffect(() => {
    const refMs = getPointTimestampMs({ timestamp: forecastReferenceAt });
    if (refMs != null) setSelectedMs(refMs);
  }, [forecastReferenceAt]);

  const pushCurrentRangeToHistory = useCallback(() => {
    setZoomHistory((history) => [
      ...history,
      rangeQueryFromTimeseries(chartDataRef.current),
    ]);
  }, []);

  const handleToggleZoomSelectMode = useCallback(() => {
    setZoomSelectMode((open) => !open);
  }, []);

  const handleChartZoomSelect = useCallback(
    (startMs, endMs) => {
      pushCurrentRangeToHistory();
      setZoomSelectMode(false);

      const nextSelection = timeRangeToSelection(startMs, endMs);
      loadChartRange(
        buildRangeQuery(
          nextSelection.startDate,
          nextSelection.startTime,
          nextSelection.endDate,
          nextSelection.endTime,
        ),
      );
    },
    [loadChartRange, pushCurrentRangeToHistory],
  );

  const handleZoomBack = useCallback(() => {
    setZoomHistory((history) => {
      if (history.length === 0) return history;
      const restored = history[history.length - 1];
      setZoomSelectMode(false);
      loadChartRange(restored);
      return history.slice(0, -1);
    });
  }, [loadChartRange]);

  const selectedPoint = useMemo(
    () => findNearestPoint(timeseriesPoints, selectedMs),
    [timeseriesPoints, selectedMs],
  );

  const scrubTimestamp = useMemo(
    () => formatLocalTimestamp(selectedMs),
    [selectedMs],
  );

  const lastPoint = timeseriesPoints.at(-1);
  const defaults = {
    insideTemp: lastPoint?.insideTemp ?? 20,
    targetTemp: lastPoint?.targetTemp ?? 21,
    returnTemp: lastPoint?.returnTemp ?? 18,
    outsideTemp: lastPoint?.outsideTemp ?? 5,
    co2Ppm: lastPoint?.co2Ppm ?? null,
    powerKw: lastPoint?.powerDrawKw ?? 0,
    timestamp: lastPoint?.timestamp ?? forecastReferenceAt,
  };

  const targetInfo = resolveSceneTargetTemp({
    point: selectedPoint,
    outsideTemp: selectedPoint?.outsideTemp ?? defaults.outsideTemp,
    timestamp: scrubTimestamp,
    events: spaceEvents,
    referenceAtMs: nowMs,
  });

  const scene = buildSceneFromPoint(selectedPoint, defaults, targetInfo);
  const eventActive = Boolean(scene.activeEvent);
  const weather = getWeatherAtTimestamp(
    weatherMap,
    selectedMs,
    forecastLocation?.timezone ?? "Europe/Berlin",
    nowMs,
    measuredDataSpan.startMs,
    measuredDataSpan.endMs,
    weatherPrognosisHorizonDays,
  );
  const hvacMode = resolveHvacMode(scene);
  const comfortColor = tempToColor(scene.insideTemp, scene.targetTemp);

  const timestampLabel = scene.timestamp
    ? formatIsoDateTimeString(scene.timestamp)
    : "No timestamp";

  const isAtNow = Math.abs(selectedMs - nowMs) < 60_000;
  const scrubTimeMarker = useMemo(
    () => formatLocalTimestamp(selectedMs),
    [selectedMs],
  );

  const handleChartScrub = useCallback((point) => {
    if (!point || zoomSelectMode) return;
    const ms =
      point.time ??
      (point.timestamp ? parseTimestamp(point.timestamp) : null);
    if (ms == null || Number.isNaN(ms)) return;
    setSelectedMs(ms);
  }, [zoomSelectMode]);

  const handleEventClick = useCallback((event) => {
    const startMs = parseSpaceEventTime(event.startsAt);
    const endMs = parseSpaceEventTime(event.endsAt);
    if (Number.isNaN(startMs)) return;
    const targetMs = Number.isNaN(endMs)
      ? startMs
      : Math.round((startMs + endMs) / 2);
    setSelectedMs(targetMs);
  }, []);

  const hasTimeline = timeseriesPoints.length > 0 && rangeStart && rangeEnd;

  return (
    <main className="min-h-screen bg-lb-bg p-8">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-[var(--surface-border)] px-4 py-2 text-sm text-lb-text transition-colors hover:border-lb-accent hover:text-lb-accent"
        >
          ← Back to dashboard
        </button>
        <div>
          <h1 className="gradient-heading text-3xl font-bold">3D Space View</h1>
          <p className="text-sm text-lb-text-muted">
            {forecastLocation?.label ?? "Munich"} · scrub the timeline to explore HVAC, weather, and occupancy
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_16rem] xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <RoomScene
            className={`${SCENE_PANEL_CLASS} w-full`}
            insideTemp={scene.insideTemp}
            targetTemp={scene.targetTemp}
            returnTemp={scene.returnTemp}
            outsideTemp={scene.outsideTemp}
            co2Ppm={scene.co2Ppm}
            powerKw={scene.powerKw}
            weather={weather}
            eventActive={eventActive}
            eventName={scene.activeEvent?.name}
            targetIsStandby={scene.targetIsStandby}
            hvacMode={hvacMode}
          />

          <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-lb-heading">{timestampLabel}</p>
                <p className="text-xs text-lb-text-muted">
                  Weather: {weather.isDay ? "day" : "night"} · {weather.condition}
                  {chartLoading ? " · loading chart…" : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleZoomSelectMode}
                  disabled={!hasTimeline}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    zoomSelectMode
                      ? "border-sky-400 bg-sky-500/20 text-sky-200"
                      : "border-[var(--surface-border)] text-lb-text hover:border-lb-accent hover:text-lb-accent"
                  } ${!hasTimeline ? "cursor-not-allowed opacity-40" : ""}`}
                  aria-pressed={zoomSelectMode}
                >
                  {zoomSelectMode ? "Cancel select" : "Select to zoom"}
                </button>
                {zoomHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={handleZoomBack}
                    className="rounded-lg border border-[var(--surface-border)] px-3 py-1.5 text-sm text-lb-text transition-colors hover:border-lb-accent hover:text-lb-accent"
                  >
                    ← Back{zoomHistory.length > 1 ? ` (${zoomHistory.length})` : ""}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedMs(nowMs)}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    isAtNow
                      ? "border-lb-accent bg-lb-accent/15 text-lb-accent"
                      : "border-[var(--surface-border)] text-lb-text hover:border-lb-accent hover:text-lb-accent"
                  }`}
                >
                  Now
                </button>
              </div>
            </div>

            {zoomSelectMode && (
              <p className="mb-2 text-xs text-sky-300/90">
                Drag across the chart to zoom into a time range. Minimum selection is 15 minutes.
              </p>
            )}

            {hasTimeline ? (
              <TemperatureChart
                compact
                embedded
                data={timeseriesPoints}
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                gaps={gaps}
                events={spaceEvents}
                showEventsOverlay
                showForecastTemperatureLines
                showOutsideTemp
                showPowerOverlay
                powerSeriesAsLine
                powerLineOpacity={0.32}
                hideZoomControls
                zoomSelectMode={zoomSelectMode}
                onZoomSelect={handleChartZoomSelect}
                weatherPrognosisHorizonDays={weatherPrognosisHorizonDays}
                currentTimeMarker={forecastReferenceAt}
                currentTimeLabel="Now"
                scrubTimeMarker={scrubTimeMarker}
                scrubTimeLabel="Viewing"
                onHoverPoint={handleChartScrub}
                onEventClick={handleEventClick}
                showEventBandLabels
              />
            ) : (
              <p className="text-xs text-lb-text-muted">Loading timeline…</p>
            )}
          </div>
        </div>

        <aside className={`${SCENE_PANEL_CLASS} shrink-0`}>
          <div className="space-y-4">
            <div
              className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]"
              style={{ boxShadow: "var(--shadow-card), var(--shadow-glow)" }}
            >
              <p className="text-sm text-lb-text-muted">Room sensor</p>
              <p className="mt-2 text-3xl font-bold" style={{ color: comfortColor }}>
                {scene.insideTemp?.toFixed(1) ?? "—"}°C
              </p>
              <p className="mt-1 text-sm text-lb-text-muted">
                Target {scene.targetTemp?.toFixed(1) ?? "—"}°C
                {scene.targetIsStandby ? " · energy-saving standby" : ""}
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5">
              <p className="text-sm text-lb-text-muted">Vent loop</p>
              <p className="mt-2 text-lg font-semibold text-orange-300">
                Return {scene.returnTemp?.toFixed(1) ?? "—"}°C
              </p>
              <p className="mt-1 text-sm text-lb-text-muted capitalize">Mode: {hvacMode}</p>
            </div>

            <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5">
              <p className="text-sm text-lb-text-muted">Outside</p>
              <p className="mt-2 text-lg font-semibold text-sky-200">
                {scene.outsideTemp?.toFixed(1) ?? "—"}°C
              </p>
              <p className="mt-1 text-sm text-lb-text-muted capitalize">
                {weather.isDay ? "Daylight" : "Night"} · {weather.condition}
              </p>
            </div>

            <div className="space-y-3 text-xs leading-relaxed text-lb-text-muted">
              <p>
                Orange airflow = heating, blue = cooling — particles spread radially from each ceiling
                vent as they fall. CO₂ cloud grows and shifts color as ppm rises. People appear in
                seats during scheduled events.
              </p>
              <p>
                The colored panel on the left wall (opposite the viewing opening) is a comfort
                heatmap: green when inside temperature matches target, blue when too cold, red when
                too warm. It sits flush on the interior left wall, facing into the room.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
