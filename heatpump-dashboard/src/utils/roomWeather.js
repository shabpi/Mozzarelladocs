const weatherCache = new Map();
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ARCHIVE_CHUNK_DAYS = 90;

function hourKey(timestampMs, timeZone) {
  const date = new Date(timestampMs);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:00`;
}

function dateKey(timestampMs, timeZone) {
  const date = new Date(timestampMs);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "01";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function weatherCodeToCondition(code) {
  if (code == null) return "cloudy";
  if (code === 0) return "clear";
  if (code <= 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80) return "rain";
  return "cloudy";
}

export function deriveWeatherFromHour(entry) {
  if (!entry) {
    return { condition: "cloudy", isDay: true, precipitation: 0, cloudCover: 60 };
  }

  const condition = weatherCodeToCondition(entry.weatherCode);
  const isDay = entry.isDay ?? 1;
  return {
    condition,
    isDay: Boolean(isDay),
    precipitation: entry.precipitation ?? 0,
    cloudCover: entry.cloudCover ?? 50,
  };
}

function defaultWeatherForTimestamp(timestampMs) {
  const hour = new Date(timestampMs ?? Date.now()).getHours();
  return {
    condition: "cloudy",
    isDay: hour >= 6 && hour < 20,
    precipitation: 0,
    cloudCover: 55,
  };
}

function parseHourlyPayload(payload) {
  const hourly = payload.hourly ?? {};
  const map = {};

  hourly.time?.forEach((time, index) => {
    map[time] = {
      weatherCode: hourly.weather_code?.[index],
      isDay: hourly.is_day?.[index],
      precipitation: hourly.precipitation?.[index] ?? 0,
      cloudCover: hourly.cloud_cover?.[index] ?? 0,
    };
  });

  return map;
}

/** Span of non-forecast (measured) timeseries points. */
export function resolveMeasuredDataSpan(points, referenceAtMs = null) {
  const measuredMs = (points ?? [])
    .filter((point) => !point?.forecast)
    .map((point) => Date.parse(String(point.timestamp ?? "").replace(" ", "T")))
    .filter((ms) => Number.isFinite(ms));

  if (measuredMs.length === 0) {
    return { startMs: null, endMs: null };
  }

  const startMs = Math.min(...measuredMs);
  let endMs = Math.max(...measuredMs);

  if (referenceAtMs != null) {
    endMs = Math.min(endMs, referenceAtMs);
  }

  if (endMs < startMs) {
    return { startMs: null, endMs: null };
  }

  return { startMs, endMs };
}

async function fetchArchiveChunk(latitude, longitude, startMs, endMs, timeZone) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start_date: dateKey(startMs, timeZone),
    end_date: dateKey(endMs, timeZone),
    hourly: "weather_code,is_day,precipitation,cloud_cover",
    timezone: "auto",
  });

  const response = await fetch(
    `https://archive-api.open-meteo.com/v1/archive?${params}`,
  );
  if (!response.ok) return {};
  const payload = await response.json();
  return parseHourlyPayload(payload);
}

async function fetchHistoricalWeather(
  latitude,
  longitude,
  startMs,
  endMs,
  timeZone,
) {
  if (
    latitude == null ||
    longitude == null ||
    startMs == null ||
    endMs == null ||
    endMs < startMs
  ) {
    return {};
  }

  const map = {};
  let chunkStart = startMs;

  while (chunkStart <= endMs) {
    const chunkEnd = Math.min(
      endMs,
      chunkStart + ARCHIVE_CHUNK_DAYS * MS_PER_DAY - 1,
    );
    const chunk = await fetchArchiveChunk(
      latitude,
      longitude,
      chunkStart,
      chunkEnd,
      timeZone,
    );
    Object.assign(map, chunk);
    chunkStart = chunkEnd + MS_PER_DAY;
  }

  return map;
}

