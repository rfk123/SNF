// backend/loaders/snfsLoader.js
// Pulls SNF provider data from CMS Provider APIs, persisting normalized records in Postgres (CSV is seed-only).

import fs from "fs/promises";
import path from "path";
import Papa from "papaparse";
import { fileURLToPath } from "url";

import { prisma } from "../prisma/client.js";
import { fetchAllSNFs } from "../services/cmsService.js";
import { norm } from "../utils/strings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_SNF_CSV = path.join(__dirname, "..", "data", "raw", "snfs.csv");
const USE_LOCAL_SNF_FALLBACK = process.env.USE_LOCAL_SNF_FALLBACK !== "0";

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
      getField(row, ["location_latitude"]),
      getField(row, ["latitude_x"])
    )
  );
  let lon = toNumber(
    pick(
      getField(row, ["longitude", "lon"]),
      getField(row, ["location_longitude"]),
      getField(row, ["longitude_x"])
    )
  );

  for (const loc of candidates) {
    if (lat !== null && lon !== null) break;

    if (typeof loc === "string") {
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

function average(numbers) {
  if (!numbers.length) return null;
  const sum = numbers.reduce((acc, val) => acc + val, 0);
  return sum / numbers.length;
}

function mapSNFRow(row) {
  const providerId = pick(
    getField(row, [
      "provider_id",
      "provider_number",
      "ccn",
      "cms_certification_number_(ccn)",
      "federal_provider_number",
    ])
  );

  const name = pick(
    getField(row, ["provider_name", "facility_name", "name"])
  );

  if (!name) return null;

  const address = pick(
    getField(row, ["address", "provider_address", "address_line_1"])
  );

  const city = pick(getField(row, ["city", "city_town"]));
  const state = pick(getField(row, ["state", "state_code"]));
  const zip = pick(getField(row, ["zip_code", "zip", "postal_code"]));
  const county = pick(getField(row, ["county_name", "county", "county_parish"]));
  const phone = pick(getField(row, ["phone_number", "telephone_number", "phone"]));

  const { latitude, longitude } = parseLocation(row);

  const ratings = [
    toNumber(pick(getField(row, ["overall_rating"]), row["Overall Rating"])),
    toNumber(pick(getField(row, ["staffing_rating"]), row["Staffing Rating"])),
    toNumber(
      pick(
        getField(row, ["qm_rating", "quality_measure_rating"]),
        row["QM Rating"],
        getField(row, ["short_stay_qm_rating"])
      )
    ),
    toNumber(
      pick(
        getField(row, ["health_inspection_rating"]),
        row["Health Inspection Rating"]
      )
    ),
  ].filter((n) => n !== null);

  const composite = average(ratings);
  const compositeScore = composite !== null ? composite * 20 : null;

  const ownership = pick(
    getField(row, ["ownership_type"]),
    row["Ownership Type"]
  );

  const ccn = providerId ? toString(providerId) : norm(toString(name));

  const snf = {
    id: ccn,
    facility_name: toString(name),
    address: toString(address),
    city: toString(city),
    state: toString(state).toUpperCase(),
    zip_code: toString(zip),
    county_name: toString(county),
    phone_number: toString(phone),
    latitude,
    longitude,
    Composite_Score: compositeScore,
    ownership_type: toString(ownership),
  };

  if (ccn) {
    snf.CCN = ccn;
    snf["CMS Certification Number (CCN)"] = ccn;
    snf.provider_id = ccn;
  }

  const overall = toNumber(pick(getField(row, ["overall_rating"]), row["Overall Rating"]));
  const health = toNumber(
    pick(getField(row, ["health_inspection_rating"]), row["Health Inspection Rating"])
  );
  const staffing = toNumber(
    pick(getField(row, ["staffing_rating"]), row["Staffing Rating"])
  );
  const qm = toNumber(pick(getField(row, ["qm_rating"]), row["QM Rating"]));

  if (overall !== null) {
    snf.overall_rating = overall;
    snf["Overall Rating"] = overall;
  }
  if (health !== null) {
    snf.health_inspection_rating = health;
    snf["Health Inspection Rating"] = health;
  }
  if (staffing !== null) {
    snf.staffing_rating = staffing;
    snf["Staffing Rating"] = staffing;
  }
  if (qm !== null) {
    snf.qm_rating = qm;
    snf["QM Rating"] = qm;
  }

  return snf;
}

async function loadSNFsFromLocalCSV() {
  try {
    const csv = await fs.readFile(LOCAL_SNF_CSV, "utf8");
    const parsed = Papa.parse(csv, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
    });
    const snfs = parsed.data.map(mapSNFRow).filter(Boolean);
    console.log(`[SNFsLoader] Loaded ${snfs.length} SNFs (local CSV)`);
    return snfs;
  } catch (err) {
    console.warn("[SNFsLoader] Local CSV fallback failed:", err.message);
    return [];
  }
}

async function loadSNFsFromDb() {
  const records = await prisma.snf.findMany();
  return records.map((record) => record.payload || {
    id: record.ccn,
    CCN: record.ccn,
    provider_id: record.ccn,
    facility_name: record.facility_name,
    address: record.address,
    city: record.city,
    state: record.state,
    zip_code: record.zip_code,
    county_name: record.county_name,
    phone_number: record.phone_number,
    ownership_type: record.ownership_type,
    latitude: record.latitude,
    longitude: record.longitude,
    Composite_Score: record.composite_score,
    overall_rating: record.overall_rating,
    health_inspection_rating: record.health_inspection_rating,
    staffing_rating: record.staffing_rating,
    qm_rating: record.qm_rating,
  });
}

async function upsertSNFs(snfs) {
  if (!snfs?.length) return;
  const operations = snfs.map((snf) => {
    const ccn = snf.CCN || snf.provider_id || snf.id || norm(snf.facility_name);
    return prisma.snf.upsert({
      where: { ccn },
      update: {
        facility_name: snf.facility_name,
        address: snf.address,
        city: snf.city,
        state: snf.state,
        zip_code: snf.zip_code,
        county_name: snf.county_name,
        phone_number: snf.phone_number,
        ownership_type: snf.ownership_type,
        latitude: snf.latitude,
        longitude: snf.longitude,
        composite_score: snf.Composite_Score ?? snf.composite_score ?? null,
        overall_rating: snf.overall_rating ?? null,
        health_inspection_rating: snf.health_inspection_rating ?? null,
        staffing_rating: snf.staffing_rating ?? null,
        qm_rating: snf.qm_rating ?? null,
        payload: snf,
      },
      create: {
        ccn,
        facility_name: snf.facility_name,
        address: snf.address,
        city: snf.city,
        state: snf.state,
        zip_code: snf.zip_code,
        county_name: snf.county_name,
        phone_number: snf.phone_number,
        ownership_type: snf.ownership_type,
        latitude: snf.latitude,
        longitude: snf.longitude,
        composite_score: snf.Composite_Score ?? snf.composite_score ?? null,
        overall_rating: snf.overall_rating ?? null,
        health_inspection_rating: snf.health_inspection_rating ?? null,
        staffing_rating: snf.staffing_rating ?? null,
        qm_rating: snf.qm_rating ?? null,
        payload: snf,
      },
    });
  });
  await prisma.$transaction(operations);
}

export async function loadSNFs(options = {}) {
  const { useCache = true } = options;
  const forceRefresh = options.forceRefresh || process.env.CMS_FORCE_REFRESH === "1";

  if (useCache && !forceRefresh) {
    const cached = await loadSNFsFromDb();
    if (cached.length) {
      console.log(`[SNFsLoader] Loaded ${cached.length} SNFs (database)`);
      return cached;
    }
  }

  try {
    const rows = await fetchAllSNFs({ pageSize: 500, columns: null });
    console.log(`[SNFsLoader] Fetched ${rows.length} raw SNF rows`);
    if (!rows.length) {
      throw new Error("CMS returned no SNF rows");
    }

    const snfs = rows
      .map(mapSNFRow)
      .filter(Boolean);

    if (USE_LOCAL_SNF_FALLBACK && snfs.some((s) => !s.city || !s.county_name || !s.zip_code)) {
      const localFallback = await loadSNFsFromLocalCSV();
      const fallbackMap = new Map();
      for (const record of localFallback) {
        if (record.CCN) fallbackMap.set(record.CCN, record);
        if (record.provider_id) fallbackMap.set(record.provider_id, record);
        fallbackMap.set(record.facility_name?.toUpperCase(), record);
      }

      let patched = 0;
      for (const snf of snfs) {
        if (snf.city && snf.county_name && snf.zip_code) continue;
        const keyCandidates = [
          snf.CCN,
          snf.provider_id,
          snf.facility_name?.toUpperCase(),
        ].filter(Boolean);

        let fallbackRow = null;
        for (const key of keyCandidates) {
          fallbackRow = fallbackMap.get(key);
          if (fallbackRow) break;
        }
        if (!fallbackRow) continue;

        if (!snf.city && fallbackRow.city) {
          snf.city = fallbackRow.city;
          patched++;
        }
        if (!snf.county_name && fallbackRow.county_name) {
          snf.county_name = fallbackRow.county_name;
          patched++;
        }
        if (!snf.zip_code && fallbackRow.zip_code) {
          snf.zip_code = fallbackRow.zip_code;
          patched++;
        }
      }

      if (patched) {
        console.log(`[SNFsLoader] Filled ${patched} missing SNF fields from local CSV`);
      }
    } else if (!USE_LOCAL_SNF_FALLBACK && snfs.some((s) => !s.city || !s.county_name || !s.zip_code)) {
      console.warn("[SNFsLoader] Missing SNF fields remain (local CSV fallback disabled)");
    }

    console.log(
      `[SNFsLoader] Normalized ${snfs.length} SNFs` +
        (rows.length !== snfs.length
          ? ` (dropped ${rows.length - snfs.length} rows lacking essentials)`
          : "")
    );

    if (!snfs.length) {
      throw new Error("CMS normalization produced zero SNF rows");
    }

    await upsertSNFs(snfs);
    console.log(`[SNFsLoader] Loaded ${snfs.length} SNFs (CMS -> database)`);
    return snfs;
  } catch (err) {
    console.error("[SNFsLoader] CMS fetch failed:", err.message);
    if (USE_LOCAL_SNF_FALLBACK) {
      const localFallback = await loadSNFsFromLocalCSV();
      if (localFallback.length) {
        await upsertSNFs(localFallback);
        return localFallback;
      }
    }
    return [];
  }
}
