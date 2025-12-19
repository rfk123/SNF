import fs from "fs/promises";
import path from "path";
import Papa from "papaparse";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = process.env.GOOGLE_PLACE_IDS_SEED_PATH
  ? path.resolve(process.env.GOOGLE_PLACE_IDS_SEED_PATH)
  : null;

const toCCN = (value) => {
  if (!value && value !== 0) return null;
  const str = String(value).trim();
  return str ? str.padStart(6, "0") : null;
};

export async function loadGooglePlaceIds(filePath = DEFAULT_PATH) {
  if (!filePath) {
    console.log("[GooglePlaceIdsLoader] Seed file disabled; relying on live resolution");
    return {};
  }
  try {
    const csv = await fs.readFile(filePath, "utf8");
    const parsed = Papa.parse(csv, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
    });

    const map = {};
    for (const row of parsed.data) {
      const ccn =
        toCCN(row["CMS Certification Number (CCN)_x"]) ||
        toCCN(row["CMS Certification Number (CCN)_y"]) ||
        toCCN(row.federal_provider_number) ||
        toCCN(row.provider_id) ||
        toCCN(row.CCN);
      if (!ccn) continue;
      const placeId =
        row.google_place_id ||
        row.google_placeid ||
        row.place_id ||
        row.googlePlaceId ||
        null;
      if (!placeId) continue;
      map[ccn] = {
        google_place_id: placeId,
        google_name: row.google_name || row.googleName || null,
      };
    }

    console.log(
      `[GooglePlaceIdsLoader] Loaded ${Object.keys(map).length} place ids from CSV (${path.basename(
        filePath
      )})`
    );
    return map;
  } catch (err) {
    console.warn("[GooglePlaceIdsLoader] Failed to load place ids:", err.message);
    return {};
  }
}
