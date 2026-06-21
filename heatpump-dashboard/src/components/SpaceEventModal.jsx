import { useEffect, useState } from "react";
import {
  combineDateAndTime,
  defaultEndFromStart,
  formatDateDdMmYyyy,
  formatTimeHhMm,
  fromApiDateTime,
  toApiDateTime,
} from "../utils/spaceEventDateUtils";

const DEFAULT_TARGET_TEMP_C = 21;

function defaultStartValues() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = defaultEndFromStart(start);
  return {
    startDate: formatDateDdMmYyyy(start),
    startTime: formatTimeHhMm(start),
    endDate: formatDateDdMmYyyy(end),
    endTime: formatTimeHhMm(end),
  };
}

function valuesFromEvent(event) {
  const start = fromApiDateTime(event.startsAt);
  const end = fromApiDateTime(event.endsAt);
  return {
    startDate: formatDateDdMmYyyy(start),
    startTime: formatTimeHhMm(start),
    endDate: formatDateDdMmYyyy(end),
    endTime: formatTimeHhMm(end),
  };
}

function DateTimeField({ label, dateValue, timeValue, onDateChange, onTimeChange }) {
  return (
    <div className="space-y-2">
      <span className="text-sm text-lb-text-muted">{label}</span>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          inputMode="numeric"
          placeholder="dd.mm.yyyy"
          value={dateValue}
          onChange={(e) => onDateChange(e.target.value)}
          required
          className="w-full rounded-lg border border-[var(--surface-border)] bg-lb-bg px-3 py-2 text-lb-text"
        />
        <input
          type="text"
          inputMode="numeric"
          placeholder="hh:mm"
          value={timeValue}
          onChange={(e) => onTimeChange(e.target.value)}
          required
          className="w-full rounded-lg border border-[var(--surface-border)] bg-lb-bg px-3 py-2 text-lb-text"
        />
      </div>
    </div>
  );
}

export default function SpaceEventModal({
  open,
  event = null,
  onClose,
  onSubmit,
  submitting,
}) {
  const isEditing = Boolean(event?.id);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [targetTemperatureC, setTargetTemperatureC] = useState(
    String(DEFAULT_TARGET_TEMP_C),
  );
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;

    if (event) {
      const values = valuesFromEvent(event);
      setName(event.name ?? "");
      setStartDate(values.startDate);
      setStartTime(values.startTime);
      setEndDate(values.endDate);
      setEndTime(values.endTime);
      setTargetTemperatureC(
        event.targetTemperatureC != null
          ? String(event.targetTemperatureC)
          : String(DEFAULT_TARGET_TEMP_C),
      );
    } else {
      const values = defaultStartValues();
      setName("");
      setStartDate(values.startDate);
      setStartTime(values.startTime);
      setEndDate(values.endDate);
      setEndTime(values.endTime);
      setTargetTemperatureC(String(DEFAULT_TARGET_TEMP_C));
    }
    setError(null);
  }, [open, event]);

  function syncEndIfNeeded(nextStartDate, nextStartTime, currentEndDate, currentEndTime) {
    const start = combineDateAndTime(nextStartDate, nextStartTime);
    const end = combineDateAndTime(currentEndDate, currentEndTime);
    if (!start || !end || start < end) {
      return { endDate: currentEndDate, endTime: currentEndTime };
    }
    const adjusted = defaultEndFromStart(start);
    return {
      endDate: formatDateDdMmYyyy(adjusted),
      endTime: formatTimeHhMm(adjusted),
    };
  }

  function handleStartDateChange(value) {
    setStartDate(value);
    const adjusted = syncEndIfNeeded(value, startTime, endDate, endTime);
    setEndDate(adjusted.endDate);
    setEndTime(adjusted.endTime);
  }

  function handleStartTimeChange(value) {
    setStartTime(value);
    const adjusted = syncEndIfNeeded(startDate, value, endDate, endTime);
    setEndDate(adjusted.endDate);
    setEndTime(adjusted.endTime);
  }

  if (!open) return null;

  async function handleSubmit(formEvent) {
    formEvent.preventDefault();
    setError(null);

    const start = combineDateAndTime(startDate, startTime);
    const end = combineDateAndTime(endDate, endTime);
    if (!start || !end) {
      setError("Use dd.mm.yyyy for dates and hh:mm for times.");
      return;
    }
    if (end <= start) {
      setError("End time must be after start time.");
      return;
    }

    const targetTemp = Number.parseFloat(targetTemperatureC);
    if (!Number.isFinite(targetTemp)) {
      setError("Enter a valid target temperature in °C.");
      return;
    }

    try {
      await onSubmit({
        id: event?.id,
        name: name.trim() || "Untitled event",
        startsAt: toApiDateTime(start),
        endsAt: toApiDateTime(end),
        targetTemperatureC: targetTemp,
      });
    } catch (submitError) {
      setError(submitError.message || "Could not save event.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-card)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="space-event-title"
      >
        <h2 id="space-event-title" className="text-xl font-bold text-lb-heading">
          {isEditing ? "Edit space event" : "Add space event"}
        </h2>
        <p className="mt-1 text-sm text-lb-text-muted">
          {isEditing
            ? "Update this planned occupied period."
            : "Schedule a new occupied period for the space."}
        </p>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm">
            <span className="text-lb-text-muted">Event name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Team workshop"
              className="mt-1 w-full rounded-lg border border-[var(--surface-border)] bg-lb-bg px-3 py-2 text-lb-text"
            />
          </label>

          <DateTimeField
            label="Starts"
            dateValue={startDate}
            timeValue={startTime}
            onDateChange={handleStartDateChange}
            onTimeChange={handleStartTimeChange}
          />

          <DateTimeField
            label="Ends"
            dateValue={endDate}
            timeValue={endTime}
            onDateChange={setEndDate}
            onTimeChange={setEndTime}
          />

          <label className="block text-sm">
            <span className="text-lb-text-muted">Target temperature (°C)</span>
            <input
              type="number"
              step="0.5"
              min="5"
              max="40"
              value={targetTemperatureC}
              onChange={(e) => setTargetTemperatureC(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-[var(--surface-border)] bg-lb-bg px-3 py-2 text-lb-text"
            />
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--surface-border)] px-4 py-2 text-sm text-lb-text transition-colors hover:border-lb-accent hover:text-lb-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-lb-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : isEditing ? "Save changes" : "Add event"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
