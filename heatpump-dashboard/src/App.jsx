import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildRangeQuery, createSpaceEvent, getOverview, getSpaceEvents, getTimeseries, updateSpaceEvent } from "./api";
import {
  formatDateRangeLabel,
  formatDisplayRangeText,
  formatIsoDateTimeString,
  formatSelectionRangeLabel,
} from "./utils/spaceEventDateUtils";
import {
  COMFORT_TOLERANCE_C,
  cloneSelection,
  hasCo2SeriesData,
  isEventActiveAt,
  parseTimestamp,
  resolveForecastReferenceMs,
  spaceEventKey,
  timeRangeToSelection,
} from "./utils/chartUtils";
import {
  buildInitialDashboardRangeQuery,
  rangeQueryToSelection,
} from "./utils/eventsUtils";
import { resolveCo2PpmAtTime } from "./utils/co2Utils";
import { useForecastBootstrap } from "./hooks/useForecastBootstrap";
import {
  DEFAULT_DASHBOARD_FORECAST_HOURS,
  DASHBOARD_FORECAST_HOUR_OPTIONS,
  FORECAST_PREDICTION_MODELS,
  buildShortTermForecastRangeQuery,
  buildDummyHistoryUntilNow,
  cycleForecastDummyMode,
  findShortTermForecastSlot,
  forecastDummyModeLabel,
  FORECAST_DUMMY_MODES,
  isForecastDummyActive,
  isAfterForecastReference,
  annotateHistoricOperationModes,
  clipMeasuredTempsAfterReference,
  mergeDummyHistoryIntoPoints,
  mergeShortTermForecastIntoPoints,
  shouldAutoEnableForecastDummyHistory,
} from "./utils/shortTermForecastUtils";
import { useShortTermForecast } from "./hooks/useShortTermForecast";
import { buildTemperatureBarValues } from "./utils/temperatureDisplayUtils";
import Co2DetailView from "./components/Co2DetailView";
import Co2LevelCard from "./components/Co2LevelCard";
import ComfortMaintainedCard from "./components/ComfortMaintainedCard";
import EnergyDrawCard from "./components/EnergyDrawCard";
import EnergyDetailView from "./components/EnergyDetailView";
import EventStatusCard from "./components/EventStatusCard";
import EventsDetailView from "./components/EventsDetailView";
import LoadingIndicator from "./components/LoadingIndicator";
import RangeReminder from "./components/RangeReminder";
import ForecastHorizonKnob from "./components/ForecastHorizonKnob";
import TemperatureBarsCard from "./components/TemperatureBarsCard";
import TemperatureChart from "./components/TemperatureChart";
import TimeframeCalendar from "./components/TimeframeCalendar";
import SiteHeader from "./components/SiteHeader";
import SpaceEventModal from "./components/SpaceEventModal";

const RoomDetailView = lazy(() => import("./components/RoomDetailView"));

const EMPTY_SELECTION = {
  startDate: null,
  endDate: null,
  startTime: "00:00",
  endTime: "23:59",
};

