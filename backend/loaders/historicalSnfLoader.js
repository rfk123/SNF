// backend/loaders/historicalSnfLoader.js
// Loads historical SNF quality metrics (2022-2024) from CMS CSV extracts (MDS + Claims).

import fs from "fs/promises";
import path from "path";
import Papa from "papaparse";

const DEFAULT_YEARS = [2022, 2023, 2024];
const HISTORICAL_BASE_DIR = path.resolve("data", "historical");

const PROVIDER_INFO_PATTERN = "NH_ProviderInfo_Jan{year}.csv";
const QUALITY_MDS_PATTERN = "NH_QualityMsr_MDS_Jan{year}.csv";
const QUALITY_CLAIMS_PATTERN = "NH_QualityMsr_Claims_Jan{year}.csv";
const QRP_PROVIDER_PATTERN =
  "Skilled_Nursing_Facility_Quality_Reporting_Program_Provider_Data_Jan{year}.csv";

const MDS_METRIC_CODES = {
  pressure_ulcer_rate: ["453"],
  fall_with_major_injury_rate: ["410"],
  medication_review_rate: ["452"],
  discharge_to_community_rate: ["430"],
  healthcare_associated_infection_rate: ["407"],
};

const CLAIMS_METRIC_CODES = {
  short_stay_rehospitalization_rate: ["521"],
  short_stay_ed_visit_rate: ["522"],
  long_stay_hospitalization_rate: ["551"],
  long_stay_ed_visit_rate: ["552"],
};

const QRP_METRIC_CODES = {
  self_care_at_discharge: "S_024_04_OBS_RATE",
  mobility_at_discharge: "S_025_04_OBS_RATE",
};

function normalizeFieldName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function pickField(row, candidates) {
  const normKeys = new Map();
  for (const key of Object.keys(row || {})) {
    normKeys.set(normalizeFieldName(key), key);
  }
  for (const candidate of candidates) {
    const norm = normalizeFieldName(candidate);
    if (normKeys.has(norm)) {
      return row[normKeys.get(norm)];
    }
  }
  return undefined;
}

function normalizeCCNFromRow(row) {
  return toString(
    pickField(row, [
      "cms_certification_number_(ccn)",
      "federal_provider_number",
      "provider_number",
      "ccn",
      "federal provider number",
    ])
  ).padStart(6, "0");
}

async function loadProviderInfo(year) {
  const filename = PROVIDER_INFO_PATTERN.replace("{year}", String(year));
  const filePath = path.join(HISTORICAL_BASE_DIR, String(year), filename);
  try {
    const csv = await fs.readFile(filePath, "utf8");
    const parsed = Papa.parse(csv, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
    });
    const map = new Map();
    for (const row of parsed.data) {
      const ccn = normalizeCCNFromRow(row);
      if (!ccn.trim()) continue;
      map.set(ccn, row);
    }
    return map;
  } catch (err) {
    console.warn(`[HistoricalSNF] Provider info missing for ${year}: ${err.message}`);
    return new Map();
  }
}

function mergeEntryDetails(entry, row) {
  if (!row) return;
  entry.facility_name =
    entry.facility_name || toString(row["Provider Name"] || row["provider_name"]);
  entry.address = entry.address || toString(row["Provider Address"] || row["provider_address"]);
  entry.city = entry.city || toString(row["Provider City"] || row["provider_city"]);
  entry.state = entry.state || toString(row["Provider State"] || row["provider_state"]);
  entry.zip_code = entry.zip_code || toString(row["Provider Zip Code"] || row["provider_zip_code"]);
  entry.county_name =
    entry.county_name || toString(row["Provider County Name"] || row["provider_county_name"]);
  entry.phone_number =
    entry.phone_number || toString(row["Provider Phone Number"] || row["provider_phone_number"]);
}

function mergeProviderInfo(entry, providerInfo) {
  if (!providerInfo) return;
  entry.facility_name =
    entry.facility_name || toString(providerInfo["Provider Name"] || providerInfo["provider_name"]);
  entry.address =
    entry.address || toString(providerInfo["Provider Address"] || providerInfo["provider_address"]);
  entry.city =
    entry.city || toString(providerInfo["Provider City"] || providerInfo["provider_city"]);
  entry.state =
    entry.state || toString(providerInfo["Provider State"] || providerInfo["provider_state"]);
  entry.zip_code =
    entry.zip_code || toString(providerInfo["Provider Zip Code"] || providerInfo["provider_zip_code"]);
  entry.county_name =
    entry.county_name || toString(providerInfo["Provider County Name"] || providerInfo["provider_county_name"]);
  entry.phone_number =
    entry.phone_number || toString(providerInfo["Provider Phone Number"] || providerInfo["provider_phone_number"]);
}

function ensureEntry(entryMap, ccn, providerInfoMap, sourceRow, year) {
  let entry = entryMap.get(ccn);
  if (!entry) {
    entry = {
      ccn,
      year,
      facility_name: "",
      address: "",
      city: "",
      state: "",
      zip_code: "",
      county_name: "",
      phone_number: "",
      metrics: {},
    };
    entryMap.set(ccn, entry);
  }
  mergeEntryDetails(entry, sourceRow);
  mergeProviderInfo(entry, providerInfoMap.get(ccn));
  return entry;
}

