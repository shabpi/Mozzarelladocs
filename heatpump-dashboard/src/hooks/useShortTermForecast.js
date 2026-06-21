import { useCallback, useEffect, useRef, useState } from "react";
import { getShortTermForecast } from "../api";

export const SHORT_TERM_FORECAST_POLL_MS = 15 * 60 * 1000;
export const DEFAULT_FORECAST_HOURS = 6;
export const FORECAST_HOUR_OPTIONS = [2, 4, 6, 8, 12, 24];

export function useShortTermForecast({
  hours = DEFAULT_FORECAST_HOURS,
  referenceAt,
  latitude,
  longitude,
  model = "simple",
  dummyPreset,
  pollMs = SHORT_TERM_FORECAST_POLL_MS,
  enabled = true,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const payload = await getShortTermForecast({
        hours,
        referenceAt,
        latitude,
        longitude,
        model,
        dummyPreset,
      });
      if (requestId !== requestIdRef.current) return;
      setData(payload);
      setLastFetchedAt(Date.now());
    } catch (fetchError) {
      if (requestId !== requestIdRef.current) return;
      console.error(fetchError);
      setError("Could not load short-term forecast. Check that the backend is running.");
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [dummyPreset, hours, latitude, longitude, model, referenceAt]);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    const interval = window.setInterval(refresh, pollMs);
    return () => window.clearInterval(interval);
  }, [enabled, pollMs, refresh]);

  return {
    data,
    loading,
    error,
    lastFetchedAt,
    refresh,
    pollMs,
  };
}