async function fetchForecastWeather(
  latitude,
  longitude,
  referenceAtMs,
  horizonDays,
) {
  if (latitude == null || longitude == null || referenceAtMs == null) {
    return {};
  }

  const forecastParams = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: "weather_code,is_day,precipitation,cloud_cover",
    forecast_days: String(horizonDays),
    timezone: "auto",
  });

  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?${forecastParams}`,
  );
  if (!response.ok) return {};

  const payload = await response.json();
  const map = {};
  const hourly = payload.hourly ?? {};
  const horizonEndMs = referenceAtMs + horizonDays * MS_PER_DAY;

  hourly.time?.forEach((time, index) => {
    const bucketMs = Date.parse(time);
    if (Number.isNaN(bucketMs) || bucketMs <= referenceAtMs || bucketMs > horizonEndMs) {
      return;
    }
    map[time] = {
      weatherCode: hourly.weather_code?.[index],
      isDay: hourly.is_day?.[index],
      precipitation: hourly.precipitation?.[index] ?? 0,
      cloudCover: hourly.cloud_cover?.[index] ?? 0,
    };
  });

  return map;
}

/**
 * Fetch weather for the 3D room:
 * - Open-Meteo archive for measured dataset history (start..min(end, now))
 * - Open-Meteo forecast for the next `horizonDays` from reference (now)
 */
export async function fetchWeatherForRange(
  latitude,
  longitude,
  referenceAtMs,
  horizonDays = 7,
  datasetStartMs = null,
  datasetEndMs = null,
  timeZone = "Europe/Berlin",
) {
  if (latitude == null || longitude == null || referenceAtMs == null) {
    return {};
  }

  const historicEndMs =
    datasetEndMs != null ? Math.min(datasetEndMs, referenceAtMs) : null;
  const cacheKey = [
    latitude.toFixed(3),
    longitude.toFixed(3),
    referenceAtMs,
    horizonDays,
    datasetStartMs ?? "none",
    historicEndMs ?? "none",
    timeZone,
  ].join(":");

  if (weatherCache.has(cacheKey)) return weatherCache.get(cacheKey);

  const [historical, forecast] = await Promise.all([
    fetchHistoricalWeather(
      latitude,
      longitude,
      datasetStartMs,
      historicEndMs,
      timeZone,
    ),
    fetchForecastWeather(latitude, longitude, referenceAtMs, horizonDays),
  ]);

  const map = { ...historical, ...forecast };
  weatherCache.set(cacheKey, map);
  return map;
}

function lookupNearestEntry(weatherMap, timestampMs, timeZone, filterFn = null) {
  const key = hourKey(timestampMs, timeZone);
  const entry = weatherMap[key];
  if (entry) return entry;

  const keys = Object.keys(weatherMap).sort();
  let nearestKey = null;
  let nearestDistance = Infinity;
  const target = Date.parse(`${key}:00`.replace(" ", "T"));

  for (const candidate of keys) {
    const candidateMs = Date.parse(candidate);
    if (filterFn && !filterFn(candidateMs)) continue;
    const distance = Math.abs(candidateMs - target);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestKey = candidate;
    }
  }

  return nearestKey ? weatherMap[nearestKey] : null;
}

export function getWeatherAtTimestamp(
  weatherMap,
  timestampMs,
  timeZone = "Europe/Berlin",
  referenceAtMs = null,
  datasetStartMs = null,
  datasetEndMs = null,
  horizonDays = 7,
) {
  if (timestampMs == null) return defaultWeatherForTimestamp(Date.now());

  const refMs = referenceAtMs ?? Date.now();
  const historicEndMs =
    datasetEndMs != null ? Math.min(datasetEndMs, refMs) : null;
  const inMeasuredHistory =
    datasetStartMs != null &&
    historicEndMs != null &&
    timestampMs >= datasetStartMs &&
    timestampMs <= historicEndMs;
  const forecastHorizonEndMs = refMs + horizonDays * MS_PER_DAY;
  const inForecastWindow = timestampMs > refMs && timestampMs <= forecastHorizonEndMs;

  if (!inMeasuredHistory && !inForecastWindow) {
    return defaultWeatherForTimestamp(timestampMs);
  }

  if (!weatherMap || Object.keys(weatherMap).length === 0) {
    return defaultWeatherForTimestamp(timestampMs);
  }

  const filterFn = inMeasuredHistory && !inForecastWindow
    ? (candidateMs) => candidateMs <= refMs
    : inForecastWindow && !inMeasuredHistory
      ? (candidateMs) => candidateMs > refMs
      : null;

  const entry = lookupNearestEntry(weatherMap, timestampMs, timeZone, filterFn);
  if (entry) return deriveWeatherFromHour(entry);

  return defaultWeatherForTimestamp(timestampMs);
}
