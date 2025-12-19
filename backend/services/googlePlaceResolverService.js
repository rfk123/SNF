import { createPlaceIdCache } from "./googlePlaceIdCache.js";
import { findPlaceId } from "./googlePlacesSearchClient.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeKeyParts(...parts) {
  return parts
    .filter(Boolean)
    .map((p) => String(p).toLowerCase().trim())
    .filter(Boolean)
    .join("|");
}

function buildQuery(facility) {
  const pieces = [
    facility?.facility_name,
    facility?.address,
    facility?.city,
    facility?.state,
    facility?.zip_code,
  ]
    .filter(Boolean)
    .join(", ");
  return pieces || facility?.facility_name || null;
}

function buildLocationBias(facility) {
  const lat = facility?.latitude;
  const lon = facility?.longitude;
  if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) return null;
  return `point:${lat},${lon}`;
}

export function createGooglePlaceResolver({
  cachePath,
  apiKey = process.env.GOOGLE_PLACES_API_KEY,
  maxAgeDays = Number(process.env.GOOGLE_PLACE_ID_MAX_AGE_DAYS || 30),
  seedPlaceIds = {},
} = {}) {
  const cache = createPlaceIdCache({ cachePath });
  const maxAgeMs = maxAgeDays * DAY_MS;

  const keyForFacility = (facility) => {
    const ccn =
      facility?.CCN ||
      facility?.provider_id ||
      facility?.federal_provider_number ||
      facility?.provider_number ||
      null;
    const normalizedCcn = ccn ? String(ccn).padStart(6, "0") : null;
    if (normalizedCcn) return `ccn:${normalizedCcn}`;
    return `name:${normalizeKeyParts(
      facility?.facility_name,
      facility?.address,
      facility?.city,
      facility?.state,
      facility?.zip_code
    )}`;
  };

  const isFresh = (entry) => {
    if (!entry?.resolved_at) return false;
    return Date.now() - entry.resolved_at < maxAgeMs;
  };

  async function getPlaceId(facility) {
    if (!facility) return null;

    // Seed map from CSV.
    const ccnKey = facility.CCN || facility.provider_id || facility.federal_provider_number;
    const normalizedCcn = ccnKey ? String(ccnKey).padStart(6, "0") : null;
    if (normalizedCcn && seedPlaceIds[normalizedCcn]?.google_place_id) {
      return {
        place_id: seedPlaceIds[normalizedCcn].google_place_id,
        name: seedPlaceIds[normalizedCcn].google_name || null,
        source: "seed",
      };
    }

    const cacheKey = keyForFacility(facility);
    const cached = await cache.get(cacheKey);
    if (cached && isFresh(cached)) {
      return { ...cached, source: "cache" };
    }

    if (!apiKey) {
      return cached || null;
    }

    try {
      const query = buildQuery(facility);
      const locationBias = buildLocationBias(facility);
      const found = await findPlaceId({ query, locationBias, apiKey });
      if (!found) return cached || null;

      const payload = {
        place_id: found.place_id,
        name: found.name || null,
        formatted_address: found.formatted_address || null,
        location: found.location || null,
        resolved_at: Date.now(),
      };
      await cache.set(cacheKey, payload);
      return { ...payload, source: "fresh" };
    } catch (err) {
      console.warn("[GooglePlaceResolver] FindPlace failed:", err.message);
      return cached || null;
    }
  }

  return { getPlaceId };
}
