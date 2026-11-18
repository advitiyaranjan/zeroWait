import { create } from "zustand";
import type { LiveConnectionStatus, StopSummary } from "../types/transit";

export interface AppState {
  /** Currently selected transit feed slug */
  selectedFeedSlug: string | null;

  /** Currently selected route identifier */
  selectedRouteId: string | null;

  /** Feed that owns the selected route, which may differ from the live feed */
  selectedRouteFeedSlug: string | null;

  /** Currently selected transit stop */
  selectedStop: StopSummary | null;

  /** Feed that owns the selected stop */
  selectedStopFeedSlug: string | null;

  /** Currently selected realtime vehicle entity/vehicle ID on the map */
  selectedVehicleId: string | null;

  /** Backwards-compatible alias for selected city / feed slug */
  selectedCity: string | null;

  /** Current real-time live connection status */
  liveStatus: LiveConnectionStatus;

  /** Timestamp of the most recent real-time update event */
  lastLiveUpdateAt: string | null;

  /** Update selected feed slug (enforces feed isolation by resetting route, stop, and vehicle) */
  setSelectedFeedSlug: (slug: string | null) => void;

  /** Update selected route */
  setSelectedRouteId: (routeId: string | null, feedSlug?: string | null) => void;

  /** Select a specific stop within the active feed/route */
  setSelectedStop: (stop: StopSummary | null, feedSlug?: string | null) => void;

  /** Select a vehicle on the map to inspect */
  setSelectedVehicleId: (vehicleId: string | null) => void;

  /** Backwards-compatible alias for setSelectedFeedSlug */
  setSelectedCity: (city: string | null) => void;

  /** Set live connection status */
  setLiveStatus: (status: LiveConnectionStatus) => void;

  /** Set timestamp of the most recent real-time update event */
  setLastLiveUpdateAt: (timestamp: string | null) => void;

  /** Reset all selections */
  reset: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  selectedFeedSlug: null,
  selectedRouteId: null,
  selectedRouteFeedSlug: null,
  selectedStop: null,
  selectedStopFeedSlug: null,
  selectedVehicleId: null,
  selectedCity: null,
  liveStatus: "disconnected",
  lastLiveUpdateAt: null,

  setSelectedFeedSlug: (slug) =>
    set({
      selectedFeedSlug: slug,
      selectedCity: slug,
      // Feed isolation: changing feed clears previously selected route, stop, vehicle, and live connection
      selectedRouteId: null,
      selectedRouteFeedSlug: null,
      selectedStop: null,
      selectedStopFeedSlug: null,
      selectedVehicleId: null,
      liveStatus: "disconnected",
      lastLiveUpdateAt: null,
    }),

  setSelectedRouteId: (routeId, feedSlug) =>
    set({
      selectedRouteId: routeId,
      selectedRouteFeedSlug: routeId
        ? feedSlug ?? get().selectedRouteFeedSlug ?? get().selectedFeedSlug
        : null,
      selectedVehicleId: null,
    }),

  setSelectedStop: (stop, feedSlug) =>
    set({
      selectedStop: stop,
      selectedStopFeedSlug: stop
        ? feedSlug ?? get().selectedStopFeedSlug ?? get().selectedFeedSlug
        : null,
    }),

  setSelectedVehicleId: (vehicleId) =>
    set({
      selectedVehicleId: vehicleId,
    }),

  setSelectedCity: (city) =>
    set({
      selectedCity: city,
      selectedFeedSlug: city,
      selectedRouteId: null,
      selectedRouteFeedSlug: null,
      selectedStop: null,
      selectedStopFeedSlug: null,
      selectedVehicleId: null,
      liveStatus: "disconnected",
      lastLiveUpdateAt: null,
    }),

  setLiveStatus: (status) =>
    set({
      liveStatus: status,
    }),

  setLastLiveUpdateAt: (timestamp) =>
    set({
      lastLiveUpdateAt: timestamp,
    }),

  reset: () =>
    set({
      selectedFeedSlug: null,
      selectedRouteId: null,
      selectedRouteFeedSlug: null,
      selectedStop: null,
      selectedStopFeedSlug: null,
      selectedVehicleId: null,
      selectedCity: null,
      liveStatus: "disconnected",
      lastLiveUpdateAt: null,
    }),
}));
