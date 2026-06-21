import { useState } from "react";

export default function ComfortMaintainedCard({
  value,
  unit,
  subtitle,
  subtitleTooltip,
  isHovering = false,
  overlayActive,
  onToggleOverlay,
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className={`relative w-full rounded-2xl border bg-[var(--surface)] shadow-[var(--shadow-card)] transition-colors ${
        overlayActive
          ? "border-emerald-400 ring-2 ring-emerald-400/40"
          : "border-[var(--surface-border)]"
      }`}
      style={{ boxShadow: "var(--shadow-card), var(--shadow-glow)" }}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        type="button"
        onClick={onToggleOverlay}
        className="w-full rounded-2xl p-5 text-left transition-colors hover:bg-white/5"
        aria-pressed={overlayActive}
      >
        <p className="text-sm text-lb-text-muted">Comfort Maintained</p>
        <div className="mt-2 flex items-end gap-1">
          <span className="text-3xl font-bold text-lb-heading">{value}</span>
          {unit && <span className="mb-1 text-sm text-lb-text">{unit}</span>}
        </div>
        {subtitle && (
          <div
            className="relative mt-2"
            onMouseEnter={() => subtitleTooltip && setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
          >
            <p className={`text-sm ${isHovering ? "text-emerald-200/90" : "text-lb-text-muted"}`}>
              {subtitle}
            </p>
            {subtitleTooltip && showTooltip && (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-max max-w-[14rem] rounded-lg border border-[var(--surface-border)] bg-lb-bg-elevated px-3 py-2 text-xs leading-relaxed text-lb-text shadow-lg">
                {subtitleTooltip}
              </div>
            )}
          </div>
        )}
        {overlayActive && (
          <p className="mt-2 text-xs text-emerald-300/90">
            Target vs inside delta highlighted on chart
          </p>
        )}
      </button>
    </div>
  );
}
