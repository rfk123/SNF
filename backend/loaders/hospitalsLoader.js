// backend/loaders/hospitalsLoader.js
// Pulls hospital data from CMS Provider APIs, persisting normalized records in Postgres (CSV is seed-only).

import fs from "fs/promises";
import path from "path";
import Papa from "papaparse";
import { fileURLToPath } from "url";

import { prisma } from "../prisma/client.js";
import { fetchAllHospitals } from "../services/cmsService.js";
import { norm } from "../utils/strings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USE_LOCAL_HOSPITAL_FALLBACK = process.env.USE_LOCAL_HOSPITAL_FALLBACK !== "0";
const USE_LOCAL_HOSPITAL_FALLBACK = process.env.USE_LOCAL_HOSPITAL_FALLBACK !== "0";

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function normalizeFieldName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function getField(row, candidates) {
  const normalizedKeys = new Map();
  for (const key of Object.keys(row || {})) {
    normalizedKeys.set(normalizeFieldName(key), key);
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = normalizeFieldName(candidate);
    const actualKey = normalizedKeys.get(normalized);
    if (actualKey !== undefined) {
      return row[actualKey];
    }
  }
  return undefined;
}

function parseLocation(row) {
  const candidates = [
    getField(row, ["location", "location_1", "geocoded_location", "location1"]),
  ].filter(Boolean);

  let lat = toNumber(
    pick(
      getField(row, ["latitude", "lat"]),
      getField(row, ["latitude_x"]),
      getField(row, ["location_latitude"])
    )
  );
  let lon = toNumber(
    pick(
      getField(row, ["longitude", "lon"]),
      getField(row, ["longitude_x"]),
      getField(row, ["location_longitude"])
    )
  );

  for (const loc of candidates) {
    if (lat !== null && lon !== null) break;

    if (typeof loc === "string") {
      // Handle "POINT (-87.736 34.5149)" or "34.5149, -87.736"
      const pointMatch = loc.match(/POINT\s*\((-?\d+(\.\d+)?)\s+(-?\d+(\.\d+)?)\)/i);
      if (pointMatch) {
        lon = lon ?? toNumber(pointMatch[1]);
        lat = lat ?? toNumber(pointMatch[3]);
        continue;
      }

      const csvMatch = loc.match(/(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)/);
      if (csvMatch) {
        lat = lat ?? toNumber(csvMatch[1]);
        lon = lon ?? toNumber(csvMatch[3]);
      }
    } else if (Array.isArray(loc?.coordinates) && loc.coordinates.length >= 2) {
      lon = lon ?? toNumber(loc.coordinates[0]);
      lat = lat ?? toNumber(loc.coordinates[1]);
    } else if (typeof loc === "object") {
      lat = lat ?? toNumber(pick(loc.latitude, loc.lat));
      lon = lon ?? toNumber(pick(loc.longitude, loc.lon));
    }
  }

  return { latitude: lat, longitude: lon };
}

function mapHospitalRow(row) {
  const providerId = pick(
    getField(row, [
      "provider_id",
      "provider_number",
      "ccn",
      "cms_certification_number_(ccn)",
      "federal_provider_number",
      "facility_id",
    ])
  );

  const name = pick(
    getField(row, ["hospital_name", "facility_name", "provider_name", "name"])
  );

  if (!name) return null;

  const address = pick(getField(row, ["address", "address_line_1", "provider_address"]));
  const city = pick(getField(row, ["city", "city_town", "city_town_name"]));
  const state = pick(getField(row, ["state", "state_code"]));
  const zip = pick(getField(row, ["zip_code", "zip", "postal_code"]));
  const county = pick(getField(row, ["county_name", "county", "county_parish"]));
  const phone = pick(getField(row, ["phone_number", "telephone_number", "phone"]));
  const type = pick(getField(row, ["hospital_type", "facility_type"]));
  const ownership = pick(getField(row, ["hospital_ownership", "ownership_type"]));
  const emergency = pick(getField(row, ["emergency_services", "emergency_service"]));

  const { latitude, longitude } = parseLocation(row);

  const normalizedName = toString(name);
  const ccn = providerId ? toString(providerId) : null;
  const id = ccn || norm(normalizedName);

  return {
    id,
    provider_id: ccn,
    hospital_name: normalizedName,
    address: toString(address),
    city: toString(city),
    state: toString(state).toUpperCase(),
    zip_code: toString(zip),
    county_name: toString(county),
    phone_number: toString(phone),
    hospital_type: toString(type),
    hospital_ownership: toString(ownership),
    emergency_services: emergency === null ? "" : String(emergency),
    latitude,
    longitude,
    _key: norm(normalizedName),
  };
}

async function loadHospitalsFromLocalCSV() {
  const rawPath = path.join(__dirname, "..", "data", "raw", "hospitals.csv");
  try {
    const csv = await fs.readFile(rawPath, "utf8");
    const parsed = Papa.parse(csv, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
    });

    const hospitals = parsed.data.map(mapHospitalRow).filter(Boolean);
    console.log(`[HospitalsLoader] Loaded ${hospitals.length} hospitals (local CSV)`);
    return hospitals;
  } catch (err) {
    console.warn("[HospitalsLoader] Local CSV fallback failed:", err.message);
    return [];
  }
}

