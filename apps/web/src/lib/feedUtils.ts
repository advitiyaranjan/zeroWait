import type { FeedSummary } from "../types/transit";

/** Find a schedule feed paired with a live-only feed for the same city. */
export function getScheduleFeedSlug(
  selectedFeedSlug: string | null,
  feeds: FeedSummary[] | undefined,
): string | null {
  if (!selectedFeedSlug) {
    return null;
  }

  const selectedFeed = feeds?.find((feed) => feed.slug === selectedFeedSlug);
  if (!selectedFeed?.is_live_tracking_enabled) {
    return selectedFeedSlug;
  }

  const cityKey = normalizeCityName(selectedFeed.city_name);
  const scheduleFeed = feeds?.find(
    (feed) =>
      feed.slug !== selectedFeedSlug &&
      !feed.is_live_tracking_enabled &&
      normalizeCityName(feed.city_name) === cityKey,
  );

  return scheduleFeed?.slug ?? selectedFeedSlug;
}

function normalizeCityName(cityName: string): string {
  return cityName
    .replace(/\s*\([^)]*\)\s*$/, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
