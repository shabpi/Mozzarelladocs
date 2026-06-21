import { formatIsoDateTimeString } from "../utils/spaceEventDateUtils";
import { getOperationModeStyle } from "../utils/operationModeUtils";

const SCALE_MIN = 0;
const SCALE_MAX = 35;

function barWidth(value) {
  if (value == null) return 0;
  const pct = ((value - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
  return Math.min(100, Math.max(0, pct));
}

function formatTimestamp(value) {
  if (!value) return null;
  return formatIsoDateTimeString(value);
}

function TempBar({
  label,
  value,
  color,
  active,
  toggleable,
  onToggle,
  showValues,
}) {
  const content = (
    <>
      <span
        className={`w-24 shrink-0 text-left text-xs ${
          active && showValues ? "font-medium text-lb-heading" : "text-lb-text-muted"
        }`}
      >
        {label}
      </span>
      <div className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
        {showValues && value != null && (
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-150"
            style={{
              width: `${barWidth(value)}%`,
              backgroundColor: color,
              opacity: active ? 1 : 0.35,
            }}
          />
        )}
      </div>
      <span
        className={`w-12 shrink-0 text-right text-sm font-semibold ${
          showValues && value != null ? "text-lb-heading" : "text-lb-text-muted/40"
        }`}
      >
        {showValues && value != null ? `${value}°` : ""}
      </span>
    </>
  );

  if (toggleable) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        className={`flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-white/5 ${
          active ? "ring-1 ring-white/20" : ""
        }`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex w-full items-center gap-2 px-1 py-1.5">
      {content}
    </div>
  );
}

export default function TemperatureBarsCard({
  values,
  isHovering,
  showOutsideOnChart,
  showReturnOnChart,
  onToggleOutside,
  onToggleReturn,
}) {
  const hasData =
    values &&
    (values.insideC != null ||
      values.targetC != null ||
      values.outsideC != null ||
      values.returnC != null);

  return (
    <div
      className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]"
      style={{ boxShadow: "var(--shadow-card), var(--shadow-glow)" }}
    >
      <p className="text-sm text-lb-text-muted">Temperatures</p>
      <div className="mt-3 space-y-1">
        <TempBar
          label={values?.targetIsStandby ? "Target (standby)" : "Target"}
          value={values?.targetC}
          color="#0b75b7"
          active
          toggleable={false}
          showValues={values?.targetC != null}
        />
        <TempBar
          label={
            values?.insideIsForecast ? "Inside (forecast)" : "Inside"
          }
          value={values?.insideC}
          color="#ff6148"
          active
          toggleable={false}
          showValues={values?.insideC != null}
        />
        <TempBar
          label="Recorded"
          value={values?.returnC}
          color="#a78bfa"
          active={showReturnOnChart}
          toggleable
          showValues={values?.returnC != null}
          onToggle={onToggleReturn}
        />
        <TempBar
          label={values?.outsideIsForecast ? "Outside (forecast)" : "Outside"}
          value={values?.outsideC}
          color="#38bdf8"
          active={showOutsideOnChart}
          toggleable
          showValues={values?.outsideC != null}
          onToggle={onToggleOutside}
        />
      </div>
      {values?.operationMode && (
        <p className="mt-2 text-xs">
          <span className="text-lb-text-muted">Heat pump: </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${getOperationModeStyle(values.operationMode).badge}`}
          >
            {getOperationModeStyle(values.operationMode).label}
          </span>
        </p>
      )}
      {hasData && values?.timestamp && (
        <p className="mt-3 text-xs text-lb-text-muted">
          {isHovering ? "At" : "Last reading:"} {formatTimestamp(values.timestamp)}
        </p>
      )}
      {!hasData && isHovering && (
        <p className="mt-3 text-xs text-lb-text-muted">No data at this point</p>
      )}
      <p className="mt-1 text-[10px] text-lb-text-muted/80">
        Hover chart to inspect · click outside or recorded to toggle on chart
      </p>
    </div>
  );
}
