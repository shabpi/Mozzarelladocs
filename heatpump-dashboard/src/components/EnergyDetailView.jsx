import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSpaceEvents, getTimeseries } from "../api";
import { useForecastLocation } from "../hooks/useForecastBootstrap";
import TemperatureChart from "./TemperatureChart";

const TOTAL_COLOR = "#fbbf24";
const PEAK_LINE_COLOR = "#f87171";
const AVG_LINE_COLOR = "#60a5fa";
const OVERLAY_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fb7185", "#f472b6"];

function deviceSeriesKey(name) {
  return `device_${name.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function shortDeviceLabel(name) {
  return name.length > 14 ? `${name.slice(0, 12)}…` : name;
}

function buildRangeQuery(rangeStart, rangeEnd) {
  if (!rangeStart || !rangeEnd) return {};
  return { start: rangeStart, end: rangeEnd };
}

export default function EnergyDetailView({
  powerDetail,
  timeseriesPoints = [],
  gaps = [],
  rangeStart,
  rangeEnd,
  devicePowerSeries = {},
  referenceAtForActions,
  weatherPrognosisHorizonDays = 7,
  energyLabel,
  onBack,
}) {
  const [soloDevice, setSoloDevice] = useState(null);
  const [overlayDevices, setOverlayDevices] = useState([]);
  const [showPeakLine, setShowPeakLine] = useState(false);
  const [showAvgLine, setShowAvgLine] = useState(false);
  const [showEventsOverlay, setShowEventsOverlay] = useState(false);
  const [showOutsideOnChart, setShowOutsideOnChart] = useState(false);
  const [showReturnOnChart, setShowReturnOnChart] = useState(false);
  const [showCo2Overlay, setShowCo2Overlay] = useState(false);
  const [showComfortOverlay, setShowComfortOverlay] = useState(false);
  const [showPowerOverlay, setShowPowerOverlay] = useState(true);
  const [allEvents, setAllEvents] = useState([]);
  const [chartPoints, setChartPoints] = useState(timeseriesPoints);
  const [chartGaps, setChartGaps] = useState(gaps);
  const [chartRangeStart, setChartRangeStart] = useState(rangeStart);
  const [chartRangeEnd, setChartRangeEnd] = useState(rangeEnd);
  const [loading, setLoading] = useState(false);
  const [pinSelectedCard, setPinSelectedCard] = useState(false);
  const forecastLocation = useForecastLocation();
  const stickyPanelRef = useRef(null);
  const itemRefs = useRef(new Map());

  const deviceNames = powerDetail.devices?.map((d) => d.name) ?? [];

  const loadChartData = useCallback(async () => {
    if (!referenceAtForActions) return;
    setLoading(true);
    try {
      const range = buildRangeQuery(rangeStart, rangeEnd);
      const geo = {
        latitude: forecastLocation.latitude,
        longitude: forecastLocation.longitude,
      };
      const [events, timeseries] = await Promise.all([
        getSpaceEvents(referenceAtForActions, range, geo),
        getTimeseries(range, {
          referenceAt: referenceAtForActions,
          forecastFuture: true,
          ...geo,
        }),
      ]);
      setAllEvents(events);
      setChartPoints(timeseries.points ?? []);
      setChartGaps(timeseries.gaps ?? []);
      setChartRangeStart(timeseries.rangeStart ?? rangeStart);
      setChartRangeEnd(timeseries.rangeEnd ?? rangeEnd);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [forecastLocation, rangeEnd, rangeStart, referenceAtForActions]);

  useEffect(() => {
    loadChartData();
  }, [loadChartData]);

  const overlayColorMap = useMemo(() => {
    const map = {};
    overlayDevices.forEach((name, index) => {
      map[name] = OVERLAY_COLORS[index % OVERLAY_COLORS.length];
    });
    return map;
  }, [overlayDevices]);

  const mergedChartData = useMemo(() => {
    if (soloDevice && devicePowerSeries[soloDevice]) {
      const deviceMap = new Map(
        devicePowerSeries[soloDevice].map((point) => [point.timestamp, point.powerDrawKw]),
      );
      return chartPoints.map((point) => ({
        ...point,
        powerDrawKw: deviceMap.get(point.timestamp) ?? null,
      }));
    }

    if (overlayDevices.length === 0) {
      return chartPoints;
    }

    const deviceMaps = {};
    overlayDevices.forEach((name) => {
      const points = devicePowerSeries[name] ?? [];
      deviceMaps[name] = new Map(
        points.map((point) => [point.timestamp, point.powerDrawKw]),
      );
    });

    return chartPoints.map((point) => {
      const row = { ...point };
      overlayDevices.forEach((name) => {
        row[deviceSeriesKey(name)] = deviceMaps[name]?.get(point.timestamp) ?? null;
      });
      return row;
    });
  }, [chartPoints, devicePowerSeries, overlayDevices, soloDevice]);

  const additionalPowerLines = useMemo(() => {
    if (soloDevice) return [];
    return overlayDevices.map((name) => ({
      dataKey: deviceSeriesKey(name),
      name,
      color: overlayColorMap[name],
    }));
  }, [overlayColorMap, overlayDevices, soloDevice]);

  const powerReferenceLines = useMemo(() => {
    const peakValue = soloDevice
      ? powerDetail.devices?.find((device) => device.name === soloDevice)?.maxKw
      : powerDetail.peakKw;
    const avgValue = soloDevice
      ? powerDetail.devices?.find((device) => device.name === soloDevice)?.avgKw
      : powerDetail.avgKw;

    const lines = [];
    if (showPeakLine && peakValue != null) {
      lines.push({
        key: "peak",
        value: Number(peakValue),
        label: `Peak ${peakValue} kW`,
        color: PEAK_LINE_COLOR,
      });
    }
    if (showAvgLine && avgValue != null) {
      lines.push({
        key: "avg",
        value: Number(avgValue),
        label: `Avg ${avgValue} kW`,
        color: AVG_LINE_COLOR,
      });
    }
    return lines;
  }, [powerDetail, showAvgLine, showPeakLine, soloDevice]);

  const selectedDevice = useMemo(
    () => powerDetail.devices?.find((device) => device.name === soloDevice) ?? null,
    [powerDetail.devices, soloDevice],
  );

  const handleShowTotal = useCallback(() => {
    setSoloDevice(null);
    setOverlayDevices([]);
  }, []);

  const handleDeviceClick = useCallback((name) => {
    setSoloDevice(name);
    setOverlayDevices([]);
  }, []);

  const handleToggleOverlay = useCallback(
    (name) => {
      if (soloDevice === name) {
        setSoloDevice(null);
        return;
      }
      setSoloDevice(null);
      setOverlayDevices((current) =>
        current.includes(name)
          ? current.filter((item) => item !== name)
          : [...current, name],
      );
    },
    [soloDevice],
  );

  const chartOverlayControls = useMemo(() => {
    const controls = [
      {
        key: "total",
        label: "Total",
        title: "Total power draw",
        active: !soloDevice && overlayDevices.length === 0,
        onToggle: handleShowTotal,
        color: "bg-amber-400",
      },
      ...deviceNames.map((name, index) => {
        const overlayIndex = overlayDevices.indexOf(name);
        return {
          key: `device-${name}`,
          label: shortDeviceLabel(name),
          title: name,
          active: soloDevice === name || overlayDevices.includes(name),
          onToggle: () => handleToggleOverlay(name),
          color: null,
          swatchColor:
            soloDevice === name
              ? TOTAL_COLOR
              : overlayIndex >= 0
                ? OVERLAY_COLORS[overlayIndex % OVERLAY_COLORS.length]
                : OVERLAY_COLORS[index % OVERLAY_COLORS.length],
        };
      }),
      {
        key: "outside",
        label: "Outside",
        title: "Outside temperature",
        active: showOutsideOnChart,
        onToggle: () => setShowOutsideOnChart((value) => !value),
        color: "bg-sky-400",
      },
      {
        key: "recorded",
        label: "Recorded",
        title: "Recorded (return) temperature",
        active: showReturnOnChart,
        onToggle: () => setShowReturnOnChart((value) => !value),
        color: "bg-violet-400",
      },
      {
        key: "power",
        label: "Power",
        title: "Power draw",
        active: showPowerOverlay,
        onToggle: () => setShowPowerOverlay((value) => !value),
        color: "bg-amber-400",
      },
      {
        key: "comfort",
        label: "Comfort",
        title: "Comfort delta band",
        active: showComfortOverlay,
        onToggle: () => setShowComfortOverlay((value) => !value),
        gradient: "linear-gradient(to bottom, #22c55e, #eab308, #ef4444)",
      },
      {
        key: "co2",
        label: "CO₂",
        title: "Indoor CO₂ level",
        active: showCo2Overlay,
        onToggle: () => setShowCo2Overlay((value) => !value),
        color: "bg-emerald-400",
      },
      {
        key: "events",
        label: "Events",
        title: "Space events",
        active: showEventsOverlay,
        onToggle: () => setShowEventsOverlay((value) => !value),
        color: "bg-emerald-500",
      },
    ];

    return controls;
  }, [
    deviceNames,
    handleShowTotal,
    handleToggleOverlay,
    overlayDevices,
    showCo2Overlay,
    showComfortOverlay,
    showEventsOverlay,
    showOutsideOnChart,
    showPowerOverlay,
    showReturnOnChart,
    soloDevice,
  ]);

  const chartStatusLabel = useMemo(() => {
    if (soloDevice) return `Solo view: ${soloDevice}`;
    if (overlayDevices.length > 0) {
      return `Total + ${overlayDevices.length} device overlay${overlayDevices.length > 1 ? "s" : ""}`;
    }
    return "Toggle peak/average KPI cards or chart options to add reference lines and overlays";
  }, [overlayDevices.length, soloDevice]);

  const showTemperatureOverlays =
    showOutsideOnChart || showReturnOnChart || showComfortOverlay;

  const syncScrollMargin = useCallback(() => {
    const header = document.querySelector("header");
    const headerHeight = header?.getBoundingClientRect().height ?? 57;
    const panelHeight = stickyPanelRef.current?.offsetHeight ?? 0;
    document.documentElement.style.setProperty(
      "--power-list-scroll-margin",
      `${headerHeight + panelHeight + 12}px`,
    );
  }, []);

  const updatePinState = useCallback(() => {
    if (!soloDevice || !stickyPanelRef.current) {
      setPinSelectedCard(false);
      return;
    }

    const el = itemRefs.current.get(soloDevice);
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
  }, [soloDevice]);

  useEffect(() => {
    updatePinState();
    window.addEventListener("scroll", updatePinState, { passive: true });
    window.addEventListener("resize", updatePinState);
    return () => {
      window.removeEventListener("scroll", updatePinState);
      window.removeEventListener("resize", updatePinState);
    };
  }, [updatePinState, soloDevice, mergedChartData]);

  useEffect(() => {
    if (!stickyPanelRef.current) return undefined;
    const observer = new ResizeObserver(() => {
      syncScrollMargin();
      updatePinState();
    });
    observer.observe(stickyPanelRef.current);
    return () => observer.disconnect();
  }, [syncScrollMargin, updatePinState, soloDevice, pinSelectedCard]);

  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return undefined;

    const syncHeaderOffset = () => {
      document.documentElement.style.setProperty(
        "--power-sticky-top",
        `${header.getBoundingClientRect().height}px`,
      );
      syncScrollMargin();
    };

    syncHeaderOffset();
    const observer = new ResizeObserver(syncHeaderOffset);
    observer.observe(header);
    return () => observer.disconnect();
  }, [syncScrollMargin]);

  return (
    <main className="min-h-screen bg-lb-bg p-8">
      <div className="mb-8 flex items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-[var(--surface-border)] px-4 py-2 text-sm text-lb-text transition-colors hover:border-lb-accent hover:text-lb-accent"
        >
          ← Back to dashboard
        </button>
        <div>
          <h1 className="gradient-heading text-3xl font-bold">Power Draw</h1>
          <p className="text-sm text-lb-text-muted">{energyLabel}</p>
        </div>
      </div>

      <section className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5">
          <p className="text-sm text-lb-text-muted">Total energy</p>
          <p className="mt-2 text-3xl font-bold text-lb-heading">
            {powerDetail.totalKwh} <span className="text-base font-normal">kWh</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowPeakLine((value) => !value)}
          aria-pressed={showPeakLine}
          className={`rounded-2xl border bg-[var(--surface)] p-5 text-left transition-colors ${
            showPeakLine
              ? "border-red-400/70 ring-1 ring-red-400/40"
              : "border-[var(--surface-border)] hover:border-red-400/40"
          }`}
        >
          <p className="text-sm text-lb-text-muted">Peak draw</p>
          <p className="mt-2 text-3xl font-bold text-lb-heading">
            {powerDetail.peakKw} <span className="text-base font-normal">kW</span>
          </p>
          <p className="mt-2 text-xs text-lb-text-muted">
            {showPeakLine ? "Reference line shown on chart" : "Click to show peak line"}
          </p>
        </button>
        <button
          type="button"
          onClick={() => setShowAvgLine((value) => !value)}
          aria-pressed={showAvgLine}
          className={`rounded-2xl border bg-[var(--surface)] p-5 text-left transition-colors ${
            showAvgLine
              ? "border-sky-400/70 ring-1 ring-sky-400/40"
              : "border-[var(--surface-border)] hover:border-sky-400/40"
          }`}
        >
          <p className="text-sm text-lb-text-muted">Average draw</p>
          <p className="mt-2 text-3xl font-bold text-lb-heading">
            {powerDetail.avgKw} <span className="text-base font-normal">kW</span>
          </p>
          <p className="mt-2 text-xs text-lb-text-muted">
            {showAvgLine ? "Reference line shown on chart" : "Click to show average line"}
          </p>
        </button>
      </section>

      <div
        ref={stickyPanelRef}
        className="sticky top-[var(--power-sticky-top,57px)] z-40 -mx-8 mb-8 space-y-3 border-b border-[var(--surface-border)] bg-lb-bg/95 px-8 pb-4 backdrop-blur-md"
      >
        <p className="text-sm text-lb-text-muted">{chartStatusLabel}</p>

        <div className={loading ? "opacity-60 transition-opacity" : undefined}>
          <TemperatureChart
            chartTitle="Power draw over time"
            data={mergedChartData}
            rangeStart={chartRangeStart}
            rangeEnd={chartRangeEnd}
            gaps={chartGaps}
            events={allEvents}
            hideZoomControls
            showEventsOverlay={showEventsOverlay}
            showEventBandLabels
            showPowerOverlay={showPowerOverlay}
            powerSeriesAsLine={overlayDevices.length > 0 || Boolean(soloDevice)}
            additionalPowerLines={additionalPowerLines}
            powerReferenceLines={powerReferenceLines}
            showOutsideTemp={showOutsideOnChart}
            showReturnTemp={showReturnOnChart}
            showCo2Overlay={showCo2Overlay}
            showComfortOverlay={showComfortOverlay}
            hideTemperatureSeries={!showTemperatureOverlays}
            showForecastTemperatureLines
            weatherPrognosisHorizonDays={weatherPrognosisHorizonDays}
            overlayControls={chartOverlayControls}
          />
        </div>

        {soloDevice && selectedDevice && pinSelectedCard && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => handleDeviceClick(soloDevice)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleDeviceClick(soloDevice);
              }
            }}
            className="w-full cursor-pointer rounded-lg border border-amber-400/70 bg-amber-400/10 px-4 py-3 text-left ring-2 ring-amber-400/40 transition-colors hover:bg-amber-400/15"
          >
            <p className="font-medium text-lb-heading">{selectedDevice.name}</p>
            <p className="mt-1 text-sm text-lb-text-muted">
              Solo view · Avg {selectedDevice.avgKw} kW · Peak {selectedDevice.maxKw} kW ·{" "}
              {selectedDevice.energyKwh} kWh total
            </p>
          </div>
        )}
      </div>

      {deviceNames.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-lb-text-muted">
            By device
          </h2>
          <p className="text-xs text-lb-text-muted">
            Click a device for solo view. Use the chart header toggles to overlay devices or
            environment data.
          </p>
          <ul className="space-y-2">
            {powerDetail.devices.map((device) => {
              const isSolo = soloDevice === device.name;
              const isOverlay = overlayDevices.includes(device.name);
              const overlayIndex = overlayDevices.indexOf(device.name);
              const accentColor =
                overlayIndex >= 0
                  ? OVERLAY_COLORS[overlayIndex % OVERLAY_COLORS.length]
                  : null;

              return (
                <li
                  key={device.name}
                  ref={(node) => {
                    if (node) itemRefs.current.set(device.name, node);
                    else itemRefs.current.delete(device.name);
                  }}
                  style={{ scrollMarginTop: "var(--power-list-scroll-margin, 420px)" }}
                  className={`rounded-lg border bg-[var(--surface)] transition-colors ${
                    isSolo
                      ? "border-amber-400/70 ring-1 ring-amber-400/40"
                      : "border-[var(--surface-border)] hover:border-lb-accent/50"
                  } ${isSolo && pinSelectedCard ? "invisible" : ""}`}
                  aria-hidden={isSolo && pinSelectedCard ? true : undefined}
                >
                  <button
                    type="button"
                    onClick={() => handleDeviceClick(device.name)}
                    className="w-full px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-2">
                      {isOverlay && accentColor && (
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: accentColor }}
                        />
                      )}
                      <p className="font-medium text-lb-heading">{device.name}</p>
                      {isSolo && (
                        <span className="rounded bg-amber-400/20 px-2 py-0.5 text-xs text-amber-300">
                          Solo view
                        </span>
                      )}
                      {isOverlay && !isSolo && (
                        <span className="rounded bg-violet-500/20 px-2 py-0.5 text-xs text-violet-200">
                          Overlay
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-lb-text-muted">
                      Avg {device.avgKw} kW · Peak {device.maxKw} kW · {device.energyKwh} kWh
                      total
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
