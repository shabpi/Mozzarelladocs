import { useEffect, useMemo, useRef, useState } from "react";
import { formatDayKeyRange, normalizeTimeInput } from "../utils/spaceEventDateUtils";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const WEEKS_IN_VIEW = 4;
const DAYS_IN_VIEW = WEEKS_IN_VIEW * 7;
const MONTHS_IN_OVERVIEW = 12;

function parseDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfMondayWeek(date) {
  const d = new Date(date);
  const weekday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - weekday);
  return d;
}

function monthKey(year, month) {
  return `${year}-${month}`;
}

function isBetweenDates(dayKey, startDate, endDate) {
  if (!startDate || !endDate) return false;
  const day = parseDate(dayKey).getTime();
  const lo = Math.min(parseDate(startDate).getTime(), parseDate(endDate).getTime());
  const hi = Math.max(parseDate(startDate).getTime(), parseDate(endDate).getTime());
  return day >= lo && day <= hi;
}

function TimeInput({ label, value, onChange }) {
  return (
    <label className="mb-2 block text-left last:mb-0">
      <span className="mb-1 block text-xs font-medium text-lb-heading">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        placeholder="hh:mm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          const normalized = normalizeTimeInput(e.target.value);
          if (normalized) onChange(normalized);
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded border border-[var(--surface-border)] bg-lb-bg px-2 py-1 text-sm text-lb-text"
      />
    </label>
  );
}

