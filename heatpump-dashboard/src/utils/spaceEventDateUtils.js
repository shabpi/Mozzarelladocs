function pad(n) {
  return String(n).padStart(2, "0");
}

export function formatDateDdMmYyyy(date) {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

export function formatTimeHhMm(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseTimeHhMm(value) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

export function normalizeTimeInput(value) {
  const parsed = parseTimeHhMm(value);
  if (!parsed) return null;
  return `${pad(parsed.hours)}:${pad(parsed.minutes)}`;
}

export function parseDateDdMmYyyy(value) {
  const match = value.trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function combineDateAndTime(dateStr, timeStr) {
  const date = parseDateDdMmYyyy(dateStr);
  const time = parseTimeHhMm(timeStr);
  if (!date || !time) return null;

  date.setHours(time.hours, time.minutes, 0, 0);
  return date;
}

export function toApiDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

export function fromApiDateTime(iso) {
  const normalized = iso.replace("T", " ").slice(0, 16);
  const [datePart, timePart] = normalized.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hours, minutes] = timePart.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

export function addHours(date, hours) {
  const next = new Date(date);
  next.setHours(next.getHours() + hours);
  return next;
}

export function formatIsoDateString(value) {
  if (!value) return "";
  const datePart = String(value).trim().slice(0, 10);
  const [year, month, day] = datePart.split("-").map(Number);
  if (!year || !month || !day) return String(value);
  return formatDateDdMmYyyy(new Date(year, month - 1, day));
}

export function formatIsoDateTimeString(value) {
  if (!value) return "";
  const raw = String(value).trim();
  const hasUtc = /\sUTC$/i.test(raw);
  const normalized = raw.replace(/\sUTC$/i, "").replace("T", " ");
  const date = fromApiDateTime(normalized.slice(0, 16));
  if (Number.isNaN(date.getTime())) return raw;
  const formatted = `${formatDateDdMmYyyy(date)} ${formatTimeHhMm(date)}`;
  return hasUtc ? `${formatted} UTC` : formatted;
}

export function formatDateRangeLabel(start, end) {
  if (!start) return "";
  if (!end) return `${formatIsoDateString(start)} – …`;
  return `${formatIsoDateString(start)} – ${formatIsoDateString(end)}`;
}

export function formatSelectionRangeLabel(
  startDate,
  startTime,
  endDate,
  endTime,
) {
  if (!startDate) return "";
  const start = `${formatIsoDateString(startDate)} ${startTime}`;
  if (!endDate) return `${start} – …`;
  return `${start} – ${formatIsoDateString(endDate)} ${endTime}`;
}

export function formatDisplayRangeText(value) {
  if (!value) return "";
  return String(value)
    .split("–")
    .map((part) => {
      const trimmed = part.trim();
      if (trimmed.length > 10) return formatIsoDateTimeString(trimmed);
      return formatIsoDateString(trimmed);
    })
    .join(" – ");
}

export function formatDayKey(dayKey) {
  return formatIsoDateString(dayKey);
}

export function formatDayKeyRange(startKey, endKey) {
  return `${formatDayKey(startKey)} – ${formatDayKey(endKey)}`;
}

export function defaultEndFromStart(start) {
  return addHours(start, 8);
}
