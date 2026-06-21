import { useState } from "react";
import {
  co2RingProgress,
  getCo2Quality,
  hasCo2Reading,
  normalizeCo2Ppm,
} from "../utils/co2Utils";

function Co2Ring({ ppm, size = 112, strokeWidth = 10 }) {
  const quality = getCo2Quality(ppm);
  const progress = co2RingProgress(ppm);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0 -rotate-90"
      aria-hidden
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={strokeWidth}
      />
      {hasCo2Reading(ppm) && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={quality.color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-all duration-300"
        />
      )}
    </svg>
  );
}

export default function Co2LevelCard({
  ppm,
  subtitle,
  isHovering = false,
  dimmed = false,
  overlayActive,
  onToggleOverlay,
  onNavigate,
  readOnly = false,
  stretchVertical = false,
  overlayToggleEnabled,
}) {
  const displayPpm = normalizeCo2Ppm(ppm);
  const quality = getCo2Quality(displayPpm);
  const readingAvailable = hasCo2Reading(ppm) && !dimmed;
  const canToggleOverlay =
    overlayToggleEnabled != null ? overlayToggleEnabled : readingAvailable;
  const [hovered, setHovered] = useState(false);
  const ringSize = stretchVertical ? 136 : 112;
  const valueLabel = dimmed && !hasCo2Reading(ppm) ? "—" : String(Math.round(displayPpm));
  const qualityLabel = dimmed && !hasCo2Reading(ppm) ? "Not available" : quality.label;
  const qualityColor = dimmed && !hasCo2Reading(ppm) ? "#94a3b8" : quality.color;

  return (
    <div
      className={`relative w-full rounded-2xl border bg-[var(--surface)] shadow-[var(--shadow-card)] transition-colors ${
        stretchVertical ? "xl:flex xl:min-h-0 xl:flex-1 xl:flex-col" : ""
      } ${
        overlayActive
          ? "border-emerald-400 ring-2 ring-emerald-400/40"
          : "border-[var(--surface-border)]"
      } ${dimmed ? "opacity-50" : ""}`}
      style={{ boxShadow: "var(--shadow-card), var(--shadow-glow)" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={readOnly || !canToggleOverlay ? undefined : onToggleOverlay}
        disabled={readOnly || !canToggleOverlay}
        className={`flex w-full rounded-2xl p-5 text-left transition-colors ${
          stretchVertical ? "xl:min-h-0 xl:flex-1 xl:flex-col xl:justify-between" : ""
        } ${readOnly || !canToggleOverlay ? "cursor-default" : "pr-12 hover:bg-white/5"}`}
        aria-pressed={readOnly || !canToggleOverlay ? undefined : overlayActive}
      >
        <p className="text-sm text-lb-text-muted">CO₂ Level</p>

        <div
          className={`flex items-center justify-center ${
            stretchVertical ? "xl:min-h-0 xl:flex-1 xl:py-4" : "mt-3"
          }`}
        >
          <div className="relative flex items-center justify-center">
            <Co2Ring ppm={displayPpm} size={ringSize} strokeWidth={stretchVertical ? 11 : 10} />
            <div className="absolute inset-0 flex flex-col items-center justify-center px-2 text-center">
              <span
                className={`font-bold leading-none text-lb-heading ${
                  stretchVertical ? "text-3xl" : "text-2xl"
                }`}
              >
                {valueLabel}
              </span>
              <span className="mt-0.5 text-[10px] uppercase tracking-wide text-lb-text-muted">
                ppm
              </span>
            </div>
          </div>
        </div>

        <div className={stretchVertical ? "shrink-0" : undefined}>
          <p
            className={`text-center text-sm font-medium ${stretchVertical ? "" : "mt-2"}`}
            style={{ color: qualityColor }}
          >
            {qualityLabel}
          </p>
          {subtitle && (
            <p
              className={`mt-1 text-center text-xs ${
                dimmed
                  ? "text-lb-text-muted/70"
                  : isHovering
                    ? "text-emerald-200/90"
                    : "text-lb-text-muted"
              }`}
            >
              {subtitle}
            </p>
          )}
          {!isHovering && !dimmed && (
            <p className="mt-1 text-center text-[10px] text-lb-text-muted/80">
              {quality.description}
            </p>
          )}
          {overlayActive && !readOnly && (
            <p className="mt-2 text-center text-xs text-emerald-300/90">
              CO₂ series shown on chart
            </p>
          )}
        </div>
      </button>

      {onNavigate && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate();
          }}
          className={`absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg text-2xl font-bold text-lb-accent transition-all hover:bg-lb-accent/15 ${
            hovered ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-label="View CO₂ details"
          tabIndex={hovered ? 0 : -1}
        >
          →
        </button>
      )}
    </div>
  );
}