async function loadHospitalsFromDb() {
  const records = await prisma.hospital.findMany();
  return records.map((record) => record.payload || {
    id: record.id,
    provider_id: record.id,
    hospital_name: record.hospital_name,
    address: record.address,
    city: record.city,
    state: record.state,
    zip_code: record.zip_code,
    county_name: record.county_name,
    phone_number: record.phone_number,
    hospital_type: record.hospital_type,
    hospital_ownership: record.hospital_ownership,
    emergency_services: record.emergency_services,
    latitude: record.latitude,
    longitude: record.longitude,
  });
}

async function upsertHospitals(hospitals) {
  if (!hospitals?.length) return;
  const operations = hospitals.map((hospital) => {
    const id = hospital.id || hospital.provider_id || norm(hospital.hospital_name);
    return prisma.hospital.upsert({
      where: { id },
      update: {
        hospital_name: hospital.hospital_name,
        address: hospital.address,
        city: hospital.city,
        state: hospital.state,
        zip_code: hospital.zip_code,
        county_name: hospital.county_name,
        phone_number: hospital.phone_number,
        hospital_type: hospital.hospital_type,
        hospital_ownership: hospital.hospital_ownership,
        emergency_services: hospital.emergency_services,
        latitude: hospital.latitude,
        longitude: hospital.longitude,
        payload: hospital,
      },
      create: {
        id,
        hospital_name: hospital.hospital_name,
        address: hospital.address,
        city: hospital.city,
        state: hospital.state,
        zip_code: hospital.zip_code,
        county_name: hospital.county_name,
        phone_number: hospital.phone_number,
        hospital_type: hospital.hospital_type,
        hospital_ownership: hospital.hospital_ownership,
        emergency_services: hospital.emergency_services,
        latitude: hospital.latitude,
        longitude: hospital.longitude,
        payload: hospital,
      },
    });
  });
  await prisma.$transaction(operations);
}

export async function loadHospitals(options = {}) {
  const { useCache = true } = options;
  const forceRefresh = options.forceRefresh || process.env.CMS_FORCE_REFRESH === "1";

  if (useCache && !forceRefresh) {
    const cached = await loadHospitalsFromDb();
    if (cached.length) {
      console.log(`[HospitalsLoader] Loaded ${cached.length} hospitals (database)`);
      return cached;
    }
  }

  try {
    const rows = await fetchAllHospitals({ pageSize: 500, columns: null });
    console.log(`[HospitalsLoader] Fetched ${rows.length} raw hospital rows`);
    if (!rows.length) {
      throw new Error("CMS returned no hospital rows");
    }

  const hospitals = rows
    .map(mapHospitalRow)
    .filter(Boolean);

    if (USE_LOCAL_HOSPITAL_FALLBACK && hospitals.some((h) => !h.city || !h.county_name)) {
      const fallback = await loadHospitalsFromLocalCSV();
      const fallbackMap = new Map();
      for (const row of fallback) {
        if (row.provider_id) fallbackMap.set(row.provider_id, row);
        fallbackMap.set(row._key, row);
      }
      let merged = 0;
      for (const hospital of hospitals) {
        if (hospital.city && hospital.county_name) continue;
        const key = hospital.provider_id || hospital._key;
        const fallbackRow = fallbackMap.get(key);
        if (!fallbackRow) continue;
        if (!hospital.city && fallbackRow.city) {
          hospital.city = fallbackRow.city;
          merged++;
        }
        if (!hospital.county_name && fallbackRow.county_name) {
          hospital.county_name = fallbackRow.county_name;
          merged++;
        }
        if (!hospital.zip_code && fallbackRow.zip_code) {
          hospital.zip_code = fallbackRow.zip_code;
        }
      }
      if (merged) {
        console.log(`[HospitalsLoader] Filled ${merged} missing fields from local CSV fallback`);
      }
    } else if (!USE_LOCAL_HOSPITAL_FALLBACK && hospitals.some((h) => !h.city || !h.county_name)) {
      console.warn("[HospitalsLoader] Missing city/county fields remain (local CSV fallback disabled)");
    }
    console.log(
      `[HospitalsLoader] Normalized ${hospitals.length} hospitals` +
        (rows.length !== hospitals.length
          ? ` (dropped ${rows.length - hospitals.length} rows lacking essentials)`
          : "")
    );

    if (!hospitals.length) {
      throw new Error("CMS normalization produced zero hospital rows");
    }

    await upsertHospitals(hospitals);
    console.log(`[HospitalsLoader] Loaded ${hospitals.length} hospitals (CMS -> database)`);
    return hospitals;
  } catch (err) {
    console.error("[HospitalsLoader] CMS fetch failed:", err.message);
    if (USE_LOCAL_HOSPITAL_FALLBACK) {
      const local = await loadHospitalsFromLocalCSV();
      if (local.length) {
        await upsertHospitals(local);
        return local;
      }
    }
    return [];
  }
}
