const API_BASE = "/api";

function withRangeParams(range = {}) {
  const params = new URLSearchParams();
  if (range.start) params.set("start", range.start);
  if (range.end) params.set("end", range.end);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function getOverview(range) {
  const res = await fetch(`${API_BASE}/overview${withRangeParams(range)}`);
  if (!res.ok) throw new Error("Failed to fetch overview");
  return res.json();
}

export async function getTimeseries(range, options = {}) {
  const params = new URLSearchParams();
  if (range.start) params.set("start", range.start);
  if (range.end) params.set("end", range.end);
  if (options.referenceAt) params.set("referenceAt", options.referenceAt);
  if (options.forecastFuture) params.set("forecastFuture", "true");
  if (options.latitude != null) params.set("latitude", String(options.latitude));
  if (options.longitude != null) params.set("longitude", String(options.longitude));
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/timeseries${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch timeseries");
  return res.json();
}

export async function getSpaceEvents(referenceAt, range = {}, options = {}) {
  const params = new URLSearchParams();
  if (referenceAt) params.set("referenceAt", referenceAt);
  if (range.start) params.set("start", range.start);
  if (range.end) params.set("end", range.end);
  if (options.latitude != null) params.set("latitude", String(options.latitude));
  if (options.longitude != null) params.set("longitude", String(options.longitude));
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/space-events${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch space events");
  return res.json();
}

function apiErrorMessage(detail, fallback) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg).join(", ") || fallback;
  }
  return fallback;
}

export async function createSpaceEvent(payload) {
  const res = await fetch(`${API_BASE}/space-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(body.detail, "Failed to create space event"));
  }
  return res.json();
}

export async function updateSpaceEvent(eventId, payload, referenceAt) {
  const params = new URLSearchParams();
  if (referenceAt) params.set("referenceAt", referenceAt);
  const qs = params.toString();
  const res = await fetch(
    `${API_BASE}/space-events/${eventId}${qs ? `?${qs}` : ""}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(body.detail, "Failed to update space event"));
  }
  return res.json();
}

export async function deleteSpaceEvent(eventId, referenceAt) {
  const params = new URLSearchParams();
  if (referenceAt) params.set("referenceAt", referenceAt);
  const qs = params.toString();
  const res = await fetch(
    `${API_BASE}/space-events/${eventId}${qs ? `?${qs}` : ""}`,
    {
      method: "DELETE",
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(body.detail, "Failed to delete space event"));
  }
  return res.json();
}

export async function getShortTermForecast({
  hours = 6,
  referenceAt,
  latitude,
  longitude,
  model = "simple",
  dummyPreset,
} = {}) {
  const params = new URLSearchParams();
  params.set("hours", String(hours));
  params.set("model", model);
  if (referenceAt) params.set("referenceAt", referenceAt);
  if (latitude != null) params.set("latitude", String(latitude));
  if (longitude != null) params.set("longitude", String(longitude));
  if (dummyPreset && dummyPreset !== "off") params.set("dummyPreset", dummyPreset);
  const res = await fetch(`${API_BASE}/short-term-forecast?${params}`);
  if (!res.ok) throw new Error("Failed to fetch short-term forecast");
  return res.json();
}

export async function predictHeating(input) {
  const res = await fetch(`${API_BASE}/predict`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to predict heating");
  return res.json();
}

export function buildRangeQuery(startDate, startTime, endDate, endTime) {
  if (!startDate || !endDate) return {};
  return {
    start: `${startDate}T${startTime}:00`,
    end: `${endDate}T${endTime}:59`,
  };
}
