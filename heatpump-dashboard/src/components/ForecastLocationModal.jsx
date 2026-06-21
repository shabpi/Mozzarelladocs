import { useEffect, useState } from "react";
import {
  getClientLocation,
  searchForecastLocations,
  setStoredForecastLocation,
} from "../utils/geolocation";

export default function ForecastLocationModal({
  open,
  currentLocation,
  onClose,
  onSave,
}) {
  const [label, setLabel] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLabel(currentLocation?.label ?? "");
    setLatitude(String(currentLocation?.latitude ?? ""));
    setLongitude(String(currentLocation?.longitude ?? ""));
    setSearchQuery("");
    setSearchResults([]);
    setError("");
  }, [currentLocation, open]);

  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  async function handleSearch(event) {
    event.preventDefault();
    setSearching(true);
    setError("");
    try {
      const results = await searchForecastLocations(searchQuery);
      setSearchResults(results);
      if (results.length === 0) {
        setError("No locations found. Try another city name.");
      }
    } catch {
      setError("Could not search locations. Check your connection.");
    } finally {
      setSearching(false);
    }
  }

  function applySearchResult(result) {
    setLabel(result.label);
    setLatitude(String(result.latitude));
    setLongitude(String(result.longitude));
    setSearchResults([]);
    setSearchQuery("");
  }

  async function handleUseDeviceLocation() {
    setSaving(true);
    setError("");
    try {
      const deviceLocation = await getClientLocation();
      const nextLocation = {
        latitude: deviceLocation.latitude,
        longitude: deviceLocation.longitude,
        label: "Device location",
      };
      setStoredForecastLocation(nextLocation);
      onSave(nextLocation);
      onClose();
    } catch {
      setError("Could not read device location.");
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setError("Enter a valid latitude between -90 and 90.");
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      setError("Enter a valid longitude between -180 and 180.");
      return;
    }

    const nextLocation = {
      latitude: lat,
      longitude: lon,
      label: label.trim() || "Custom location",
    };
    setStoredForecastLocation(nextLocation);
    onSave(nextLocation);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-card)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="forecast-location-title"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="forecast-location-title" className="text-xl font-bold text-lb-heading">
              Forecast location
            </h2>
            <p className="mt-1 text-sm text-lb-text-muted">
              Outside temperature forecasts use this location for future events.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--surface-border)] px-2 py-1 text-sm text-lb-text-muted hover:text-lb-text"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSearch} className="mb-4 space-y-2">
          <label className="block text-xs font-medium uppercase tracking-wide text-lb-text-muted">
            Search city
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Amsterdam, Berlin, London…"
              className="min-w-0 flex-1 rounded-lg border border-[var(--surface-border)] bg-black/20 px-3 py-2 text-sm text-lb-text outline-none focus:border-sky-400"
            />
            <button
              type="submit"
              disabled={searching || searchQuery.trim().length < 2}
              className="rounded-lg border border-sky-400/50 bg-sky-500/10 px-3 py-2 text-sm text-sky-200 disabled:opacity-50"
            >
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
        </form>

        {searchResults.length > 0 && (
          <ul className="mb-4 max-h-40 overflow-y-auto rounded-lg border border-[var(--surface-border)]">
            {searchResults.map((result) => (
              <li key={`${result.latitude}-${result.longitude}-${result.label}`}>
                <button
                  type="button"
                  onClick={() => applySearchResult(result)}
                  className="w-full px-3 py-2 text-left text-sm text-lb-text transition-colors hover:bg-white/5"
                >
                  {result.label}
                  <span className="ml-2 text-xs text-lb-text-muted">
                    ({result.latitude.toFixed(2)}, {result.longitude.toFixed(2)})
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-lb-text-muted">
              Label
            </label>
            <input
              type="text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="w-full rounded-lg border border-[var(--surface-border)] bg-black/20 px-3 py-2 text-sm text-lb-text outline-none focus:border-sky-400"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-lb-text-muted">
                Latitude
              </label>
              <input
                type="number"
                step="any"
                value={latitude}
                onChange={(event) => setLatitude(event.target.value)}
                className="w-full rounded-lg border border-[var(--surface-border)] bg-black/20 px-3 py-2 text-sm text-lb-text outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-lb-text-muted">
                Longitude
              </label>
              <input
                type="number"
                step="any"
                value={longitude}
                onChange={(event) => setLongitude(event.target.value)}
                className="w-full rounded-lg border border-[var(--surface-border)] bg-black/20 px-3 py-2 text-sm text-lb-text outline-none focus:border-sky-400"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-300">{error}</p>}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-lb-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Save location
            </button>
            <button
              type="button"
              onClick={handleUseDeviceLocation}
              disabled={saving}
              className="rounded-lg border border-[var(--surface-border)] px-4 py-2 text-sm text-lb-text hover:border-sky-400 hover:text-sky-200 disabled:opacity-50"
            >
              Use device location
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--surface-border)] px-4 py-2 text-sm text-lb-text-muted hover:text-lb-text"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
