import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_FORECAST_HOURS,
  FORECAST_HOUR_OPTIONS,
  SHORT_TERM_FORECAST_POLL_MS,
  useShortTermForecast,
} from "../hooks/useShortTermForecast";
import { formatIsoDateTimeString } from "../utils/spaceEventDateUtils";
import LoadingIndicator from "./LoadingIndicator";

const MODE_STYLES = {
  heat: {
    label: "Heat",
    badge: "bg-orange-500/20 text-orange-200 border-orange-400/40",
    dot: "bg-orange-400",
  },
  cool: {
    label: "Cool",
    badge: "bg-sky-500/20 text-sky-200 border-sky-400/40",
    dot: "bg-sky-400",
  },
  idle: {
    label: "Idle",
    badge: "bg-slate-500/20 text-slate-200 border-slate-400/40",
    dot: "bg-slate-400",
  },
};

function formatPollInterval(ms) {
  const minutes = Math.round(ms / 60_000);
  return `${minutes} min`;
}

function formatCountdown(ms) {
  if (ms <= 0) return "now";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function OperationModeBadge({ mode }) {
  const style = MODE_STYLES[mode] ?? MODE_STYLES.idle;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.badge}`}
    >
      <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden />
      {style.label}
    </span>
  );
}

export default function ForecastDetailView({
  onBack,
  forecastLocation,
  referenceAt,
}) {
  const [horizonHours, setHorizonHours] = useState(DEFAULT_FORECAST_HOURS);
  const [nextRefreshIn, setNextRefreshIn] = useState(SHORT_TERM_FORECAST_POLL_MS);

  const { data, loading, error, lastFetchedAt, refresh, pollMs } = useShortTermForecast({
    hours: horizonHours,
    referenceAt,
    latitude: forecastLocation?.latitude,
    longitude: forecastLocation?.longitude,
  });

  useEffect(() => {
    if (!lastFetchedAt) return undefined;
    const tick = () => {
      const elapsed = Date.now() - lastFetchedAt;
      setNextRefreshIn(Math.max(0, pollMs - elapsed));
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [lastFetchedAt, pollMs]);

  const modeSummary = useMemo(() => {
    const counts = { heat: 0, cool: 0, idle: 0 };
    for (const slot of data?.slots ?? []) {
      counts[slot.operationMode] = (counts[slot.operationMode] ?? 0) + 1;
    }
    return counts;
  }, [data?.slots]);

  return (
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
            <h1 className="gradient-heading text-3xl font-bold">Short-term forecast</h1>
            <p className="text-sm text-lb-text-muted">
              Heat pump operation &amp; room temperature · {horizonHours}h horizon ·{" "}
              {data?.intervalMinutes ?? 15} min steps
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-lb-text-muted">
            Horizon
            <select
              value={horizonHours}
              onChange={(event) => setHorizonHours(Number(event.target.value))}
              className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-lb-text"
            >
              {FORECAST_HOUR_OPTIONS.map((hours) => (
                <option key={hours} value={hours}>
                  {hours} h
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="rounded-lg border border-[var(--surface-border)] px-3 py-1.5 text-sm text-lb-text transition-colors hover:border-lb-accent hover:text-lb-accent disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      <section className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div
          className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5"
          style={{ boxShadow: "var(--shadow-card), var(--shadow-glow)" }}
        >
          <p className="text-sm text-lb-text-muted">Starting inside temp</p>
          <p className="mt-2 text-3xl font-bold text-lb-heading">
            {data?.startingInsideTempC != null ? `${data.startingInsideTempC}°C` : "—"}
          </p>
        </div>
        <div
          className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5"
          style={{ boxShadow: "var(--shadow-card), var(--shadow-glow)" }}
        >
          <p className="text-sm text-lb-text-muted">Reference (now)</p>
          <p className="mt-2 text-lg font-semibold text-lb-heading">
            {data?.referenceAt ? formatIsoDateTimeString(data.referenceAt) : "—"}
          </p>
        </div>
        <div
          className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5"
          style={{ boxShadow: "var(--shadow-card), var(--shadow-glow)" }}
        >
          <p className="text-sm text-lb-text-muted">Auto-refresh</p>
          <p className="mt-2 text-lg font-semibold text-lb-heading">
            Every {formatPollInterval(pollMs)}
          </p>
          <p className="mt-1 text-xs text-lb-text-muted">
            Next refresh in {formatCountdown(nextRefreshIn)}
          </p>
        </div>
        <div
          className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5"
          style={{ boxShadow: "var(--shadow-card), var(--shadow-glow)" }}
        >
          <p className="text-sm text-lb-text-muted">Mode mix</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <OperationModeBadge mode="heat" />
            <span className="text-sm text-lb-text-muted">{modeSummary.heat}</span>
            <OperationModeBadge mode="cool" />
            <span className="text-sm text-lb-text-muted">{modeSummary.cool}</span>
            <OperationModeBadge mode="idle" />
            <span className="text-sm text-lb-text-muted">{modeSummary.idle}</span>
          </div>
        </div>
      </section>

      {loading && !data?.slots?.length ? (
        <LoadingIndicator label="Loading forecast…" />
      ) : (
        <section
          className={`overflow-hidden rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] ${
            loading ? "opacity-70" : ""
          }`}
          style={{ boxShadow: "var(--shadow-card), var(--shadow-glow)" }}
        >
          <div className="border-b border-[var(--surface-border)] px-5 py-4">
            <h2 className="text-lg font-semibold text-lb-heading">15-minute forecast</h2>
            <p className="text-sm text-lb-text-muted">
              {forecastLocation?.label ?? "Munich"}
              {data?.weatherSource ? ` · weather: ${data.weatherSource}` : ""}
              {data?.generatedAt
                ? ` · updated ${formatIsoDateTimeString(data.generatedAt)}`
                : ""}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--surface-border)] text-left text-xs uppercase tracking-wide text-lb-text-muted">
                  <th className="px-5 py-3 font-medium">Time</th>
                  <th className="px-5 py-3 font-medium">Operation mode</th>
                  <th className="px-5 py-3 font-medium">Inside temp (forecast)</th>
                  <th className="hidden px-5 py-3 font-medium md:table-cell">Target</th>
                  <th className="hidden px-5 py-3 font-medium lg:table-cell">Outside</th>
                </tr>
              </thead>
              <tbody>
                {(data?.slots ?? []).map((slot) => (
                  <tr
                    key={slot.timestamp}
                    className="border-b border-white/5 transition-colors hover:bg-white/[0.03]"
                  >
                    <td className="whitespace-nowrap px-5 py-3 text-lb-text">
                      {formatIsoDateTimeString(slot.timestamp)}
                    </td>
                    <td className="px-5 py-3">
                      <OperationModeBadge mode={slot.operationMode} />
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-lg font-semibold text-lb-heading">
                        {slot.insideTempC}°C
                      </span>
                    </td>
                    <td className="hidden px-5 py-3 text-lb-text-muted md:table-cell">
                      {slot.targetTempC != null ? `${slot.targetTempC}°C` : "—"}
                    </td>
                    <td className="hidden px-5 py-3 text-lb-text-muted lg:table-cell">
                      {slot.outsideTempC != null ? `${slot.outsideTempC}°C` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!loading && (data?.slots ?? []).length === 0 && (
            <p className="px-5 py-8 text-center text-lb-text-muted">
              No forecast slots returned for this horizon.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
