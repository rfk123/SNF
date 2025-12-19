import fetch from "node-fetch";

const FIND_PLACE_URL = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json";

export async function findPlaceId({ query, locationBias, apiKey }) {
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY is required to find place IDs");
  }
  if (!query) return null;

  const url = new URL(FIND_PLACE_URL);
  url.searchParams.set("input", query);
  url.searchParams.set("inputtype", "textquery");
  url.searchParams.set("fields", "place_id,name,formatted_address,geometry/location");
  if (locationBias) {
    url.searchParams.set("locationbias", locationBias);
  }
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`FindPlace HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK" || !Array.isArray(data.candidates) || !data.candidates.length) {
    return null;
  }

  const best = data.candidates[0];
  return {
    place_id: best.place_id,
    name: best.name,
    formatted_address: best.formatted_address,
    location: best.geometry?.location || null,
  };
}
