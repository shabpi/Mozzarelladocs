import { useState } from "react";

export default function KpiCard({ title, value, unit, subtitle, subtitleTooltip }) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]"
      style={{ boxShadow: "var(--shadow-card), var(--shadow-glow)" }}
    >
      <p className="text-sm text-lb-text-muted">{title}</p>
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
          <p className="text-sm text-lb-text-muted">{subtitle}</p>
          {subtitleTooltip && showTooltip && (
            <div className="absolute bottom-full left-0 z-20 mb-2 w-max max-w-[14rem] rounded-lg border border-[var(--surface-border)] bg-lb-bg-elevated px-3 py-2 text-xs leading-relaxed text-lb-text shadow-lg">
              {subtitleTooltip}
            </div>, 
          )}
        </div>
      )}
    </div>
  );
}

