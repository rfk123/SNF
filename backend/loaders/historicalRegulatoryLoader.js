// backend/loaders/historicalRegulatoryLoader.js
// Aggregates CMS citations and penalties into yearly timelines per CCN.

import fs from "fs/promises";
import path from "path";
import Papa from "papaparse";

const DEFAULT_YEARS = [2022, 2023, 2024];
const HISTORICAL_BASE_DIR = path.resolve("data", "historical");

const CITATIONS_PATTERN = "NH_HealthCitations_Jan{year}.csv";
const PENALTIES_PATTERN = "NH_Penalties_Jan{year}.csv";

function normalizeCCN(value) {
  if (value === null || value === undefined) return "";
  return String(value).padStart(6, "0");
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function severityBucket(scopeCode = "") {
  const code = scopeCode.trim().toUpperCase();
  if (!code) return "unknown";
  const letter = code[0];
  if ("JKL".includes(letter)) return "immediateJeopardy";
  if ("GHI".includes(letter)) return "actualHarm";
  if ("DEF".includes(letter)) return "potentialHarm";
  if ("ABC".includes(letter)) return "minimalHarm";
  return "unknown";
}

async function parseCSV(filePath) {
  const csv = await fs.readFile(filePath, "utf8");
  const parsed = Papa.parse(csv, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
  });
  return parsed.data;
}

async function loadCitations(year) {
  const filePath = path.join(
    HISTORICAL_BASE_DIR,
    String(year),
    CITATIONS_PATTERN.replace("{year}", String(year))
  );
  try {
    const rows = await parseCSV(filePath);
    const map = new Map();
    for (const row of rows) {
      const ccn = normalizeCCN(
        row["Federal Provider Number"] || row["federal_provider_number"]
      );
      if (!ccn) continue;
      const bucket = severityBucket(row["Scope Severity Code"] || row["scope severity code"]);
      const entry = map.get(ccn) || {
        total: 0,
        immediateJeopardy: 0,
        actualHarm: 0,
        potentialHarm: 0,
        minimalHarm: 0,
        infectionControl: 0,
      };
      entry.total += 1;
      if (entry[bucket] !== undefined) entry[bucket] += 1;
      const infectionFlag =
        (row["Infection Control Inspection Deficiency"] || row["infection control inspection deficiency"] || "").toUpperCase() === "Y" ||
        String(row["Deficiency Category"] || "").toLowerCase().includes("infection control");
      if (infectionFlag) entry.infectionControl += 1;
      map.set(ccn, entry);
    }
    return map;
  } catch (err) {
    console.warn(`[HistoricalRegulatory] Unable to load citations for ${year}: ${err.message}`);
    return new Map();
  }
}

async function loadPenalties(year) {
  const filePath = path.join(
    HISTORICAL_BASE_DIR,
    String(year),
    PENALTIES_PATTERN.replace("{year}", String(year))
  );
  try {
    const rows = await parseCSV(filePath);
    const map = new Map();
    for (const row of rows) {
      const ccn = normalizeCCN(
        row["Federal Provider Number"] || row["federal_provider_number"]
      );
      if (!ccn) continue;
      const penaltyType = (row["Penalty Type"] || row["penalty type"] || "").toLowerCase();
      const entry = map.get(ccn) || {
        penalties: 0,
        finesCount: 0,
        finesTotal: 0,
        paymentDenials: 0,
      };
      entry.penalties += 1;

      const fineAmount = toNumber(row["Fine Amount"] || row["fine amount"]);
      if (fineAmount) {
        entry.finesCount += 1;
        entry.finesTotal += fineAmount;
      }

      const hasDenial =
        penaltyType.includes("denial") ||
        Boolean(row["Payment Denial Start Date"] || row["payment denial start date"]);
      if (hasDenial) entry.paymentDenials += 1;

      map.set(ccn, entry);
    }
    return map;
  } catch (err) {
    console.warn(`[HistoricalRegulatory] Unable to load penalties for ${year}: ${err.message}`);
    return new Map();
  }
}

export async function loadHistoricalRegulatory(options = {}) {
  const years = options.years || DEFAULT_YEARS;
  const timelines = {};

  for (const year of years) {
    const [citations, penalties] = await Promise.all([
      loadCitations(year),
      loadPenalties(year),
    ]);

    for (const [ccn, citationSummary] of citations.entries()) {
      if (!timelines[ccn]) timelines[ccn] = { ccn, citations: {}, penalties: {} };
      timelines[ccn].citations[year] = citationSummary;
    }

    for (const [ccn, penaltySummary] of penalties.entries()) {
      if (!timelines[ccn]) timelines[ccn] = { ccn, citations: {}, penalties: {} };
      timelines[ccn].penalties[year] = penaltySummary;
    }
  }

  return timelines;
}
