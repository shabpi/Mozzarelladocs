import { useEffect, useMemo, useState } from "react";
import {
  buildNowMarkerLabel,
  fetchLocationNowContext,
  getBootstrapSnapshot,
  getInstantNowContext,
  getInitialForecastLocation,
  getInitialLocationNowContext,
  getStoredForecastLocation,
  startForecastBootstrap,
} from "../utils/geolocation";

function useForecastLocationState() {
  const [forecastLocation, setForecastLocation] = useState(getInitialForecastLocation);

  useEffect(() => {
    let active = true;

    function applyLocation(location) {
      if (active && location) setForecastLocation(location);
    }

    const snapshot = getBootstrapSnapshot();
    if (snapshot?.location) applyLocation(snapshot.location);

    function onBootstrapReady(event) {
      applyLocation(event.detail?.location);
    }

    function onLocationChanged(event) {
      applyLocation(event.detail ?? getStoredForecastLocation());
    }

    function onStorage(event) {
      if (event.key !== "heatpump_forecast_location") return;
      applyLocation(getStoredForecastLocation());
    }

    window.addEventListener("forecast-bootstrap-ready", onBootstrapReady);
    window.addEventListener("forecast-location-changed", onLocationChanged);
    window.addEventListener("storage", onStorage);
    startForecastBootstrap().then((result) => applyLocation(result.location));

    return () => {
      active = false;
      window.removeEventListener("forecast-bootstrap-ready", onBootstrapReady);
      window.removeEventListener("forecast-location-changed", onLocationChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return forecastLocation;
}

export function useForecastLocation() {
  return useForecastLocationState();
}

export function useForecastBootstrap() {
  const forecastLocation = useForecastLocationState();
  const [locationNowContext, setLocationNowContext] = useState(getInitialLocationNowContext);

  useEffect(() => {
    let active = true;

    async function refreshNowForLocation(location) {
      const context =
        (await fetchLocationNowContext(location.latitude, location.longitude)) ??
        getInstantNowContext(location);
      if (active) setLocationNowContext(context);
    }

    function applyBootstrap(detail) {
      if (!active || !detail) return;
      if (detail.nowContext) setLocationNowContext(detail.nowContext);
      else if (detail.location) refreshNowForLocation(detail.location);
    }

    const snapshot = getBootstrapSnapshot();
    if (snapshot) applyBootstrap(snapshot);

    function onBootstrapReady(event) {
      applyBootstrap(event.detail);
    }

    function onLocationChanged(event) {
      const next = event.detail ?? getStoredForecastLocation();
      if (next) refreshNowForLocation(next);
    }

    function onStorage(event) {
      if (event.key !== "heatpump_forecast_location") return;
      onLocationChanged({ detail: getStoredForecastLocation() });
    }

    window.addEventListener("forecast-bootstrap-ready", onBootstrapReady);
    window.addEventListener("forecast-location-changed", onLocationChanged);
    window.addEventListener("storage", onStorage);
    startForecastBootstrap().then((result) => applyBootstrap(result));

    const interval = window.setInterval(() => {
      refreshNowForLocation(forecastLocation);
    }, 60_000);

    return () => {
      active = false;
      window.removeEventListener("forecast-bootstrap-ready", onBootstrapReady);
      window.removeEventListener("forecast-location-changed", onLocationChanged);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(interval);
    };
  }, [forecastLocation]);

  const nowMarkerLabel = useMemo(
    () => buildNowMarkerLabel(forecastLocation, locationNowContext),
    [forecastLocation, locationNowContext],
  );

  return { forecastLocation, locationNowContext, nowMarkerLabel };
}
