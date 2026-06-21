import { useCallback, useEffect, useRef, useState } from "react";
import {
  FORECAST_CHART_VISUAL_CAP_HOURS,
  FORECAST_LOOKBACK_MIN_HOURS,
} from "../utils/shortTermForecastUtils";

const PX_PER_HOUR = 13;
const TRACK_WIDTH = 196;
const CENTER_X = TRACK_WIDTH / 2;

function displayBarPx(hours) {
  if (hours <= 0) return 0;
  const capped = Math.min(hours, FORECAST_CHART_VISUAL_CAP_HOURS);
  return capped * PX_PER_HOUR;
}

function hoursFromOffsetPx(offsetPx) {
  return Math.round(Math.abs(offsetPx) / PX_PER_HOUR);
}

export default function ForecastHorizonKnob({
  lookbackHours,
  chartForwardHours,
  predictionHours,
  onChange,
  disabled = false,
}) {
  const trackRef = useRef(null);
  const knobRef = useRef(null);
  const dragStartRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [dragOffsetPx, setDragOffsetPx] = useState(0);

  const leftWidth = displayBarPx(lookbackHours);
  const rightWidth = displayBarPx(chartForwardHours);
  const predictionWidth = displayBarPx(Math.min(predictionHours, chartForwardHours));
  const pullLeft = dragging && dragOffsetPx < 0;
  const pullRight = dragging && dragOffsetPx > 0;

  const finishDrag = useCallback(() => {
    dragStartRef.current = null;
    setDragging(false);
    setDragOffsetPx(0);
  }, []);

  const handlePointerMove = useCallback(
    (event) => {
      const dragStart = dragStartRef.current;
      if (!dragStart) return;

      const rawOffset = event.clientX - dragStart.clientX;
      setDragOffsetPx(rawOffset);

      const deltaHours = hoursFromOffsetPx(rawOffset);
      if (rawOffset > 0) {
        onChange({
          lookbackHours: dragStart.lookbackHours,
          chartForwardHours: dragStart.chartForwardHours + deltaHours,
        });
        return;
      }

      if (rawOffset < 0) {
        onChange({
          lookbackHours: Math.max(
            FORECAST_LOOKBACK_MIN_HOURS,
            dragStart.lookbackHours + deltaHours,
          ),
          chartForwardHours: dragStart.chartForwardHours,
        });
      }
    },
    [onChange],
  );

  useEffect(() => {
    if (!dragging) return undefined;

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [dragging, finishDrag, handlePointerMove]);

  const startDrag = (event) => {
    if (disabled) return;
    event.preventDefault();
    dragStartRef.current = {
      clientX: event.clientX,
      lookbackHours,
      chartForwardHours,
    };
    setDragging(true);
    setDragOffsetPx(0);
    knobRef.current?.setPointerCapture?.(event.pointerId);
  };

  const knobLeft = CENTER_X + (dragging ? dragOffsetPx : 0);

  return (
    <div
      className={`flex items-center gap-2 ${dragging ? "select-none" : ""}`}
      title="Drag left for more history, right to widen the chart view. Prediction length is set separately."
    >
      <span className="text-xs text-lb-text-muted">View</span>
      <div
        ref={trackRef}
        className={`relative h-7 rounded-lg border border-[var(--surface-border)] bg-white/5 ${
          disabled ? "opacity-50" : ""
        }`}
        style={{ width: TRACK_WIDTH }}
        aria-hidden
      >
        <div
          className="absolute top-1/2 h-px -translate-y-1/2 bg-white/15"
          style={{ left: 8, right: 8 }}
        />

        {lookbackHours > 0 && (
          <div
            className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-l bg-amber-400/35 ${
              pullLeft ? "bg-amber-400/55" : ""
            }`}
            style={{
              left: CENTER_X - leftWidth,
              width: leftWidth,
            }}
          />
        )}

        {chartForwardHours > predictionHours && (
          <div
            className={`absolute top-1/2 h-2 -translate-y-1/2 bg-sky-400/15 ${
              pullRight ? "bg-sky-400/25" : ""
            }`}
            style={{
              left: CENTER_X + predictionWidth,
              width: Math.max(0, rightWidth - predictionWidth),
            }}
          />
        )}

        {predictionHours > 0 && (
          <div
            className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-r bg-sky-400/45 ${
              pullRight ? "bg-sky-400/65" : ""
            }`}
            style={{
              left: CENTER_X,
              width: predictionWidth,
            }}
          />
        )}

        <div
          className="absolute top-0 bottom-0 w-px bg-red-400/80"
          style={{ left: CENTER_X }}
        />
        <span
          className="absolute -top-0.5 text-[8px] font-semibold uppercase tracking-wide text-red-300/90"
          style={{ left: CENTER_X + 3 }}
        >
          Now
        </span>

        <button
          ref={knobRef}
          type="button"
          aria-label="Adjust chart view horizon"
          disabled={disabled}
          onPointerDown={startDrag}
          className={`absolute top-1/2 z-10 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-md ${
            disabled
              ? "cursor-not-allowed border-white/30 bg-slate-500"
              : "cursor-grab active:cursor-grabbing"
          } ${
            dragging
              ? pullLeft
                ? "scale-110 border-amber-200 bg-amber-400 shadow-amber-400/50"
                : pullRight
                  ? "scale-110 border-sky-200 bg-sky-400 shadow-sky-400/50"
                  : "scale-110 border-white/60 bg-white/90 shadow-white/30"
              : "border-white/70 bg-white/90 hover:shadow-white/40"
          } ${dragging ? "" : "transition-[left,transform,box-shadow] duration-200 ease-out"}`}
          style={{ left: knobLeft }}
        />
      </div>

      <span className="whitespace-nowrap text-[10px] text-lb-text-muted">
        <span className="text-amber-200/90">−{lookbackHours}h</span>
        {" · "}
        <span className="text-sky-200/90">+{chartForwardHours}h</span>
      </span>
    </div>
  );
}
