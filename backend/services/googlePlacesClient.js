import fetch from "node-fetch";

const BASE_URL = "https://maps.googleapis.com/maps/api/place/details/json";

export async function fetchPlaceDetails(placeId, apiKey) {
  if (!placeId) {
    throw new Error("placeId required");
  }
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY is required to fetch reviews");
  }

  const url = new URL(BASE_URL);
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "name,rating,user_ratings_total,reviews");
  url.searchParams.set("reviews_no_translations", "true");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Places API HTTP ${res.status}`);
  }
  const data = await res.json();

  if (data.status !== "OK") {
    throw new Error(`Places API error: ${data.status} ${data.error_message || ""}`.trim());
  }

  return data.result;
}
