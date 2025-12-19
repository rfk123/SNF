// backend/services/cmsService.js
// Lightweight wrapper around the CMS Provider Data API.
// Provides helpers for fetching hospital and SNF data directly from CMS.

import axios from "axios";

const CMS_BASE_URL =
  process.env.CMS_PROVIDER_BASE_URL || "https://data.cms.gov/data-api/v1";
const IS_PROVIDER_DATA =
  CMS_BASE_URL.includes("provider-data/api/1/datastore/query");

// Dataset identifiers pulled from CMS Provider Data Catalog.
// These can be overridden via env vars to accommodate future schema changes.
const DATASETS = {
  hospitals: process.env.CMS_PROVIDER_HOSPITAL_DATASET || "xubh-q36u", // Hospital General Information
  snfs: process.env.CMS_PROVIDER_SNF_DATASET || "b27b-2uc7", // Skilled Nursing Facility Provider Information
};

const DEFAULT_LIMIT = 50;
const MAX_PAGE_SIZE = 500;

function buildHeaders() {
  const headers = {};
  if (process.env.CMS_API_TOKEN) {
    headers["X-App-Token"] = process.env.CMS_API_TOKEN;
  }
  return headers;
}

function normalizeProviderDataParams(params) {
  const remap = {
    $limit: "limit",
    $offset: "offset",
    $select: "select",
    $where: "where",
    $order: "order",
  };

  const transformed = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const mappedKey = remap[key] || key;
    if (mappedKey === "limit" || mappedKey === "offset") {
      const num = Number(value);
      if (!Number.isNaN(num)) transformed[mappedKey] = num;
    } else {
      transformed[mappedKey] = value;
    }
  }
  return transformed;
}

async function fetchDataset(datasetId, params = {}) {
  const url = IS_PROVIDER_DATA
    ? `${CMS_BASE_URL}/${datasetId}/0`
    : `${CMS_BASE_URL}/dataset/${datasetId}/data`;

  const queryParams = IS_PROVIDER_DATA
    ? normalizeProviderDataParams(params)
    : params;

  try {
    console.log(`[CMS] Fetching dataset ${datasetId}`, { url, params: queryParams });
    const { data } = await axios.get(url, {
      params: queryParams,
      headers: buildHeaders(),
      timeout: 10000,
    });

    const rows = Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data)
        ? data
        : [];

    console.log(`[CMS] Received ${rows.length} rows`);
    return rows;
  } catch (err) {
    const msg = err.response?.data?.message || err.message || "Unknown CMS API error";
    throw new Error(`CMS dataset fetch failed: ${msg}`);
  }
}

function escapeLike(term) {
  return term.replace(/'/g, "''");
}

function normalizeLimit(value, fallback = DEFAULT_LIMIT) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 500); // guard against excessively large pulls
}

export async function fetchHospitals(options = {}) {
  const {
    name,
    state,
    county,
    limit = DEFAULT_LIMIT,
    offset = 0,
    columns = [
      "provider_id",
      "hospital_name",
      "address",
      "city",
      "city_town",
      "state",
      "zip_code",
      "county_name",
      "county_parish",
      "phone_number",
      "hospital_type",
      "hospital_ownership",
      "emergency_services",
    ],
  } = options;

  const params = {
    $limit: normalizeLimit(limit),
    $offset: offset,
  };

  if (columns?.length) params.$select = columns.join(", ");

  if (state) params.state = state.toUpperCase();
  if (county) params.county_name = county;
  if (name) {
    const like = escapeLike(name.trim());
    params.$where = `upper(hospital_name) like upper('%${like}%')`;
  }
  if (!params.$order) params.$order = "provider_id ASC";

  console.log("[CMS] fetchHospitals called", {
    name,
    state,
    county,
    limit: params.$limit,
    offset: params.$offset,
  });

  return fetchDataset(DATASETS.hospitals, params);
}