function DayCell({
  dayNumber,
  dayClass,
  showTimePicker,
  isRangeStart,
  isRangeEnd,
  startTime,
  endTime,
  onStartTimeChange,
  onEndTimeChange,
  onClick,
  ariaLabel,
  mutedLabel,
}) {
  const [showPicker, setShowPicker] = useState(false);
  const hideTimer = useRef(null);

  function openPicker() {
    clearTimeout(hideTimer.current);
    setShowPicker(true);
  }

  function scheduleClose() {
    hideTimer.current = setTimeout(() => setShowPicker(false), 120);
  }

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const content = (
    <>
      {mutedLabel && (
        <span className="mb-0.5 block text-[9px] uppercase text-lb-text-muted/70">
          {mutedLabel}
        </span>
      )}
      {dayNumber}
    </>
  );

  if (!showTimePicker) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={dayClass}
        aria-label={ariaLabel}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className="relative flex justify-center"
      onMouseEnter={openPicker}
      onMouseLeave={scheduleClose}
    >
      <button type="button" onClick={onClick} className={dayClass} aria-label={ariaLabel}>
        {content}
      </button>
      {showPicker && (
        <div
          className="absolute left-1/2 top-full z-30 w-40 -translate-x-1/2 pt-2"
          onMouseEnter={openPicker}
          onMouseLeave={scheduleClose}
        >
          <div className="rounded-lg border border-[var(--surface-border)] bg-lb-bg-elevated p-3 shadow-lg">
            {isRangeStart && (
              <TimeInput
                label="Start time (24h)"
                value={startTime}
                onChange={onStartTimeChange}
              />
            )}
            {isRangeEnd && (
              <TimeInput
                label="End time (24h)"
                value={endTime}
                onChange={onEndTimeChange}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function getDayClass({
  dayKey,
  isSelectable,
  hasData,
  selectionStart,
  selectionEnd,
  hasGlobalSelection,
  todayKey,
}) {
  const isStart = selectionStart === dayKey;
  const isEnd = selectionEnd === dayKey;
  const inSelection = isBetweenDates(dayKey, selectionStart, selectionEnd);
  const isToday = todayKey && dayKey === todayKey;

  let dayClass =
    "flex h-9 w-full items-center justify-center text-xs transition-colors ";

  if (!isSelectable) {
    if (isToday) {
      return dayClass + "rounded-md font-semibold text-lb-text ring-1 ring-lb-accent/60 cursor-default";
    }
    return dayClass + "rounded-md text-lb-text-muted/30 cursor-default";
  }

  if (isStart && isEnd) {
    dayClass += hasData
      ? "rounded-md bg-lb-accent font-semibold text-white cursor-pointer"
      : "rounded-md border border-dashed border-lb-accent bg-lb-accent/70 font-semibold text-white cursor-pointer";
  } else if (isStart) {
    dayClass += hasData
      ? "rounded-l-md bg-lb-accent font-semibold text-white cursor-pointer"
      : "rounded-l-md border border-dashed border-lb-accent bg-lb-accent/70 font-semibold text-white cursor-pointer";
  } else if (isEnd) {
    dayClass += hasData
      ? "rounded-r-md bg-lb-accent font-semibold text-white cursor-pointer"
      : "rounded-r-md border border-dashed border-lb-accent bg-lb-accent/70 font-semibold text-white cursor-pointer";
  } else if (inSelection) {
    dayClass += hasData
      ? "rounded-none bg-lb-accent/45 font-medium text-white hover:bg-lb-accent/60 cursor-pointer"
      : "rounded-none border-y border-dashed border-lb-accent/50 bg-lb-accent/25 font-medium text-white hover:bg-lb-accent/40 cursor-pointer";
  } else if (!hasGlobalSelection) {
    dayClass += hasData
      ? "rounded-md text-lb-text hover:bg-white/10 cursor-pointer"
      : "rounded-md border border-dashed border-white/15 text-lb-text-muted hover:bg-white/10 cursor-pointer";
  } else {
    dayClass += hasData
      ? "rounded-md text-lb-text hover:bg-white/10 cursor-pointer"
      : "rounded-md border border-dashed border-white/20 text-lb-text-muted hover:bg-white/10 cursor-pointer";
  }

  if (isToday && !isStart && !isEnd && !inSelection) {
    dayClass += " ring-1 ring-lb-accent/70";
  }

  return dayClass;
}

function WeekGrid({
  days,
  availableSet,
  selectionStart,
  selectionEnd,
  startTime,
  endTime,
  todayKey,
  onDayClick,
  onStartTimeChange,
  onEndTimeChange,
}) {
  const hasGlobalSelection = Boolean(selectionStart || selectionEnd);
  const monthsInView = new Set(days.map((d) => d.getMonth()));
  const showSplitHeaders = monthsInView.size > 1;

  let lastMonth = null;

  return (
    <div className="space-y-3">
      {showSplitHeaders && (
        <p className="text-xs text-lb-text-muted">
          Showing {WEEKS_IN_VIEW} weeks across{" "}
          {monthsInView.size === 1 ? "one month" : "two months"}
        </p>
      )}
      <div className="grid grid-cols-7 gap-px text-center text-xs">
        {WEEKDAYS.map((label) => (
          <span key={label} className="py-1 text-lb-text-muted">
            {label}
          </span>
        ))}
        {days.map((date) => {
          const dayKey = toDayKey(date);
          const hasData = availableSet.has(dayKey);
          const monthChanged = lastMonth !== null && lastMonth !== date.getMonth();
          lastMonth = date.getMonth();

          const monthLabel =
            showSplitHeaders && (date.getDate() <= 7 || monthChanged)
              ? date.toLocaleString("en", { month: "short" })
              : null;

          const isStart = selectionStart === dayKey;
          const isEnd = selectionEnd === dayKey;
          const showStartPicker = isStart && selectionEnd;
          const showEndPicker = isEnd && selectionEnd;

          return (
            <DayCell
              key={dayKey}
              dayNumber={date.getDate()}
              mutedLabel={monthLabel}
              dayClass={getDayClass({
                dayKey,
                isSelectable: true,
                hasData,
                selectionStart,
                selectionEnd,
                hasGlobalSelection,
                todayKey,
              })}
              showTimePicker={showStartPicker || showEndPicker}
              isRangeStart={showStartPicker}
              isRangeEnd={showEndPicker}
              startTime={startTime}
              endTime={endTime}
              onStartTimeChange={onStartTimeChange}
              onEndTimeChange={onEndTimeChange}
              onClick={() => onDayClick(dayKey)}
              ariaLabel={`Select ${dayKey}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function SingleMonthGrid({
  year,
  month,
  availableSet,
  selectionStart,
  selectionEnd,
  startTime,
  endTime,
  todayKey,
  onDayClick,
  onStartTimeChange,
  onEndTimeChange,
}) {
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = new Date(year, month, 1).toLocaleString("en", {
    month: "long",
    year: "numeric",
  });

  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(year, month, day));
  }

  const hasGlobalSelection = Boolean(selectionStart || selectionEnd);

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-lb-heading">{monthLabel}</p>
      <div className="grid grid-cols-7 gap-px text-center text-xs">
        {WEEKDAYS.map((label) => (
          <span key={label} className="py-1 text-lb-text-muted">
            {label}
          </span>
        ))}
        {cells.map((date, index) => {
          if (!date) return <span key={`empty-${index}`} />;

          const dayKey = toDayKey(date);
          const hasData = availableSet.has(dayKey);
          const isStart = selectionStart === dayKey;
          const isEnd = selectionEnd === dayKey;
          const showStartPicker = isStart && selectionEnd;
          const showEndPicker = isEnd && selectionEnd;

          return (
            <DayCell
              key={dayKey}
              dayNumber={date.getDate()}
              dayClass={getDayClass({
                dayKey,
                isSelectable: true,
                hasData,
                selectionStart,
                selectionEnd,
                hasGlobalSelection,
                todayKey,
              })}
              showTimePicker={showStartPicker || showEndPicker}
              isRangeStart={showStartPicker}
              isRangeEnd={showEndPicker}
              startTime={startTime}
              endTime={endTime}
              onStartTimeChange={onStartTimeChange}
              onEndTimeChange={onEndTimeChange}
              onClick={() => onDayClick(dayKey)}
              ariaLabel={`Select ${dayKey}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function MonthOverviewCard({ year, month, dataCount, onSelect }) {
  const label = new Date(year, month, 1).toLocaleString("en", {
    month: "short",
    year: "numeric",
  });

  return (
    <button
      type="button"
      onClick={() => onSelect(year, month)}
      className="rounded-lg border border-[var(--surface-border)] p-2 text-left transition-colors hover:border-lb-accent hover:bg-white/5"
    >
      <p className="text-xs font-medium text-lb-heading">{label}</p>
      {dataCount > 0 ? (
        <p className="mt-1 text-[10px] text-lb-text-muted">{dataCount} days of data</p>
      ) : (
        <p className="mt-1 text-[10px] text-lb-text-muted">No data</p>
      )}
    </button>
  );
}

function YearOverviewCard({ year, dataCount, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(year)}
      className="rounded-lg border border-[var(--surface-border)] p-3 text-center transition-colors hover:border-lb-accent hover:bg-white/5"
    >
      <p className="text-lg font-semibold text-lb-heading">{year}</p>
      {dataCount > 0 ? (
        <p className="mt-1 text-xs text-lb-text-muted">{dataCount} days of data</p>
      ) : (
        <p className="mt-1 text-xs text-lb-text-muted">No data</p>
      )}
    </button>
  );
}

function computeInitialWeekAnchor(availableDates, selectionStart, selectionEnd) {
  const focus =
    selectionStart || selectionEnd || availableDates[0] || "2026-01-01";
  return toDayKey(startOfMondayWeek(parseDate(focus)));
}

function buildWeekWindow(weekAnchorKey) {
  const start = parseDate(weekAnchorKey);
  return Array.from({ length: DAYS_IN_VIEW }, (_, i) => addDays(start, i));
}

function weekWindowSpansTwoMonths(days) {
  const months = new Set(days.map((d) => `${d.getFullYear()}-${d.getMonth()}`));
  return months.size > 1;
}

function allDaysSameMonth(days) {
  const months = new Set(days.map((d) => `${d.getFullYear()}-${d.getMonth()}`));
  return months.size === 1;
}

export default function TimeframeCalendar({
  startDate,
  endDate,
  availableDates,
  selectionStart,
  selectionEnd,
  startTime,
  endTime,
  onDayClick,
  onStartTimeChange,
  onEndTimeChange,
  onClearRange,
}) {
  const availableSet = useMemo(() => new Set(availableDates), [availableDates]);

  const todayKey = toDayKey(new Date());

  const [viewMode, setViewMode] = useState("weeks");
  const [weekAnchor, setWeekAnchor] = useState(() =>
    computeInitialWeekAnchor(availableDates, selectionStart, selectionEnd),
  );
  const [pinnedMonth, setPinnedMonth] = useState(null);
  const [monthOverviewStart, setMonthOverviewStart] = useState(() => {
    const first = parseDate(availableDates[0] || startDate);
    return { year: first.getFullYear(), month: first.getMonth() };
  });

  useEffect(() => {
    if (selectionStart) {
      setWeekAnchor(
        toDayKey(startOfMondayWeek(parseDate(selectionStart))),
      );
    }
  }, [selectionStart]);

  const weekDays = useMemo(() => buildWeekWindow(weekAnchor), [weekAnchor]);

  const dataMinYear = useMemo(
    () => Number.parseInt(startDate.slice(0, 4), 10),
    [startDate],
  );
  const dataMaxYear = useMemo(
    () => Number.parseInt(endDate.slice(0, 4), 10),
    [endDate],
  );

  const [yearsAnchor, setYearsAnchor] = useState(() => dataMinYear - 2);

  const yearsInOverview = useMemo(() => {
    const years = [];
    for (let i = 0; i < 8; i += 1) {
      years.push(yearsAnchor + i);
    }
    return years;
  }, [yearsAnchor]);

  const minYearsAnchor = dataMinYear - 10;
  const maxYearsAnchor = dataMaxYear + 10;

  const monthOverviewMonths = useMemo(() => {
    const items = [];
    let { year, month } = monthOverviewStart;
    for (let i = 0; i < MONTHS_IN_OVERVIEW; i += 1) {
      items.push({ year, month });
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }
    return items;
  }, [monthOverviewStart]);

  function goToToday() {
    const today = new Date();
    setViewMode("weeks");
    setPinnedMonth({ year: today.getFullYear(), month: today.getMonth() });
    setWeekAnchor(toDayKey(startOfMondayWeek(today)));
    setMonthOverviewStart({ year: today.getFullYear(), month: today.getMonth() });
  }

  function shiftWeeks(direction) {
    setPinnedMonth(null);
    setWeekAnchor((current) =>
      toDayKey(addDays(parseDate(current), direction * DAYS_IN_VIEW)),
    );
  }

  function shiftMonthOverview(direction) {
    setMonthOverviewStart(({ year, month }) => {
      let m = month + direction * MONTHS_IN_OVERVIEW;
      let y = year;
      while (m < 0) {
        m += 12;
        y -= 1;
      }
      while (m > 11) {
        m -= 12;
        y += 1;
      }
      return { year: y, month: m };
    });
  }

  function focusMonth(year, month) {
    setWeekAnchor(toDayKey(startOfMondayWeek(new Date(year, month, 1))));
    setPinnedMonth({ year, month });
    setViewMode("weeks");
  }

  function focusYear(year) {
    setMonthOverviewStart({ year, month: 0 });
    setViewMode("months");
  }

  const weekRangeLabel = formatDayKeyRange(
    toDayKey(weekDays[0]),
    toDayKey(weekDays[weekDays.length - 1]),
  );

  const monthGridTarget = pinnedMonth ?? (allDaysSameMonth(weekDays)
    ? { year: weekDays[0].getFullYear(), month: weekDays[0].getMonth() }
    : null);

  return (
    <div
      className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-card)]"
      style={{ boxShadow: "var(--shadow-card), var(--shadow-glow)" }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={goToToday}
          className="text-left text-lg font-semibold text-lb-heading transition-colors hover:text-lb-accent"
          title="Go to today"
        >
          Timeframe
        </button>
        <div className="flex rounded-lg border border-[var(--surface-border)] text-[10px]">
          {[
            { id: "weeks", label: "4 wks" },
            { id: "months", label: "12 mo" },
            { id: "years", label: "Years" },
          ].map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setViewMode(id)}
              className={`px-2 py-1 transition-colors ${
                viewMode === id
                  ? "bg-lb-accent text-white"
                  : "text-lb-text-muted hover:text-lb-text"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {viewMode === "weeks" && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftWeeks(-1)}
              className="rounded border border-[var(--surface-border)] px-2 py-1 text-xs text-lb-text"
            >
              ←
            </button>
            <p className="text-xs text-lb-text-muted">{weekRangeLabel}</p>
            <button
              type="button"
              onClick={() => shiftWeeks(1)}
              className="rounded border border-[var(--surface-border)] px-2 py-1 text-xs text-lb-text"
            >
              →
            </button>
          </div>

          {monthGridTarget ? (
            <SingleMonthGrid
              year={monthGridTarget.year}
              month={monthGridTarget.month}
              availableSet={availableSet}
              selectionStart={selectionStart}
              selectionEnd={selectionEnd}
              startTime={startTime}
              endTime={endTime}
              todayKey={todayKey}
              onDayClick={onDayClick}
              onStartTimeChange={onStartTimeChange}
              onEndTimeChange={onEndTimeChange}
            />
          ) : (
            <WeekGrid
              days={weekDays}
              availableSet={availableSet}
              selectionStart={selectionStart}
              selectionEnd={selectionEnd}
              startTime={startTime}
              endTime={endTime}
              todayKey={todayKey}
              onDayClick={onDayClick}
              onStartTimeChange={onStartTimeChange}
              onEndTimeChange={onEndTimeChange}
            />
          )}

          {weekWindowSpansTwoMonths(weekDays) && !monthGridTarget && (
            <p className="mt-2 text-[10px] text-lb-text-muted">
              Spanning two months — last weeks of the first and first weeks of
              the second.
            </p>
          )}
        </>
      )}

      {viewMode === "months" && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonthOverview(-1)}
              className="rounded border border-[var(--surface-border)] px-2 py-1 text-xs text-lb-text"
            >
              ←
            </button>
            <p className="text-xs text-lb-text-muted">12-month overview</p>
            <button
              type="button"
              onClick={() => shiftMonthOverview(1)}
              className="rounded border border-[var(--surface-border)] px-2 py-1 text-xs text-lb-text"
            >
              →
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {monthOverviewMonths.map(({ year, month }) => {
              const count = availableDates.filter((d) => {
                const dt = parseDate(d);
                return dt.getFullYear() === year && dt.getMonth() === month;
              }).length;
              return (
                <MonthOverviewCard
                  key={monthKey(year, month)}
                  year={year}
                  month={month}
                  dataCount={count}
                  onSelect={focusMonth}
                />
              );
            })}
          </div>
        </>
      )}

      {viewMode === "years" && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() =>
                setYearsAnchor((current) => Math.max(minYearsAnchor, current - 8))
              }
              disabled={yearsAnchor <= minYearsAnchor}
              className="rounded border border-[var(--surface-border)] px-2 py-1 text-xs text-lb-text disabled:opacity-30"
            >
              ←
            </button>
            <p className="text-xs text-lb-text-muted">
              {yearsInOverview[0]} – {yearsInOverview[yearsInOverview.length - 1]}
            </p>
            <button
              type="button"
              onClick={() =>
                setYearsAnchor((current) => Math.min(maxYearsAnchor - 7, current + 8))
              }
              disabled={yearsAnchor >= maxYearsAnchor - 7}
              className="rounded border border-[var(--surface-border)] px-2 py-1 text-xs text-lb-text disabled:opacity-30"
            >
              →
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {yearsInOverview.map((year) => {
              const count = availableDates.filter((d) => d.startsWith(`${year}-`)).length;
              return (
                <YearOverviewCard
                  key={year}
                  year={year}
                  dataCount={count}
                  onSelect={focusYear}
                />
              );
            })}
          </div>
        </>
      )}

      {(selectionStart || selectionEnd) && (
        <button
          type="button"
          onClick={onClearRange}
          className="mt-4 w-full rounded-lg border border-[var(--surface-border)] px-3 py-2 text-sm text-lb-text transition-colors hover:border-lb-accent hover:text-lb-accent"
        >
          View full range
        </button>
      )}
    </div>
  );
}