export default function App() {
  const [view, setView] = useState("dashboard");
  const [overview, setOverview] = useState(null);
  const [timeseries, setTimeseries] = useState({
    points: [],
    powerPoints: [],
    rangeStart: null,
    rangeEnd: null,
    gaps: [],
  });
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [loading, setLoading] = useState(true);
  const [spaceEvents, setSpaceEvents] = useState([]);
  const [showEventsOverlay, setShowEventsOverlay] = useState(false);
  const [showPowerOverlay, setShowPowerOverlay] = useState(false);
  const [showComfortOverlay, setShowComfortOverlay] = useState(false);
  const [showCo2Overlay, setShowCo2Overlay] = useState(false);
  const [showOutsideOnChart, setShowOutsideOnChart] = useState(false);
  const [showReturnOnChart, setShowReturnOnChart] = useState(false);
  const [chartHover, setChartHover] = useState({ active: false, point: null });
  const [zoomSelectMode, setZoomSelectMode] = useState(false);
  const [eventSelectMode, setEventSelectMode] = useState(false);
  const [selectedDashboardEventKey, setSelectedDashboardEventKey] = useState(null);
  const [zoomHistory, setZoomHistory] = useState([]);
  const [showAddEventModal, setShowAddEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const refreshEventsDetailRef = useRef(null);

  const eventsReferenceAt =
    overview?.forecastReferenceAt ?? overview?.eventCheckedAt ?? null;
  const [savingEvent, setSavingEvent] = useState(false);
  const [shortTermForecastActive, setShortTermForecastActive] = useState(false);
  const [shortTermForecastHours, setShortTermForecastHours] = useState(
    DEFAULT_DASHBOARD_FORECAST_HOURS,
  );
  const [forecastLookbackHours, setForecastLookbackHours] = useState(0);
  const [forecastChartForwardHours, setForecastChartForwardHours] = useState(
    DEFAULT_DASHBOARD_FORECAST_HOURS,
  );
  const [forecastEnterPending, setForecastEnterPending] = useState(false);
  const [forecastDummyMode, setForecastDummyMode] = useState(FORECAST_DUMMY_MODES.off);
  const [forecastPredictionModel, setForecastPredictionModel] = useState("simple");
  const { forecastLocation, nowMarkerLabel } = useForecastBootstrap();

  const {
    data: shortTermForecastData,
    loading: shortTermForecastLoading,
    lastFetchedAt: shortTermForecastFetchedAt,
  } = useShortTermForecast({
    hours: shortTermForecastHours,
    model: forecastPredictionModel,
    dummyPreset: forecastDummyMode,
    referenceAt: overview?.forecastReferenceAt,
    latitude: forecastLocation.latitude,
    longitude: forecastLocation.longitude,
    enabled: shortTermForecastActive && view === "dashboard",
  });

  const forecastReferenceAt =
    timeseries.forecastReferenceAt ?? overview?.forecastReferenceAt ?? null;

  function openAddEventModal() {
    setEditingEvent(null);
    setShowAddEventModal(true);
  }

  function openEditEventModal(event) {
    setEditingEvent(event);
    setShowAddEventModal(true);
  }

  function closeEventModal() {
    setShowAddEventModal(false);
    setEditingEvent(null);
  }

  const lastDataPointInRange = useMemo(() => {
    const points = timeseries.points ?? [];
    const measured = points.filter((point) => point.insideTemp != null);
    if (measured.length) return measured.at(-1);

    const forecastOrTarget = points.filter(
      (point) => point.outsideTemp != null || point.targetTemp != null,
    );
    return forecastOrTarget[0] ?? forecastOrTarget.at(-1) ?? null;
  }, [timeseries.points]);

  const chartRange = useMemo(() => {
    if (selection.startDate && selection.endDate) {
      return {
        start: `${selection.startDate} ${selection.startTime}:00`,
        end: `${selection.endDate} ${selection.endTime}:59`,
      };
    }
    return {
      start: timeseries.rangeStart,
      end: timeseries.rangeEnd,
    };
  }, [selection, timeseries.rangeEnd, timeseries.rangeStart]);

  const selectedTimeframeLabel = useMemo(() => {
    if (!overview) return null;
    if (selection.startDate && selection.endDate) {
      return formatSelectionRangeLabel(
        selection.startDate,
        selection.startTime,
        selection.endDate,
        selection.endTime,
      );
    }
    if (selection.startDate) {
      return formatSelectionRangeLabel(
        selection.startDate,
        selection.startTime,
        null,
        selection.endTime,
      );
    }
    if (shortTermForecastActive) {
      const lookbackLabel =
        forecastLookbackHours > 0 ? `${forecastLookbackHours} h back · ` : "";
      const viewLabel =
        forecastChartForwardHours !== shortTermForecastHours
          ? `view +${forecastChartForwardHours} h · predict ${shortTermForecastHours} h`
          : `predict ${shortTermForecastHours} h`;
      return `Short-term forecast · ${lookbackLabel}${viewLabel}`;
    }
    return formatDateRangeLabel(
      overview.displayRangeStart,
      overview.displayRangeEnd,
    );
  }, [
    overview,
    selection.endDate,
    selection.endTime,
    selection.startDate,
    selection.startTime,
    shortTermForecastActive,
    shortTermForecastHours,
    forecastLookbackHours,
    forecastChartForwardHours,
  ]);

  const hoverPoint = chartHover.active ? chartHover.point : lastDataPointInRange;

  const dashboardChartPoints = useMemo(() => {
    let points = timeseries.points ?? [];

    if (shortTermForecastActive && isForecastDummyActive(forecastDummyMode)) {
      const referenceAt =
        shortTermForecastData?.referenceAt ?? forecastReferenceAt ?? null;
      const referenceMs = referenceAt
        ? resolveForecastReferenceMs(referenceAt)
        : Date.now();
      const rangeStartMs = chartRange.start
        ? parseTimestamp(chartRange.start)
        : referenceMs - forecastLookbackHours * 60 * 60 * 1000;
      const forecastOutside =
        shortTermForecastData?.slots?.[0]?.outsideTempC ??
        overview?.temperatureStatus?.outsideC ??
        14;
      const dummyPoints = buildDummyHistoryUntilNow({
        rangeStartMs,
        referenceMs,
        preset: forecastDummyMode,
        startingInsideTempC:
          shortTermForecastData?.startingInsideTempC ??
          overview?.temperatureStatus?.insideC ??
          20,
        startingOutsideTempC:
          forecastDummyMode === FORECAST_DUMMY_MODES.cooling
            ? Math.max(forecastOutside, 26)
            : forecastOutside,
        targetTempC:
          shortTermForecastData?.slots?.[0]?.targetTempC ?? 21,
      });
      points = mergeDummyHistoryIntoPoints(points, dummyPoints, referenceMs);
    }

    if (shortTermForecastActive) {
      const referenceAt =
        shortTermForecastData?.referenceAt ?? forecastReferenceAt ?? null;
      points = clipMeasuredTempsAfterReference(points, referenceAt);
      const rangeStartMs = chartRange.start
        ? parseTimestamp(chartRange.start)
        : null;
      points = annotateHistoricOperationModes(points, referenceAt, rangeStartMs);
    }

    if (shortTermForecastActive && shortTermForecastData?.slots?.length) {
      return mergeShortTermForecastIntoPoints(
        points,
        shortTermForecastData.slots,
        shortTermForecastData.referenceAt ?? forecastReferenceAt,
      );
    }

    return points;
  }, [
    chartRange.start,
    forecastDummyMode,
    forecastLookbackHours,
    forecastReferenceAt,
    overview?.temperatureStatus?.insideC,
    overview?.temperatureStatus?.outsideC,
    shortTermForecastActive,
    shortTermForecastData,
    shortTermForecastHours,
    timeseries.points,
  ]);

  const temperatureBarValues = useMemo(() => {
    const base = buildTemperatureBarValues({
      point: hoverPoint,
      allPoints: dashboardChartPoints,
      events: spaceEvents,
      currentTimeMarker: forecastReferenceAt,
      eventsOnlyTarget: shortTermForecastActive,
    });

    const referenceAt =
      shortTermForecastData?.referenceAt ?? forecastReferenceAt ?? null;
    const hoverTime =
      hoverPoint?.time ?? (hoverPoint?.timestamp ? parseTimestamp(hoverPoint.timestamp) : null);
    const slot = findShortTermForecastSlot(shortTermForecastData?.slots, hoverTime);

    if (
      shortTermForecastActive &&
      chartHover.active &&
      slot &&
      isAfterForecastReference(hoverTime, referenceAt)
    ) {
      return {
        ...(base ?? {}),
        insideC: slot.insideTempC,
        insideIsForecast: true,
        outsideC: slot.outsideTempC ?? base?.outsideC ?? null,
        operationMode: slot.operationMode,
        timestamp: slot.timestamp,
      };
    }

    if (
      shortTermForecastActive &&
      chartHover.active &&
      hoverPoint?.operationMode
    ) {
      return {
        ...(base ?? {}),
        operationMode: hoverPoint.operationMode,
      };
    }

    if (
      shortTermForecastActive &&
      !chartHover.active &&
      shortTermForecastData?.startingInsideTempC != null
    ) {
      return {
        ...(base ?? {}),
        insideC: shortTermForecastData.startingInsideTempC,
        insideIsForecast: false,
        timestamp: shortTermForecastData.referenceAt ?? referenceAt,
      };
    }

    return base;
  }, [
    chartHover.active,
    dashboardChartPoints,
    forecastReferenceAt,
    hoverPoint,
    shortTermForecastActive,
    shortTermForecastData,
    spaceEvents,
  ]);

  const energyCardProps = useMemo(() => {
    if (chartHover.active && hoverPoint?.powerDrawKw != null) {
      return {
        value: hoverPoint.powerDrawKw,
        unit: "kW",
        subtitle: `At ${formatIsoDateTimeString(hoverPoint.timestamp)}`,
        isHovering: true,
      };
    }
    return {
      value: overview?.energyDrawKwh ?? 0,
      unit: "kWh",
      subtitle: overview
        ? `Total on ${formatDisplayRangeText(overview.energyDrawLabel)}`
        : "",
      isHovering: false,
    };
  }, [chartHover.active, hoverPoint, overview]);

  const comfortCardProps = useMemo(() => {
    if (
      chartHover.active &&
      (hoverPoint?.insideTemp != null || hoverPoint?.insideTempPredicted != null) &&
      hoverPoint?.targetTemp != null
    ) {
      const insideValue = hoverPoint.insideTempPredicted ?? hoverPoint.insideTemp;
      const delta = Math.abs(insideValue - hoverPoint.targetTemp);
      const within = delta <= COMFORT_TOLERANCE_C;
      return {
        value: delta.toFixed(1),
        unit: "°C Δ",
        subtitle: within ? "Within comfort band" : "Outside comfort band",
        isHovering: true,
      };
    }
    return {
      value: overview?.comfortMaintainedPercent ?? 0,
      unit: "%",
      subtitle: "Within target range",
      isHovering: false,
    };
  }, [chartHover.active, hoverPoint, overview]);

  const eventCardProps = useMemo(() => {
    if (chartHover.active && hoverPoint?.timestamp) {
      const active = isEventActiveAt(spaceEvents, hoverPoint.timestamp);
      return {
        active,
        subtitle: `At ${formatIsoDateTimeString(hoverPoint.timestamp)}`,
        isHovering: true,
      };
    }
    return {
      active: isEventActiveAt(
        spaceEvents,
        forecastReferenceAt ?? overview?.eventCheckedAt,
      ),
      subtitle: overview
        ? `Checked at ${formatIsoDateTimeString(forecastReferenceAt ?? overview.eventCheckedAt)}`
        : "",
      isHovering: false,
    };
  }, [chartHover.active, forecastReferenceAt, hoverPoint, overview, spaceEvents]);

  const hasCo2InRange = useMemo(
    () => hasCo2SeriesData(timeseries.points),
    [timeseries.points],
  );

  const co2CardProps = useMemo(() => {
    if (chartHover.active && hoverPoint) {
      const hoverTime =
        hoverPoint.time ?? parseTimestamp(hoverPoint.timestamp);
      const referenceAt =
        shortTermForecastData?.referenceAt ?? forecastReferenceAt ?? null;
      const isFutureForecastHover =
        shortTermForecastActive &&
        referenceAt &&
        isAfterForecastReference(hoverTime, referenceAt);

      if (isFutureForecastHover) {
        return {
          ppm: null,
          subtitle: hoverPoint.timestamp
            ? `At ${formatIsoDateTimeString(hoverPoint.timestamp)} · no CO₂ forecast`
            : "Future · no CO₂ data",
          isHovering: true,
          dimmed: true,
        };
      }

      const ppmAtHover = resolveCo2PpmAtTime(timeseries.points, hoverTime);
      return {
        ppm: ppmAtHover,
        subtitle: hoverPoint.timestamp
          ? `At ${formatIsoDateTimeString(hoverPoint.timestamp)}`
          : "",
        isHovering: true,
        dimmed: false,
      };
    }
    return {
      ppm: overview?.temperatureStatus?.co2Ppm ?? null,
      subtitle: overview?.temperatureStatus?.checkedAt
        ? `Last reading: ${overview.temperatureStatus.checkedAt}`
        : "",
      isHovering: false,
      dimmed: false,
    };
  }, [
    chartHover.active,
    forecastReferenceAt,
    hoverPoint,
    overview,
    shortTermForecastActive,
    shortTermForecastData?.referenceAt,
    timeseries.points,
  ]);

  useEffect(() => {
    if (!hasCo2InRange) {
      setShowCo2Overlay(false);
    }
  }, [hasCo2InRange]);

  const handleChartHover = useCallback((point) => {
    setChartHover({ active: point != null, point });
  }, []);

  const handleChartLeave = useCallback(() => {
    setChartHover({ active: false, point: null });
  }, []);

  useEffect(() => {
    setChartHover({ active: false, point: null });
  }, [timeseries.points]);

  useEffect(() => {
    if (zoomSelectMode) {
      setEventSelectMode(false);
    }
  }, [zoomSelectMode]);

  const loadData = useCallback(async (range, options = {}) => {
    const { applyInitialDashboardRange = false } = options;
    setLoading(true);
    try {
      const overviewData = await getOverview(range);
      setOverview(overviewData);

      const eventsReferenceAt =
        overviewData.forecastReferenceAt ?? overviewData.eventCheckedAt;
      const allEvents = await getSpaceEvents(eventsReferenceAt, {});
      setSpaceEvents(allEvents);

      const initialDashboardRange = buildInitialDashboardRangeQuery({
        displayRangeStart: overviewData.displayRangeStart,
        displayRangeEnd: overviewData.displayRangeEnd,
        events: allEvents,
      });

      const timeseriesRange =
        Object.keys(range).length > 0
          ? range
          : Object.keys(initialDashboardRange).length > 0
            ? initialDashboardRange
            : {};

      const timeseriesData = await getTimeseries(timeseriesRange, {
        referenceAt: overviewData.eventCheckedAt,
        forecastFuture: true,
        latitude: forecastLocation.latitude,
        longitude: forecastLocation.longitude,
      });
      setTimeseries(timeseriesData);

      if (applyInitialDashboardRange && Object.keys(initialDashboardRange).length > 0) {
        setSelection(rangeQueryToSelection(initialDashboardRange));
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [forecastLocation.latitude, forecastLocation.longitude]);

  const currentEventRange = useMemo(() => {
    if (selection.startDate && selection.endDate) {
      return buildRangeQuery(
        selection.startDate,
        selection.startTime,
        selection.endDate,
        selection.endTime,
      );
    }
    return {};
  }, [selection]);

  const refreshSpaceEvents = useCallback(async () => {
    if (!overview) return;
    const eventsData = await getSpaceEvents(
      eventsReferenceAt,
      currentEventRange,
    );
    setSpaceEvents(eventsData);
  }, [currentEventRange, eventsReferenceAt, overview]);

  const notifyEventsMutated = useCallback(async () => {
    await refreshSpaceEvents();
    await refreshEventsDetailRef.current?.();
  }, [refreshSpaceEvents]);

  async function handleSaveSpaceEvent(payload) {
    setSavingEvent(true);
    try {
      const { id, ...body } = payload;
      if (id) {
        await updateSpaceEvent(
          id,
          body,
          overview?.forecastReferenceAt ?? overview?.eventCheckedAt,
        );
      } else {
        await createSpaceEvent(body);
      }
      await notifyEventsMutated();
      closeEventModal();
    } finally {
      setSavingEvent(false);
    }
  }

  const eventModal = (
    <SpaceEventModal
      open={showAddEventModal}
      event={editingEvent}
      onClose={closeEventModal}
      onSubmit={handleSaveSpaceEvent}
      submitting={savingEvent}
    />
  );

  useEffect(() => {
    loadData({}, { applyInitialDashboardRange: true });
  }, [loadData]);

  const awaitingEnd = selection.startDate && !selection.endDate;

  function applyRange(nextSelection) {
    const range = buildRangeQuery(
      nextSelection.startDate,
      nextSelection.startTime,
      nextSelection.endDate,
      nextSelection.endTime,
    );
    if (range.start && range.end) {
      loadData(range);
    }
  }

  function handleToggleZoomSelectMode() {
    setZoomSelectMode((open) => {
      if (!open) {
        setEventSelectMode(false);
      }
      return !open;
    });
    setChartHover({ active: false, point: null });
  }

  function handleToggleEventSelectMode() {
    if (zoomSelectMode) return;
    setEventSelectMode((open) => !open);
    setChartHover({ active: false, point: null });
  }

  function handleToggleEventsOverlay() {
    setShowEventsOverlay((open) => {
      if (open) {
        setEventSelectMode(false);
        setSelectedDashboardEventKey(null);
      }
      return !open;
    });
  }

  function eventToSelection(event) {
    return {
      startDate: event.startsAt.slice(0, 10),
      endDate: event.endsAt.slice(0, 10),
      startTime: event.startsAt.slice(11, 16),
      endTime: event.endsAt.slice(11, 16),
    };
  }

  function handleDashboardEventSelect(event) {
    setZoomHistory((history) => [...history, cloneSelection(selection)]);

    const nextSelection = eventToSelection(event);
    setSelection(nextSelection);
    setSelectedDashboardEventKey(spaceEventKey(event));
    setEventSelectMode(false);
    applyRange(
      buildRangeQuery(
        nextSelection.startDate,
        nextSelection.startTime,
        nextSelection.endDate,
        nextSelection.endTime,
      ),
    );
  }

  function handleChartZoomSelect(startMs, endMs) {
    setZoomHistory((history) => [...history, cloneSelection(selection)]);

    const nextSelection = timeRangeToSelection(startMs, endMs);
    setSelection(nextSelection);
    setZoomSelectMode(false);
    setEventSelectMode(false);

    if (shortTermForecastActive) {
      applyRange(nextSelection);
      return;
    }

    setShortTermForecastActive(false);
    applyRange(nextSelection);
  }

  function handleZoomBack() {
    if (shortTermForecastActive) {
      exitShortTermForecast();
      return;
    }

    if (zoomHistory.length === 0) return;

    const restored = zoomHistory[zoomHistory.length - 1];
    setZoomHistory((history) => history.slice(0, -1));
    setZoomSelectMode(false);
    setEventSelectMode(false);
    setSelectedDashboardEventKey(null);
    setSelection(restored);

    if (restored.startDate && restored.endDate) {
      applyRange(restored);
    } else {
      loadData({}, { applyInitialDashboardRange: true });
    }
  }

  function clearZoomHistory() {
    setZoomHistory([]);
  }

  function handleDayClick(dayKey) {
    setShortTermForecastActive(false);
    clearZoomHistory();
    setEventSelectMode(false);
    setSelectedDashboardEventKey(null);
    if (!selection.startDate || (selection.startDate && selection.endDate)) {
      setSelection({
        startDate: dayKey,
        endDate: null,
        startTime: "00:00",
        endTime: "23:59",
      });
      return;
    }

    let startDate = selection.startDate;
    let endDate = dayKey;
    if (endDate < startDate) {
      [startDate, endDate] = [endDate, startDate];
    }

    const nextSelection = {
      ...selection,
      startDate,
      endDate,
    };
    setSelection(nextSelection);
    applyRange(nextSelection);
  }

  function handleStartTimeChange(startTime) {
    clearZoomHistory();
    const nextSelection = { ...selection, startTime };
    setSelection(nextSelection);
    applyRange(nextSelection);
  }

  function handleEndTimeChange(endTime) {
    clearZoomHistory();
    const nextSelection = { ...selection, endTime };
    setSelection(nextSelection);
    applyRange(nextSelection);
  }

  function resetDashboardToDefaultRange() {
    setShortTermForecastActive(false);
    setForecastDummyMode(FORECAST_DUMMY_MODES.off);
    setForecastLookbackHours(0);
    setForecastChartForwardHours(DEFAULT_DASHBOARD_FORECAST_HOURS);
    setForecastPredictionModel("simple");
    clearZoomHistory();
    setZoomSelectMode(false);
    setEventSelectMode(false);
    setSelectedDashboardEventKey(null);
    setSelection(EMPTY_SELECTION);
    loadData({}, { applyInitialDashboardRange: true });
  }

  const applyForecastChartRange = useCallback(
    (lookbackHours, chartForwardHours, { dummyHistory, predictionHours } = {}) => {
      const referenceMs = forecastReferenceAt
        ? resolveForecastReferenceMs(forecastReferenceAt)
        : Date.now();
      const effectivePrediction = predictionHours ?? shortTermForecastHours;
      const effectiveForward = Math.max(chartForwardHours, effectivePrediction);

      let useDummy = dummyHistory ?? forecastDummyMode;
      if (lookbackHours === 0) {
        useDummy = FORECAST_DUMMY_MODES.off;
      } else if (
        useDummy === FORECAST_DUMMY_MODES.off &&
        shouldAutoEnableForecastDummyHistory(
          timeseries.points,
          lookbackHours,
          referenceMs,
        )
      ) {
        useDummy = FORECAST_DUMMY_MODES.base;
      }

      setForecastLookbackHours(lookbackHours);
      setForecastChartForwardHours(effectiveForward);
      if (predictionHours != null) {
        setShortTermForecastHours(predictionHours);
      }
      setForecastDummyMode(useDummy);

      const range = buildShortTermForecastRangeQuery(effectiveForward, referenceMs, {
        lookbackHours,
      });
      setSelection(rangeQueryToSelection(range));
      loadData(range);
    },
    [
      forecastDummyMode,
      forecastReferenceAt,
      loadData,
      shortTermForecastHours,
      timeseries.points,
    ],
  );

  const handleForecastHorizonKnobChange = useCallback(
    ({ lookbackHours, chartForwardHours }) => {
      if (!shortTermForecastActive) return;
      applyForecastChartRange(lookbackHours, chartForwardHours);
    },
    [applyForecastChartRange, shortTermForecastActive],
  );

  const handleForecastPredictionHoursChange = useCallback(
    (hours) => {
      if (!shortTermForecastActive) {
        setShortTermForecastHours(hours);
        setForecastChartForwardHours((current) => Math.max(current, hours));
        return;
      }
      applyForecastChartRange(forecastLookbackHours, forecastChartForwardHours, {
        predictionHours: hours,
      });
    },
    [
      applyForecastChartRange,
      forecastChartForwardHours,
      forecastLookbackHours,
      shortTermForecastActive,
    ],
  );

  const enterShortTermForecast = useCallback(
    (hours = shortTermForecastHours) => {
      setZoomHistory((history) => [...history, cloneSelection(selection)]);
      setZoomSelectMode(false);
      setEventSelectMode(false);
      setSelectedDashboardEventKey(null);
      setChartHover({ active: false, point: null });

      const referenceMs = forecastReferenceAt
        ? resolveForecastReferenceMs(forecastReferenceAt)
        : Date.now();
      const useDummyHistory = shouldAutoEnableForecastDummyHistory(
        timeseries.points,
        hours,
        referenceMs,
      );
      const lookbackHours = useDummyHistory ? hours : 0;

      setShortTermForecastActive(true);
      setShowOutsideOnChart(true);
      applyForecastChartRange(lookbackHours, hours, {
        dummyHistory: useDummyHistory ? FORECAST_DUMMY_MODES.base : FORECAST_DUMMY_MODES.off,
        predictionHours: hours,
      });
    },
    [
      applyForecastChartRange,
      forecastReferenceAt,
      selection,
      shortTermForecastHours,
      timeseries.points,
    ],
  );

  function exitShortTermForecast() {
    setShortTermForecastActive(false);
    setForecastDummyMode(FORECAST_DUMMY_MODES.off);
    setForecastLookbackHours(0);
    setForecastChartForwardHours(DEFAULT_DASHBOARD_FORECAST_HOURS);
    setForecastPredictionModel("simple");
    setChartHover({ active: false, point: null });

    if (zoomHistory.length === 0) {
      resetDashboardToDefaultRange();
      return;
    }

    const restored = zoomHistory[zoomHistory.length - 1];
    setZoomHistory((history) => history.slice(0, -1));
    setSelection(restored);

    if (restored.startDate && restored.endDate) {
      loadData(
        buildRangeQuery(
          restored.startDate,
          restored.startTime,
          restored.endDate,
          restored.endTime,
        ),
      );
    } else {
      loadData({}, { applyInitialDashboardRange: true });
    }
  }

  function handleForecastDummyToggle() {
    const next = cycleForecastDummyMode(forecastDummyMode);

    if (!shortTermForecastActive) {
      setForecastDummyMode(next);
      return;
    }

    let lookback = forecastLookbackHours;
    if (next !== FORECAST_DUMMY_MODES.off && lookback === 0) {
      lookback = shortTermForecastHours;
    }
    applyForecastChartRange(lookback, forecastChartForwardHours, {
      dummyHistory: next,
    });
  }

  function handleClearRange() {
    resetDashboardToDefaultRange();
  }

  function goToDashboard() {
    setView("dashboard");
    resetDashboardToDefaultRange();
  }

  function openForecast() {
    if (view !== "dashboard") {
      setForecastEnterPending(true);
      setView("dashboard");
      return;
    }

    if (shortTermForecastActive) {
      exitShortTermForecast();
      return;
    }

    enterShortTermForecast(shortTermForecastHours);
  }

  const siteHeaderForecastProps = {
    onOpenForecast: openForecast,
    forecastActive: view === "dashboard" && shortTermForecastActive,
  };

  useEffect(() => {
    if (view !== "dashboard" || !forecastEnterPending || !overview) return;
    setForecastEnterPending(false);
    if (!shortTermForecastActive) {
      enterShortTermForecast(shortTermForecastHours);
    }
  }, [
    enterShortTermForecast,
    forecastEnterPending,
    overview,
    shortTermForecastActive,
    shortTermForecastHours,
    view,
  ]);

  const forecastChartToolbar = useMemo(() => {
    if (!shortTermForecastActive) return null;

    return (
      <>
        <ForecastHorizonKnob
          lookbackHours={forecastLookbackHours}
          chartForwardHours={forecastChartForwardHours}
          predictionHours={shortTermForecastHours}
          onChange={handleForecastHorizonKnobChange}
        />
        <span className="text-xs text-lb-text-muted">Predict</span>
        {DASHBOARD_FORECAST_HOUR_OPTIONS.map((hours) => (
          <button
            key={hours}
            type="button"
            onClick={() => handleForecastPredictionHoursChange(hours)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              shortTermForecastHours === hours
                ? "border-sky-300 bg-sky-400/20 text-sky-100"
                : "border-[var(--surface-border)] text-lb-text hover:border-sky-300 hover:text-sky-100"
            }`}
          >
            {hours} h
          </button>
        ))}
        <span className="text-xs text-lb-text-muted">Model</span>
        {FORECAST_PREDICTION_MODELS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setForecastPredictionModel(id)}
            title={
              id === "thermal"
                ? "Fitted heat-pump AUTO controller with weather drift"
                : "Comfort-band step simulation (default)"
            }
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              forecastPredictionModel === id
                ? "border-violet-300 bg-violet-400/20 text-violet-100"
                : "border-[var(--surface-border)] text-lb-text hover:border-violet-300 hover:text-violet-100"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={handleForecastDummyToggle}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            isForecastDummyActive(forecastDummyMode)
              ? "border-amber-300 bg-amber-400/20 text-amber-100"
              : "border-[var(--surface-border)] text-lb-text hover:border-amber-300 hover:text-amber-100"
          }`}
          title="Cycle demo history before now: base → cooling → heating → off"
        >
          Dummy history: {forecastDummyModeLabel(forecastDummyMode)}
        </button>
        <button
          type="button"
          onClick={exitShortTermForecast}
          className="rounded-lg border border-[var(--surface-border)] px-3 py-1.5 text-xs text-lb-text transition-colors hover:border-lb-accent hover:text-lb-accent"
        >
          Exit forecast
        </button>
      </>
    );
  }, [
    forecastChartForwardHours,
    forecastDummyMode,
    forecastLookbackHours,
    forecastPredictionModel,
    handleForecastHorizonKnobChange,
    handleForecastPredictionHoursChange,
    shortTermForecastActive,
    shortTermForecastHours,
  ]);

  if (!overview) {
    return (
      <>
        <SiteHeader onHome={goToDashboard} {...siteHeaderForecastProps} />
        <LoadingIndicator label="Loading dashboard…" />
      </>
    );
  }

  if (view === "energy") {
    return (
      <>
        <SiteHeader
          onHome={goToDashboard}
          onOpenRoom={() => setView("room")}
          {...siteHeaderForecastProps}
        />
        <EnergyDetailView
          powerDetail={overview.powerDetail}
          timeseriesPoints={timeseries.points ?? []}
          gaps={timeseries.gaps ?? []}
          rangeStart={timeseries.rangeStart}
          rangeEnd={timeseries.rangeEnd}
          devicePowerSeries={timeseries.devicePowerSeries ?? {}}
          referenceAtForActions={overview.eventCheckedAt}
          weatherPrognosisHorizonDays={overview.weatherPrognosisHorizonDays}
          energyLabel={formatDisplayRangeText(overview.energyDrawLabel)}
          onBack={goToDashboard}
        />
      </>
    );
  }

  if (view === "co2") {
    return (
      <>
        <SiteHeader
          onHome={goToDashboard}
          onOpenRoom={() => setView("room")}
          {...siteHeaderForecastProps}
        />
        <Co2DetailView
          referenceAtForActions={overview.eventCheckedAt}
          co2CheckedAt={overview.temperatureStatus?.checkedAt}
          displayRangeStart={overview.displayRangeStart}
          displayRangeEnd={overview.displayRangeEnd}
          weatherPrognosisHorizonDays={overview.weatherPrognosisHorizonDays}
          onBack={goToDashboard}
        />
      </>
    );
  }

  if (view === "room") {
    return (
      <>
        <SiteHeader
          onHome={goToDashboard}
          onOpenRoom={() => setView("room")}
          roomActive
          {...siteHeaderForecastProps}
        />
        <Suspense fallback={<LoadingIndicator label="Loading 3D view…" />}>
          <RoomDetailView
            timeseriesPoints={timeseries.points ?? []}
            rangeStart={timeseries.rangeStart}
            rangeEnd={timeseries.rangeEnd}
            gaps={timeseries.gaps ?? []}
            spaceEvents={spaceEvents}
            forecastReferenceAt={forecastReferenceAt}
            weatherPrognosisHorizonDays={overview?.weatherPrognosisHorizonDays ?? 7}
            forecastLocation={forecastLocation}
            onBack={goToDashboard}
          />
        </Suspense>
      </>
    );
  }

  if (view === "events") {
    return (
      <>
        <SiteHeader
          onHome={goToDashboard}
          onOpenRoom={() => setView("room")}
          {...siteHeaderForecastProps}
        />
        <EventsDetailView
          referenceAt={overview.eventCheckedAt}
          forecastReferenceAt={overview.forecastReferenceAt}
          weatherPrognosisHorizonDays={overview.weatherPrognosisHorizonDays}
          onBack={goToDashboard}
          onAddEvent={openAddEventModal}
          onEditEvent={openEditEventModal}
          onEventsChanged={refreshSpaceEvents}
          onRegisterRefresh={(fn) => {
            refreshEventsDetailRef.current = fn;
          }}
          referenceAtForActions={eventsReferenceAt}
        />
        {eventModal}
      </>
    );
  }

  return (
    <>
      <SiteHeader onOpenRoom={() => setView("room")} {...siteHeaderForecastProps} />
      <main className="min-h-screen bg-lb-bg p-8">
      <section className="mb-8 flex w-full flex-wrap items-center gap-5">
        <img
          src="/lb-energy-logo.svg"
          alt="LB Energy"
          className="h-16 w-auto shrink-0"
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-2">
          <h1 className="gradient-heading text-4xl font-bold">
            Heat Pump Optimization Dashboard
          </h1>
          {selectedTimeframeLabel && (
            <p className="text-lg text-lb-text-muted">{selectedTimeframeLabel}</p>
          )}
        </div>
        <div className="ml-auto flex shrink-0 gap-2">
          <button
            type="button"
            onClick={openAddEventModal}
            className="rounded-lg border border-[var(--surface-border)] px-4 py-2 text-sm font-medium text-lb-text transition-colors hover:border-lb-accent hover:text-lb-accent"
          >
            + Add event
          </button>
          <button
            type="button"
            onClick={() => setView("events")}
            className="rounded-lg border border-[var(--surface-border)] px-4 py-2 text-sm font-medium text-lb-text transition-colors hover:border-lb-accent hover:text-lb-accent"
          >
            Manage events
          </button>
        </div>
      </section>

      <div className="flex flex-col gap-6 xl:flex-row xl:items-stretch">
        <div
          className={`min-w-0 flex-1 space-y-6 transition-opacity ${loading ? "opacity-60" : "opacity-100"}`}
        >
          <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <EnergyDrawCard
              value={energyCardProps.value}
              unit={energyCardProps.unit}
              subtitle={energyCardProps.subtitle}
              isHovering={energyCardProps.isHovering}
              overlayActive={showPowerOverlay}
              onToggleOverlay={() => setShowPowerOverlay((open) => !open)}
              onNavigate={() => setView("energy")}
            />
            <ComfortMaintainedCard
              value={comfortCardProps.value}
              unit={comfortCardProps.unit}
              subtitle={comfortCardProps.subtitle}
              subtitleTooltip={overview.comfortTargetRange}
              isHovering={comfortCardProps.isHovering}
              overlayActive={showComfortOverlay}
              onToggleOverlay={() => setShowComfortOverlay((open) => !open)}
            />
            <EventStatusCard
              active={eventCardProps.active}
              subtitle={eventCardProps.subtitle}
              isHovering={eventCardProps.isHovering}
              overlayActive={showEventsOverlay}
              onToggleOverlay={handleToggleEventsOverlay}
              onNavigate={() => setView("events")}
            />
            <TemperatureBarsCard
              values={temperatureBarValues}
              isHovering={chartHover.active}
              showOutsideOnChart={showOutsideOnChart || shortTermForecastActive}
              showReturnOnChart={showReturnOnChart}
              onToggleOutside={() => {
                if (shortTermForecastActive) return;
                setShowOutsideOnChart((v) => !v);
              }}
              onToggleReturn={() => setShowReturnOnChart((v) => !v)}
            />
          </section>

          <section className="w-full space-y-3">
            <TemperatureChart
              data={dashboardChartPoints}
              rangeStart={chartRange.start}
              rangeEnd={chartRange.end}
              gaps={timeseries.gaps}
              events={spaceEvents}
              showEventsOverlay={showEventsOverlay}
              showPowerOverlay={showPowerOverlay}
              showComfortOverlay={showComfortOverlay}
              showCo2Overlay={showCo2Overlay}
              weatherPrognosisHorizonDays={overview.weatherPrognosisHorizonDays}
              showOutsideTemp={showOutsideOnChart || shortTermForecastActive}
              showReturnTemp={showReturnOnChart}
              showInsideTempPrediction={shortTermForecastActive}
              showOperationModeForecast={shortTermForecastActive}
              forecastToolbar={forecastChartToolbar}
              zoomSelectMode={zoomSelectMode}
              eventSelectMode={eventSelectMode}
              showEventSelectButton={showEventsOverlay}
              canZoomBack={!shortTermForecastActive && zoomHistory.length > 0}
              zoomBackSteps={zoomHistory.length}
              onToggleZoomSelectMode={handleToggleZoomSelectMode}
              onToggleEventSelectMode={handleToggleEventSelectMode}
              onZoomBack={handleZoomBack}
              onZoomSelect={handleChartZoomSelect}
              onHoverPoint={handleChartHover}
              onHoverLeave={handleChartLeave}
              selectedEventKey={selectedDashboardEventKey}
              onEventClick={
                eventSelectMode && !zoomSelectMode
                  ? handleDashboardEventSelect
                  : undefined
              }
              currentTimeMarker={forecastReferenceAt}
              currentTimeLabel={nowMarkerLabel}
              showForecastTemperatureLines
              eventsOnlyTarget={shortTermForecastActive}
            />
            {shortTermForecastLoading && shortTermForecastActive && (
              <p className="text-xs text-lb-text-muted">Refreshing forecast…</p>
            )}
          </section>
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-6 xl:min-h-0 xl:w-64">
          <TimeframeCalendar
            startDate={overview.displayRangeStart}
            endDate={overview.displayRangeEnd}
            availableDates={overview.availableDates}
            selectionStart={selection.startDate}
            selectionEnd={selection.endDate}
            startTime={selection.startTime}
            endTime={selection.endTime}
            onDayClick={handleDayClick}
            onStartTimeChange={handleStartTimeChange}
            onEndTimeChange={handleEndTimeChange}
            onClearRange={handleClearRange}
          />
          <Co2LevelCard
            stretchVertical
            ppm={co2CardProps.ppm}
            subtitle={co2CardProps.subtitle}
            isHovering={co2CardProps.isHovering}
            dimmed={co2CardProps.dimmed}
            overlayActive={showCo2Overlay}
            overlayToggleEnabled={hasCo2InRange}
            onToggleOverlay={() => setShowCo2Overlay((open) => !open)}
            onNavigate={() => setView("co2")}
          />
        </aside>
      </div>

      <RangeReminder
        message={
          awaitingEnd
            ? "Start date set — now click an end date on the calendar."
            : null
        }
      />
    </main>
    {eventModal}
    </>
  );
}