export async function fetchAllHospitals(options = {}) {
  const pageSize = normalizeLimit(options.pageSize || MAX_PAGE_SIZE, MAX_PAGE_SIZE);
  let offset = options.offset || 0;
  const cap = options.maxPages || Infinity;
  const maxRecords = options.maxRecords || 20000;
  const maxOffset = options.maxOffset || 50000;
  const seen = new Set();
  const results = [];
  let pageCount = 0;

  while (pageCount < cap) {
    if (offset >= maxOffset) {
      console.warn(`[CMS] Hospital pagination hit offset cap (${maxOffset}); stopping.`);
      break;
    }

    const page = await fetchHospitals({
      ...options,
      limit: pageSize,
      offset,
    });

    if (!page.length) break;

    const unique = [];
    for (const row of page) {
      const keyParts = [
        row.provider_id || row.provider_number || row.ccn || "",
        row.hospital_name || row.facility_name || "",
        row.address || row.provider_address || "",
        row.city || "",
        row.state || "",
      ];
      const key = keyParts.map((part) => (part ? String(part).trim().toUpperCase() : "")).join("|");
      if (!key.trim() || seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
    }

    if (!unique.length) {
      console.warn(`[CMS] No new hospital rows at offset ${offset}; stopping pagination.`);
      break;
    }

    results.push(...unique);
    if (results.length >= maxRecords) {
      console.warn("[CMS] Reached hospital pagination cap; stopping early.");
      break;
    }

    if (page.length < pageSize) break;

    offset += page.length;
    pageCount += 1;
  }

  return results;
}

export async function fetchSNFs(options = {}) {
  const {
    name,
    state,
    county,
    limit = DEFAULT_LIMIT,
    offset = 0,
    columns = [
      "provider_id",
      "provider_name",
      "address",
      "city",
      "city_town",
      "state",
      "zip_code",
      "county_name",
      "county_parish",
      "phone_number",
      "ownership_type",
      "number_of_certified_beds",
      "number_of_residents_in_certified_beds",
    ],
  } = options;

  const params = {
    $limit: normalizeLimit(limit),
    $offset: offset,
  };

  if (columns?.length) params.$select = columns.join(", ");

  if (state) params.state = state.toUpperCase();
  if (county) params.county_name = county;
  if (name) {
    const like = escapeLike(name.trim());
    params.$where = `upper(provider_name) like upper('%${like}%')`;
  }
  if (!params.$order) params.$order = "provider_id ASC";

  console.log("[CMS] fetchSNFs called", {
    name,
    state,
    county,
    limit: params.$limit,
    offset: params.$offset,
  });

  return fetchDataset(DATASETS.snfs, params);
}

export async function fetchAllSNFs(options = {}) {
  const pageSize = normalizeLimit(options.pageSize || MAX_PAGE_SIZE, MAX_PAGE_SIZE);
  let offset = options.offset || 0;
  const cap = options.maxPages || Infinity;
  const maxRecords = options.maxRecords || 25000;
  const maxOffset = options.maxOffset || 20000;
  const seen = new Set();
  const results = [];
  let pageCount = 0;

  while (pageCount < cap) {
    if (offset >= maxOffset) {
      console.warn(`[CMS] SNF pagination hit offset cap (${maxOffset}); stopping.`);
      break;
    }

    const page = await fetchSNFs({
      ...options,
      limit: pageSize,
      offset,
    });

    if (!page.length) break;

    const unique = [];
    for (const row of page) {
      const keyParts = [
        row.provider_id || row.provider_number || row.ccn || row.CCN || "",
        row.provider_name || row.facility_name || row.name || "",
        row.address || row.provider_address || "",
        row.city || "",
        row.state || "",
      ];
      const key = keyParts.map((part) => (part ? String(part).trim().toUpperCase() : "")).join("|");
      if (!key.trim() || seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
    }

    if (!unique.length) {
      console.warn(`[CMS] No new SNF rows at offset ${offset}; stopping pagination.`);
      break;
    }

    results.push(...unique);
    console.log(`[CMS] SNF pagination appended ${unique.length} new rows (total ${results.length})`);
    if (results.length >= maxRecords) {
      console.warn("[CMS] Reached SNF pagination cap; stopping early.");
      break;
    }

    if (page.length < pageSize) break;

    offset += page.length;
    pageCount += 1;
  }

  return results;
}

export async function searchHospitalsByName(name, options = {}) {
  if (!name || !name.trim()) return [];

  const results = await fetchHospitals({
    ...options,
    name,
    limit: normalizeLimit(options.limit, 20),
    columns: [
      "provider_id",
      "hospital_name",
      "address",
      "city",
      "state",
      "zip_code",
      "county_name",
      "phone_number",
      "hospital_type",
    ],
  });

  console.log("[CMS] searchHospitalsByName results", {
    query: name,
    count: results.length,
  });

  return results.map((row) => ({
    providerId: row.provider_id,
    name: row.hospital_name,
    address: row.address,
    city: row.city || row.city_town,
    state: row.state,
    zipCode: row.zip_code,
    county: row.county_name || row.county_parish,
    phoneNumber: row.phone_number,
    hospitalType: row.hospital_type,
  }));
}

export default {
  fetchHospitals,
  fetchSNFs,
  fetchAllHospitals,
  fetchAllSNFs,
  searchHospitalsByName,
};
