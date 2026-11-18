import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchFeedVehicles, fetchRouteMap } from "../lib/api";
import { formatLastUpdated, formatObservationAge } from "../lib/formatters";
import {
  getPollingIntervalMs,
  useDocumentVisibility,
  usePollingVisibilityRefresh,
} from "../lib/polling";
import { useAppStore } from "../stores/appStore";
import type { RouteMapStop } from "../types/transit";

const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

export function MapView() {
  const selectedFeedSlug = useAppStore((state) => state.selectedFeedSlug);
  const selectedRouteId = useAppStore((state) => state.selectedRouteId);
  const selectedRouteFeedSlug = useAppStore(
    (state) => state.selectedRouteFeedSlug,
  );
  const selectedStop = useAppStore((state) => state.selectedStop);
  const setSelectedStop = useAppStore((state) => state.setSelectedStop);
  const selectedVehicleId = useAppStore((state) => state.selectedVehicleId);
  const setSelectedVehicleId = useAppStore((state) => state.setSelectedVehicleId);
  const liveStatus = useAppStore((state) => state.liveStatus);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const lastFittedRouteRef = useRef<string | null>(null);

  const tileUrl = import.meta.env.VITE_MAP_TILE_URL || DEFAULT_TILE_URL;
  const routeFeedSlug = selectedRouteFeedSlug ?? selectedFeedSlug;
  const hasSeparateLiveFeed = Boolean(
    selectedRouteId && selectedFeedSlug && routeFeedSlug !== selectedFeedSlug,
  );
  const pollingInterval = getPollingIntervalMs();
  const isPollingEnabled = Boolean(routeFeedSlug && selectedRouteId);
  const isFeedOverviewEnabled = Boolean(
    selectedFeedSlug && (!selectedRouteId || hasSeparateLiveFeed),
  );
  const isVisible = useDocumentVisibility();

  const {
    data: routeMapData,
    dataUpdatedAt,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["routeMap", routeFeedSlug, selectedRouteId],
    queryFn: () => fetchRouteMap(routeFeedSlug!, selectedRouteId!),
    enabled: isPollingEnabled,
    refetchInterval: () => {
      // Pause redundant 30s background polling when feed WebSocket is actively connected
      if (!isPollingEnabled || !isVisible || liveStatus === "connected") {
        return false;
      }
      return pollingInterval;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const feedVehiclesQuery = useQuery({
    queryKey: ["feedVehicles", selectedFeedSlug],
    queryFn: () => fetchFeedVehicles(selectedFeedSlug!),
    enabled: isFeedOverviewEnabled,
    refetchInterval: () =>
      isFeedOverviewEnabled && isVisible ? pollingInterval : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const routeVehicles = routeMapData?.vehicles ?? [];
  const liveRouteVehicles = hasSeparateLiveFeed
    ? (feedVehiclesQuery.data ?? []).filter(
        (vehicle) => vehicle.route_id === selectedRouteId,
      )
    : [];
  const displayedVehicles = selectedRouteId
    ? [...routeVehicles, ...liveRouteVehicles]
    : feedVehiclesQuery.data ?? [];
  const activeDataUpdatedAt =
    hasSeparateLiveFeed
      ? feedVehiclesQuery.dataUpdatedAt
      : selectedRouteId
        ? dataUpdatedAt
        : feedVehiclesQuery.dataUpdatedAt;
  const activeIsLoading = selectedRouteId
    ? isLoading || (hasSeparateLiveFeed && feedVehiclesQuery.isLoading)
    : feedVehiclesQuery.isLoading;
  const activeIsFetching = selectedRouteId
    ? isFetching || (hasSeparateLiveFeed && feedVehiclesQuery.isFetching)
    : feedVehiclesQuery.isFetching;
  const activeError =
    selectedRouteId && isError
      ? error
      : hasSeparateLiveFeed || !selectedRouteId
        ? feedVehiclesQuery.error
        : error;
  const activeHasData = selectedRouteId
    ? routeMapData !== undefined || feedVehiclesQuery.data !== undefined
    : feedVehiclesQuery.data !== undefined;
  const hasError = selectedRouteId
    ? isError || (hasSeparateLiveFeed && feedVehiclesQuery.isError)
    : feedVehiclesQuery.isError || Boolean(feedVehiclesQuery.error);
  const refreshActiveMap = selectedRouteId && !hasSeparateLiveFeed
    ? refetch
    : hasSeparateLiveFeed
      ? async () => {
          await Promise.all([refetch(), feedVehiclesQuery.refetch()]);
        }
      : feedVehiclesQuery.refetch;

  usePollingVisibilityRefresh(
    isPollingEnabled || isFeedOverviewEnabled,
    () => {
      void refreshActiveMap();
    },
    isVisible,
  );

  // 1. Initialize Leaflet map instance once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) {
      return;
    }

    const map = L.map(mapContainerRef.current, {
      // Delhi is the configured demo feed and gives the map a useful starting
      // view while the first live positions are loading.
      center: [28.6139, 77.209],
      zoom: 10,
      attributionControl: true,
      zoomControl: true,
    });

    L.tileLayer(tileUrl, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;
    layerGroupRef.current = layerGroup;

    // Invalidate size when window resizes
    const handleResize = () => {
      map.invalidateSize();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      map.remove();
      mapInstanceRef.current = null;
      layerGroupRef.current = null;
    };
  }, [tileUrl]);

  // 2. Render route shapes, stops, and vehicles when routeMapData changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) {
      return;
    }

    layerGroup.clearLayers();

    if (!routeMapData && !feedVehiclesQuery.data) {
      return;
    }

    const boundsPoints: L.LatLngTuple[] = [];

    // 2a. Render true GTFS shape polylines (never fabricated from stops)
    if (routeMapData?.shapes && routeMapData.shapes.length > 0) {
      for (const shape of routeMapData.shapes) {
        const polylinePoints: L.LatLngTuple[] = shape.points.map((p) => [
          p.latitude,
          p.longitude,
        ]);
        if (polylinePoints.length > 0) {
          boundsPoints.push(...polylinePoints);
          L.polyline(polylinePoints, {
            color: routeMapData.route_color || "#3b82f6",
            weight: 4,
            opacity: 0.85,
            lineJoin: "round",
          }).addTo(layerGroup);
        }
      }
    }

    // 2b. Render route stops
    if (routeMapData?.stops) {
      for (const stop of routeMapData.stops) {
        boundsPoints.push([stop.latitude, stop.longitude]);
        const isSelected = selectedStop?.stop_id === stop.stop_id;

        const marker = L.circleMarker([stop.latitude, stop.longitude], {
          radius: isSelected ? 8 : 6,
          color: isSelected ? "#60a5fa" : "#ffffff",
          fillColor: isSelected ? "#2563eb" : "#1e293b",
          fillOpacity: 0.95,
          weight: isSelected ? 3 : 2,
        });

        marker.bindTooltip(
          `<div><strong>${stop.name}</strong>${stop.code ? ` (#${stop.code})` : ""}<br/><span style="font-size:11px;color:#94a3b8">Sequence ${stop.stop_sequence}</span></div>`,
          { direction: "top", offset: [0, -6] },
        );

        marker.on("click", () => {
          setSelectedStop({
            stop_id: stop.stop_id,
            code: stop.code,
            name: stop.name,
            description: null,
            latitude: stop.latitude,
            longitude: stop.longitude,
            parent_station_id: null,
            location_type: 0,
            wheelchair_boarding: stop.wheelchair_boarding,
            platform_code: null,
            timezone: null,
          }, routeFeedSlug);
        });

        marker.addTo(layerGroup);
      }
    }

    // A stop can also be selected from Stop Explorer while no route is active.
    // Keep that selection visible and navigable on the map in that case.
    if (
      selectedStop &&
      !routeMapData?.stops.some((stop) => stop.stop_id === selectedStop.stop_id)
    ) {
      const marker = L.circleMarker(
        [selectedStop.latitude, selectedStop.longitude],
        {
          radius: 9,
          color: "#bfdbfe",
          fillColor: "#2563eb",
          fillOpacity: 1,
          weight: 3,
        },
      );
      marker.bindTooltip(`<strong>${selectedStop.name}</strong> · Selected stop`);
      marker.addTo(layerGroup);
    }

    // 2c. Render fresh vehicle markers with bearing rotation
    if (displayedVehicles) {
      for (const veh of displayedVehicles) {
        boundsPoints.push([veh.latitude, veh.longitude]);
        const isSelected = selectedVehicleId === veh.entity_id;
        const bearing = veh.bearing ?? 0;
        const obsAge = formatObservationAge(veh.observed_at);

        const vehicleHtml = `
          <div style="transform: rotate(${bearing}deg); width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: ${
            isSelected ? "#22c55e" : "#0284c7"
          }; border: 2px solid white; border-radius: 9999px; box-shadow: 0 2px 6px rgba(0,0,0,0.4); cursor: pointer;" title="Vehicle ${
            veh.vehicle_label || veh.vehicle_id || veh.entity_id
          }">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
            </svg>
          </div>
        `;

        const icon = L.divIcon({
          html: vehicleHtml,
          className: "ww-vehicle-icon",
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        const marker = L.marker([veh.latitude, veh.longitude], { icon });

        marker.bindTooltip(
          `<div><strong>Vehicle ${veh.vehicle_label || veh.vehicle_id || veh.entity_id}</strong>${veh.route_id ? `<br/>Route: ${veh.route_id}` : ""}<br/>Speed: ${
            veh.speed ? `${Math.round(veh.speed * 3.6)} km/h` : "N/A"
          }<br/><span style="font-size:11px;color:#94a3b8">Heading: ${Math.round(bearing)}° • ${obsAge}</span></div>`,
          { direction: "top", offset: [0, -14] },
        );

        marker.on("click", () => {
          setSelectedVehicleId(veh.entity_id);
        });

        marker.addTo(layerGroup);
      }
    }

    // 2d. Fit bounds to all route elements on initial load or route change
    // Avoid re-fitting on background polling ticks to preserve user zoom/pan and tile stability
    const fitKey = selectedRouteId
      ? `${routeFeedSlug}:${selectedRouteId}`
      : `feed:${selectedFeedSlug}`;
    if (boundsPoints.length > 0 && lastFittedRouteRef.current !== fitKey) {
      lastFittedRouteRef.current = fitKey;
      const bounds = L.latLngBounds(boundsPoints);
      map.fitBounds(bounds, {
        padding: [30, 30],
        maxZoom: selectedRouteId ? 15 : 12,
      });
    }
  }, [
    routeMapData,
    feedVehiclesQuery.data,
    displayedVehicles,
    selectedFeedSlug,
    routeFeedSlug,
    selectedRouteId,
    selectedStop?.stop_id,
    selectedVehicleId,
    setSelectedStop,
    setSelectedVehicleId,
  ]);

  // Selecting a stop from search or the ordered route list should bring it
  // into view without resetting the user's current map position on polls.
  useEffect(() => {
    if (selectedStop && mapInstanceRef.current) {
      mapInstanceRef.current.flyTo(
        [selectedStop.latitude, selectedStop.longitude],
        Math.max(mapInstanceRef.current.getZoom(), 14),
        { duration: 0.5 },
      );
    }
  }, [selectedStop?.stop_id, selectedStop?.latitude, selectedStop?.longitude]);

  // Reset fitted route reference when route selection is cleared
  useEffect(() => {
    if (!selectedRouteId) {
      lastFittedRouteRef.current = null;
    }
  }, [selectedRouteId]);

  return (
    <div
      className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden flex flex-col relative"
      aria-label="Interactive Route Map"
    >
      {/* Map Header Status Bar */}
      <div className="px-4 py-2.5 bg-gray-950/80 border-b border-gray-800 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-200">Interactive Map</span>
          {routeMapData && (
            <span className="text-gray-400">
              • Route {routeMapData.route_short_name || routeMapData.route_id}
            </span>
          )}
          {isFeedOverviewEnabled && !selectedRouteId && (
            <span className="text-gray-400">• Live vehicles across feed</span>
          )}
        </div>

        {/* Status Indicators & Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Polling / Live Status */}
          {(isPollingEnabled || isFeedOverviewEnabled) && (
            <div className="flex items-center gap-1.5 text-xs">
              {!isVisible ? (
                <span
                  role="status"
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700"
                  title="Live updates paused while window/tab is hidden"
                >
                  ⏸ Paused
                </span>
              ) : hasError && activeHasData ? (
                <span
                  role="status"
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-800"
                  title="Live refresh encountered an error; displaying last successful data"
                >
                  ⚠️ Stale
                </span>
              ) : liveStatus === "connected" ? (
                <span
                  role="status"
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-800"
                  title="Live real-time updates active via feed WebSocket"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live (WS)
                </span>
              ) : (
                <span
                  role="status"
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-800"
                  title={`Live polling active every ${Math.round(pollingInterval / 1000)} seconds`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live ({Math.round(pollingInterval / 1000)}s)
                </span>
              )}

              {activeDataUpdatedAt > 0 && (
                <span className="text-[11px] text-gray-500 hidden sm:inline">
                  Updated {formatLastUpdated(activeDataUpdatedAt)}
                </span>
              )}
            </div>
          )}

          {/* Route Path Availability Disclosure */}
          {routeMapData && (
            <>
              {routeMapData.shapes.length > 0 ? (
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Route Path Active
                </span>
              ) : (
                <span
                  role="status"
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-800"
                  title="Route geometry was not included in this feed. Displaying available stop locations."
                >
                  ⚠️ Route shape unavailable — showing stops only
                </span>
              )}
            </>
          )}

          {displayedVehicles.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-blue-950/70 text-blue-300 border border-blue-800">
              🚌 {displayedVehicles.length} Live{" "}
              {displayedVehicles.length === 1 ? "Vehicle" : "Vehicles"}
            </span>
          )}

          {/* Manual Refresh Button */}
          {(selectedRouteId || isFeedOverviewEnabled) && (
            <button
              type="button"
              onClick={() => void refreshActiveMap()}
              disabled={activeIsFetching}
              aria-label="Refresh live map"
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-[11px] text-gray-200 rounded border border-gray-700 transition-colors cursor-pointer"
            >
              <span className={activeIsFetching ? "animate-spin" : ""}>🔄</span>
              <span className="hidden sm:inline">
                {activeIsFetching ? "Refreshing..." : "Refresh"}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Map Canvas Container */}
      <div className="relative h-80 sm:h-96 md:h-[420px] w-full bg-gray-950">
        <div
          ref={mapContainerRef}
          data-testid="leaflet-map-container"
          className="h-full w-full z-0"
        />

        {/* Empty state before a feed is selected */}
        {!selectedFeedSlug && (
          <div className="absolute inset-0 bg-gray-950/80 backdrop-blur-xs flex items-center justify-center p-6 text-center z-10 pointer-events-none">
            <div className="max-w-md space-y-2">
              <span className="text-3xl" role="img" aria-label="Map">
                🗺️
              </span>
              <p className="text-sm font-medium text-gray-300">
                Select a Transit Route
              </p>
              <p className="text-xs text-gray-500">
                Choose a route above to view its route path, scheduled stops,
                and live vehicle positions.
              </p>
            </div>
          </div>
        )}

          {isFeedOverviewEnabled && !selectedRouteId &&
          !feedVehiclesQuery.isLoading &&
          feedVehiclesQuery.data?.length === 0 && (
            <div className="absolute inset-0 bg-gray-950/80 backdrop-blur-xs flex items-center justify-center p-6 text-center z-10 pointer-events-none">
              <div className="max-w-md space-y-2">
                <span className="text-3xl" role="img" aria-label="Map">
                  🚌
                </span>
                <p className="text-sm font-medium text-gray-300">
                  No current live vehicle positions
                </p>
                <p className="text-xs text-gray-500">
                  The provider may be temporarily unavailable. Fresh positions
                  will appear here when the feed updates.
                </p>
              </div>
            </div>
          )}

        {/* Loading Overlay (initial query only) */}
        {activeIsLoading && (
          <div
            role="status"
            className="absolute inset-0 bg-gray-950/70 backdrop-blur-xs flex items-center justify-center p-6 z-10"
          >
            <div className="flex items-center gap-2 text-sm text-blue-400">
              <span className="animate-spin text-lg">⏳</span>
              <span>
                {selectedRouteId
                  ? "Loading route & vehicles..."
                  : "Loading live vehicle positions..."}
              </span>
            </div>
          </div>
        )}

        {/* Transient Refresh Error Warning (preserves existing map data) */}
        {hasError && activeHasData && (
          <div
            role="alert"
            className="absolute inset-x-4 top-4 bg-amber-950/90 border border-amber-800 text-amber-200 text-xs rounded-md p-2.5 flex items-center justify-between z-10"
          >
            <div className="flex items-center gap-2">
              <span>⚠️</span>
              <span>
                Live vehicle refresh failed ({activeError instanceof Error ? activeError.message : "Network error"}).
                Displaying data from {formatLastUpdated(activeDataUpdatedAt)}.
              </span>
            </div>
            <button
              type="button"
              onClick={() => void refreshActiveMap()}
              disabled={activeIsFetching}
              className="text-amber-100 underline hover:no-underline text-xs ml-2 cursor-pointer shrink-0 disabled:opacity-50"
            >
              Retry
            </button>
          </div>
        )}

        {/* Initial Load Error Overlay (when no data exists) */}
        {hasError && !activeHasData && (
          <div
            role="alert"
            className="absolute inset-x-4 top-4 bg-red-950/90 border border-red-800 text-red-200 text-xs rounded-md p-3 flex items-center justify-between z-10"
          >
            <span>
              {activeError instanceof Error
                ? activeError.message
                : "Failed to load live vehicle data"}
            </span>
            <button
              type="button"
              onClick={() => void refreshActiveMap()}
              className="text-white underline hover:no-underline ml-2 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Map Footer: Attribution */}
      <div className="px-4 py-2 bg-gray-950 border-t border-gray-800 flex items-center justify-between text-[11px] text-gray-500">
        <span>
          Map data: &copy;{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 underline hover:text-white"
          >
            OpenStreetMap
          </a>{" "}
          contributors
        </span>
      </div>
    </div>
  );
}

export interface MapStopListProps {
  stops: RouteMapStop[];
  selectedStopId: string | null;
  onSelectStop: (stop: RouteMapStop) => void;
}
