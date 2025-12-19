import { fetchPlaceDetails } from "./googlePlacesClient.js";
import { createReviewCache } from "./googleReviewsCache.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function formatReviews(reviews = []) {
  return reviews.slice(0, 5).map((r) => {
    const rating = r.rating != null ? `${r.rating}★` : null;
    const when = r.relative_time_description ? ` (${r.relative_time_description})` : "";
    const text = (r.text || "").trim();
    return [rating, text].filter(Boolean).join(": ") + when;
  });
}

export function createGoogleReviewsService({
  cachePath,
  apiKey = process.env.GOOGLE_PLACES_API_KEY,
  maxAgeDays = Number(process.env.GOOGLE_REVIEWS_MAX_AGE_DAYS || 7),
} = {}) {
  const cache = createReviewCache({ cachePath });
  const maxAgeMs = maxAgeDays * DAY_MS;

  const getFreshness = (entry) => {
    if (!entry?.fetched_at) return Infinity;
    return Date.now() - entry.fetched_at;
  };

  async function getReviewSnapshot(placeId) {
    if (!placeId) return null;

    const cached = await cache.get(placeId);
    if (cached && getFreshness(cached) < maxAgeMs) {
      return cached;
    }

    if (!apiKey) {
      // No key configured; return stale cache if any.
      return cached || null;
    }

    try {
      const result = await fetchPlaceDetails(placeId, apiKey);
      const snapshot = {
        google_place_id: placeId,
        google_name: result.name || null,
        google_rating: result.rating ?? null,
        google_rating_count: result.user_ratings_total ?? null,
        recent_reviews: formatReviews(result.reviews || []),
        recent_review_count: result.reviews?.length || 0,
        recent_avg_rating: result.reviews?.length
          ? result.reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / result.reviews.length
          : null,
        fetched_at: Date.now(),
      };
      await cache.set(placeId, snapshot);
      return snapshot;
    } catch (err) {
      console.warn("[GoogleReviews] Fetch failed:", err.message);
      return cached || null;
    }
  }

  return { getReviewSnapshot };
}
