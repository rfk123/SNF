import { loadHistoricalRegulatory } from "../loaders/historicalRegulatoryLoader.js";

let cache = null;
let cachedYears = null;

export async function getHistoricalRegulatory(options = {}) {
  const key = JSON.stringify(options.years || null);
  if (cache && cachedYears === key) return cache;
  cache = await loadHistoricalRegulatory(options);
  cachedYears = key;
  return cache;
}
