import OrionHologram from "./OrionHologram";

export default function SiteHeader({
  onHome,
  onOpenRoom,
  onOpenForecast,
  roomActive = false,
  forecastActive = false,
}) {
  const logo = (
    <>
      <img src="/lb-energy-logo.svg" alt="LB Energy" className="h-9 w-auto" />
      <div className="hidden sm:block">
        <p className="text-sm font-semibold text-lb-heading">LB Energy</p>
        <p className="text-xs text-lb-text-muted">Intelligent Heat Link</p>
      </div>
    </>
  );

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--surface-border)] bg-[var(--surface)]/95 backdrop-blur-md">
      <div className="flex w-full items-center gap-4 px-8 py-3">
        {onHome ? (
          <button
            type="button"
            onClick={onHome}
            className="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:bg-white/5"
            aria-label="Back to dashboard"
          >
            {logo}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">{logo}</div>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {onOpenForecast && (
            <button
              type="button"
              onClick={onOpenForecast}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                forecastActive
                  ? "border-lb-accent-blue bg-lb-accent-blue/15 text-sky-200"
                  : "border-[var(--surface-border)] text-lb-text hover:border-lb-accent-blue hover:text-sky-200"
              }`}
              aria-label="Open short-term forecast"
              title="Heat pump operation & room temperature forecast"
            >
              Forecast
            </button>
          )}
          {onOpenRoom && (
            <button
              type="button"
              onClick={onOpenRoom}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                roomActive
                  ? "border-lb-accent bg-lb-accent/15 text-lb-accent"
                  : "border-[var(--surface-border)] text-lb-text hover:border-lb-accent hover:text-lb-accent"
              }`}
              aria-label="Open 3D space view"
              title="3D temperature-regulated space"
            >
              3D Space
            </button>
          )}
          <OrionHologram className="orion-hologram--header" />
        </div>
      </div>
    </header>
  );
}
