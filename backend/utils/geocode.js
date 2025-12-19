// backend/utils/geocode.js
import fetch from "node-fetch";

import { prisma } from "../prisma/client.js";

function normalizeKey({ name, address, city, state, zip }) {
  return [name, address, city, state, zip].join("|").toUpperCase().replace(/\s+/g, " ").trim();
}

async function getCachedCoordinates(key) {
  if (!key) return null;
  const record = await prisma.geocodeCache.findUnique({ where: { key } });
  if (!record) return null;
  return {
    lat: record.lat ?? null,
    lon: record.lon ?? null,
    provider: record.provider ?? null,
  };
}

async function saveCachedCoordinates(key, payload) {
  if (!key) return null;
  await prisma.geocodeCache.upsert({
    where: { key },
    update: {
      lat: payload.lat ?? null,
      lon: payload.lon ?? null,
      provider: payload.provider ?? null,
      payload,
    },
    create: {
      key,
      lat: payload.lat ?? null,
      lon: payload.lon ?? null,
      provider: payload.provider ?? null,
      payload,
    },
  });
  return payload;
}

export async function geocodeHospitalAddress({ name, address, city, state, zip }) {
  const key = normalizeKey({ name, address, city, state, zip });
  const cached = await getCachedCoordinates(key);
  if (cached) return cached;

  // Clean the address before geocoding
  const cleanedAddress = (address || "")
    .replace(/\(.*P ?O ?BOX.*\)/i, "")
    .replace(/P ?O ?BOX.*$/i, "")
    .trim();
  const sanitizedAddress = cleanedAddress
    .replace(/\bSR\b/gi, "State Road")
    .replace(/\bHwy\b/gi, "Highway")
    .replace(/\bUS\b/gi, "US")
    .replace(/\bMt\b/gi, "Mount");

  const fullAddress = `${sanitizedAddress || cleanedAddress}, ${city}, ${state} ${zip}`
    .replace(/\s+/g, " ")
    .trim();
  const cityState = `${city}, ${state} ${zip}`.trim();
  const nameCityState = `${name}, ${city}, ${state}`.trim();

  // 1) Try Google Geocoding
  const googleKey = process.env.GOOGLE_MAPS_KEY;
  if (googleKey) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${googleKey}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === "OK" && data.results?.[0]?.geometry?.location) {
        const { lat, lng } = data.results[0].geometry.location;
        const record = { lat, lon: lng, provider: "google" };
        await saveCachedCoordinates(key, record);
        return record;
      }
    } catch (_) {}
  }

  // 2) Fall back to Nominatim (OpenStreetMap). Respect rate limits if batching!
  async function queryNominatim(query) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          process.env.NOMINATIM_USER_AGENT ||
          "SNF-Referrals/1.0 (+https://example.com/contact)",
      },
    });

    const body = await res.text();

    if (!res.ok) {
      console.warn(
        `[Geocode] Nominatim query failed (${res.status} ${res.statusText}) for "${query}": ${body.slice(0, 120)}`
      );
      return null;
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      console.warn(
        `[Geocode] Nominatim returned non-JSON payload for "${query}": ${body.slice(0, 120)}`
      );
      return null;
    }

    let arr;
    try {
      arr = JSON.parse(body);
    } catch (err) {
      console.warn(
        `[Geocode] Failed to parse Nominatim JSON for "${query}": ${err.message}. Payload: ${body.slice(0, 120)}`
      );
      return null;
    }

    if (Array.isArray(arr) && arr[0]) {
      const lat = parseFloat(arr[0].lat);
      const lon = parseFloat(arr[0].lon);
      const record = { lat, lon, provider: "nominatim" };
      await saveCachedCoordinates(key, record);
      return record;
    }
    return null;
  }

  const queries = [fullAddress];
  if (sanitizedAddress && sanitizedAddress !== cleanedAddress) {
    const alt = `${cleanedAddress}, ${city}, ${state} ${zip}`.replace(/\s+/g, " ").trim();
    if (alt && alt !== fullAddress) queries.push(alt);
  }
  if (cityState && !queries.includes(cityState)) queries.push(cityState);
  if (nameCityState && !queries.includes(nameCityState)) queries.push(nameCityState);

  for (const query of queries) {
    const result = await queryNominatim(query);
    if (result) return result;
  }

  // 3) Final fallback: Census geocoder (onelineaddress)
  const censusUrl = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(
    fullAddress
  )}&benchmark=2020&format=json`;
  try {
    const res = await fetch(censusUrl);
    if (res.ok) {
      const data = await res.json();
      const match = data?.result?.addressMatches?.[0];
      const coords = match?.coordinates;
      const lat = Number(coords?.y);
      const lon = Number(coords?.x);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const record = { lat, lon, provider: "census" };
        await saveCachedCoordinates(key, record);
        return record;
      }
    } else {
      const body = await res.text();
      console.warn(`[Geocode] Census geocoder failed (${res.status}) for "${fullAddress}": ${body.slice(0, 120)}`);
    }
  } catch (err) {
    console.warn(`[Geocode] Census geocoder error for "${fullAddress}": ${err.message}`);
  }

  throw new Error("Geocoding failed for address: " + fullAddress);
}
