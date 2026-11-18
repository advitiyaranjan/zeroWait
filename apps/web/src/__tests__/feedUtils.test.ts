import { describe, expect, it } from "vitest";
import { getScheduleFeedSlug } from "../lib/feedUtils";
import type { FeedSummary } from "../types/transit";

const feeds: FeedSummary[] = [
  {
    id: 1,
    city_name: "Delhi Buses",
    slug: "delhi-bus",
    feed_status: "active",
    is_live_tracking_enabled: true,
    last_static_import_at: null,
    last_realtime_poll_at: null,
  },
  {
    id: 2,
    city_name: "Delhi Buses (Schedule & Routes)",
    slug: "delhi-buses",
    feed_status: "active",
    is_live_tracking_enabled: false,
    last_static_import_at: null,
    last_realtime_poll_at: null,
  },
];

describe("getScheduleFeedSlug", () => {
  it("pairs a live feed with the city's schedule feed", () => {
    expect(getScheduleFeedSlug("delhi-bus", feeds)).toBe("delhi-buses");
  });

  it("keeps a selected schedule feed", () => {
    expect(getScheduleFeedSlug("delhi-buses", feeds)).toBe("delhi-buses");
  });

  it("falls back to the selected feed when no schedule pair exists", () => {
    expect(getScheduleFeedSlug("unknown-city", feeds)).toBe("unknown-city");
  });

  it("returns null when no feed is selected", () => {
    expect(getScheduleFeedSlug(null, feeds)).toBeNull();
  });
});