async function ingestFile(filePath, handler) {
  try {
    const csv = await fs.readFile(filePath, "utf8");
    const parsed = Papa.parse(csv, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
    });
    await handler(parsed.data);
    return true;
  } catch (err) {
    console.warn(`[HistoricalSNF] Unable to load ${filePath}: ${err.message}`);
    return false;
  }
}

async function ingestIfExists(filePath, handler) {
  try {
    await fs.access(filePath);
  } catch {
    return false;
  }
  return ingestFile(filePath, handler);
}

async function loadYear(year, options = {}) {
  const providerInfoMap = await loadProviderInfo(year);
  const entryMap = new Map();

  const mdsPath = path.join(
    HISTORICAL_BASE_DIR,
    String(year),
    options.mdsFilename || QUALITY_MDS_PATTERN.replace("{year}", String(year))
  );

  await ingestFile(mdsPath, (rows) => {
    for (const row of rows) {
      const ccn = normalizeCCNFromRow(row);
      if (!ccn.trim()) continue;
      const measureCode = String(row["Measure Code"] || row["measure code"] || "").trim();
      const metricKey = Object.entries(MDS_METRIC_CODES).find(([, codes]) =>
        codes.includes(measureCode)
      )?.[0];
      if (!metricKey) continue;
      const value =
        toNumber(row["Four Quarter Average Score"] || row["four quarter average score"]);
      if (value === null) continue;

      const entry = ensureEntry(entryMap, ccn, providerInfoMap, row, year);
      entry.metrics[metricKey] = value;
    }
  });

  const claimsPath = path.join(
    HISTORICAL_BASE_DIR,
    String(year),
    options.claimsFilename || QUALITY_CLAIMS_PATTERN.replace("{year}", String(year))
  );

  await ingestFile(claimsPath, (rows) => {
    for (const row of rows) {
      const ccn = normalizeCCNFromRow(row);
      if (!ccn.trim()) continue;
      const measureCode = String(row["Measure Code"] || row["measure code"] || "").trim();
      const metricKey = Object.entries(CLAIMS_METRIC_CODES).find(([, codes]) =>
        codes.includes(measureCode)
      )?.[0];
      if (!metricKey) continue;
      const value = toNumber(row["Adjusted Score"] || row["adjusted score"]);
      if (value === null) continue;

      const entry = ensureEntry(entryMap, ccn, providerInfoMap, row, year);
      entry.metrics[metricKey] = value;
    }
  });

  const qrpFilename =
    options.qrpProviderFilename ||
    QRP_PROVIDER_PATTERN.replace("{year}", String(year));
  const qrpPaths = [
    path.join(HISTORICAL_BASE_DIR, String(year), qrpFilename),
    path.join(HISTORICAL_BASE_DIR, "raw", String(year), qrpFilename),
  ];

  let qrpLoaded = false;
  for (const filePath of qrpPaths) {
    if (qrpLoaded) break;
    qrpLoaded = await ingestIfExists(filePath, (rows) => {
      for (const row of rows) {
        const ccn = normalizeCCNFromRow(row);
        if (!ccn.trim()) continue;
        const measureCode = String(row["Measure Code"] || row["measure code"] || "").trim();
        const metricKey = Object.entries(QRP_METRIC_CODES).find(
          ([, code]) => code === measureCode
        )?.[0];
        if (!metricKey) continue;

        const value = toNumber(row["Score"] || row["score"]);
        if (value === null) continue;

        const entry = ensureEntry(entryMap, ccn, providerInfoMap, row, year);
        entry.metrics[metricKey] = value;
      }
    });
  }
  if (!qrpLoaded) {
    console.warn(`[HistoricalSNF] QRP provider data missing for ${year}`);
  }

  return Array.from(entryMap.values()).filter(
    (entry) => Object.keys(entry.metrics).length > 0
  );
}

export async function loadHistoricalSNFQuality(options = {}) {
  const years = options.years || DEFAULT_YEARS;
  const timelines = {};

  for (const year of years) {
    const rows = await loadYear(year, options);
    for (const row of rows) {
      if (!timelines[row.ccn]) {
        timelines[row.ccn] = {
          ccn: row.ccn,
          facility_name: row.facility_name,
          address: row.address,
          city: row.city,
          state: row.state,
          zip_code: row.zip_code,
          county_name: row.county_name,
          phone_number: row.phone_number,
          years: {},
        };
      }
      timelines[row.ccn].years[year] = row.metrics;
    }
  }

  return timelines;
}

export function describeHistoricalRequirements() {
  return {
    baseDir: HISTORICAL_BASE_DIR,
    expectedFiles: DEFAULT_YEARS.map((year) => ({
      year,
      providerInfo: path.join(
        HISTORICAL_BASE_DIR,
        String(year),
        PROVIDER_INFO_PATTERN.replace("{year}", String(year))
      ),
      qualityMds: path.join(
        HISTORICAL_BASE_DIR,
        String(year),
        QUALITY_MDS_PATTERN.replace("{year}", String(year))
      ),
      qualityClaims: path.join(
        HISTORICAL_BASE_DIR,
        String(year),
        QUALITY_CLAIMS_PATTERN.replace("{year}", String(year))
      ),
    })),
  };
}
