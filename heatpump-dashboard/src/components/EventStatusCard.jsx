import { useState } from "react";

export default function EventStatusCard({
  active,
  subtitle,
  isHovering = false,
  overlayActive,
  onToggleOverlay,
  onNavigate,
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={`relative w-full rounded-2xl border bg-[var(--surface)] shadow-[var(--shadow-card)] transition-colors ${
        overlayActive
          ? "border-lb-accent ring-2 ring-lb-accent/40"
          : "border-[var(--surface-border)]"
      }`}
      style={{ boxShadow: "var(--shadow-card), var(--shadow-glow)" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={onToggleOverlay}
        className="w-full rounded-2xl p-5 pr-12 text-left transition-colors hover:bg-white/5"
        aria-pressed={overlayActive}
      >
        <p className="text-sm text-lb-text-muted">Space Event</p>
        <div className="mt-2 flex items-center gap-3">
          <span
            className={`relative inline-flex h-3.5 w-3.5 rounded-full ${
              active ? "bg-emerald-400" : "bg-red-500"
            }`}
            aria-hidden="true"
          >
            {active && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            )}
          </span>
          <span className="text-3xl font-bold text-lb-heading">
            {active ? "Active" : "Inactive"}
          </span>
        </div>
        {subtitle && (
          <p className={`mt-2 text-sm ${isHovering ? "text-lb-accent/90" : "text-lb-text-muted"}`}>
            {subtitle}
          </p>
        )}
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onNavigate();
        }}
        className={`absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg text-2xl font-bold text-lb-accent transition-all hover:bg-lb-accent/15 ${
          hovered ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-label="View event schedule"
        tabIndex={hovered ? 0 : -1}
      >
        →
      </button>
    </div>
  );
}
