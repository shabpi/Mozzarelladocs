const DEFAULT_LOCATION = { latitude: 48.1351, longitude: 11.5820 };

export const DEFAULT_FORECAST_LOCATION = {
  latitude: DEFAULT_LOCATION.latitude,
  longitude: DEFAULT_LOCATION.longitude,
  label: "Munich",
  timezone: "Europe/Berlin",
};

const FORECAST_LOCATION_STORAGE_KEY = "heatpump_forecast_location";
const DEVICE_LOCATION_SESSION_KEY = "heatpump_device_location";
const BOOTSTRAP_SESSION_KEY = "heatpump_forecast_bootstrap";

let bootstrapPromise = null;
let bootstrapResult = null;

function readSessionJson(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSessionJson(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / private mode
  }
}

export function getStoredForecastLocation() {
  try {
    const raw = localStorage.getItem(FORECAST_LOCATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.latitude == null || parsed?.longitude == null) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setStoredForecastLocation(location) {
  const stored = {
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    label: location.label?.trim() || "Custom location",
    timezone: location.timezone?.trim() || undefined,
  };
  localStorage.setItem(FORECAST_LOCATION_STORAGE_KEY, JSON.stringify(stored));
  window.dispatchEvent(
    new CustomEvent("forecast-location-changed", { detail: stored }),
  );
}

export function getInitialForecastLocation() {
  const stored = getStoredForecastLocation();
  if (stored) {
    const isLegacyAmsterdam =
      Math.abs(stored.latitude - 52.3676) < 0.001 &&
      Math.abs(stored.longitude - 4.9041) < 0.001;
    if (isLegacyAmsterdam) return DEFAULT_FORECAST_LOCATION;
    return stored;
  }
  return DEFAULT_FORECAST_LOCATION;
}

export function getInstantNowContext(location = getInitialForecastLocation()) {
  const timeZone =
    location?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";

  const now = new Date();
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const hour = timeParts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = timeParts.find((part) => part.type === "minute")?.value ?? "00";

  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = dateParts.find((part) => part.type === "year")?.value ?? "1970";
  const month = dateParts.find((part) => part.type === "month")?.value ?? "01";
  const day = dateParts.find((part) => part.type === "day")?.value ?? "01";

  const timezoneAbbreviation =
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      timeZoneName: "short",
    })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value ?? "";

  return {
    timezone: timeZone,
    timezoneAbbreviation,
    localTime: `${hour}:${minute}`,
    localDate: `${year}-${month}-${day}`,
  };
}

export function getInitialLocationNowContext() {
  const cached = readSessionJson(BOOTSTRAP_SESSION_KEY);
  if (cached?.nowContext) return cached.nowContext;
  return getInstantNowContext(getInitialForecastLocation());
}

export function getBootstrapSnapshot() {
  return bootstrapResult;
}

export function getClientLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(DEFAULT_LOCATION);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => resolve(DEFAULT_LOCATION),
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 600_000 },
    );
  });
}

export async function resolveForecastLocation() {
  const stored = getStoredForecastLocation();
  if (stored) return stored;

  const sessionDevice = readSessionJson(DEVICE_LOCATION_SESSION_KEY);
  if (sessionDevice?.latitude != null && sessionDevice?.longitude != null) {
    return sessionDevice;
  }

  const deviceLocation = await getClientLocation();
  const location = {
    ...deviceLocation,
    label: "Device location",
  };
  writeSessionJson(DEVICE_LOCATION_SESSION_KEY, location);
  return location;
}

export function startForecastBootstrap() {
  if (bootstrapResult) {
    return Promise.resolve(bootstrapResult);
  }

  if (!bootstrapPromise) {
    const initial = getInitialForecastLocation();

    bootstrapPromise = (async () => {
      const [location, initialNowContext] = await Promise.all([
        resolveForecastLocation(),
        fetchLocationNowContext(initial.latitude, initial.longitude),
      ]);

      let nowContext = initialNowContext;
      const locationChanged =
        location.latitude !== initial.latitude ||
        location.longitude !== initial.longitude;

      if (locationChanged) {
        nowContext = await fetchLocationNowContext(
          location.latitude,
          location.longitude,
        );
      }

      nowContext = nowContext ?? getInstantNowContext(location);

      bootstrapResult = { location, nowContext };
      writeSessionJson(BOOTSTRAP_SESSION_KEY, bootstrapResult);

      window.dispatchEvent(
        new CustomEvent("forecast-bootstrap-ready", { detail: bootstrapResult }),
      );

      return bootstrapResult;
    })().catch((error) => {
      bootstrapPromise = null;
      const fallback = {
        location: initial,
        nowContext: getInstantNowContext(initial),
      };
      bootstrapResult = fallback;
      return fallback;
    });
  }

  return bootstrapPromise;
}

export async function searchForecastLocations(query) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const params = new URLSearchParams({
    name: trimmed,
    count: "8",
    language: "en",
    format: "json",
  });
  const response = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?${params}`,
  );
  if (!response.ok) return [];

  const payload = await response.json();
  return (payload.results ?? []).map((result) => ({
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone,
    label: [result.name, result.admin1, result.country]
      .filter(Boolean)
      .join(", "),
  }));
}

export async function fetchLocationNowContext(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "time",
    timezone: "auto",
  });

  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?${params}`,
    );
    if (!response.ok) return null;

    const payload = await response.json();
    const localTimeStr = payload.current?.time;
    if (!localTimeStr) return null;

    const [, timePart = "00:00"] = localTimeStr.split("T");
    const [hours, minutes] = timePart.split(":");

    return {
      timezone: payload.timezone,
      timezoneAbbreviation: payload.timezone_abbreviation,
      localTime: `${hours}:${minutes}`,
      localDate: localTimeStr.split("T")[0],
    };
  } catch {
    return null;
  }
}

export function buildNowMarkerLabel(location, context) {
  if (!context) return "Now";

  const place = location?.label?.split(",")[0]?.trim() || "Location";
  const tz = context.timezoneAbbreviation || context.timezone || "";
  return `Now · ${place} · ${context.localTime}${tz ? ` ${tz}` : ""}`;
}
