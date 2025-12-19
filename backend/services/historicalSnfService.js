// backend/services/historicalSnfService.js
// Thin wrapper around the historical SNF CSV loader.

import { loadHistoricalSNFQuality, describeHistoricalRequirements } from "../loaders/historicalSnfLoader.js";

let cachedTimelines = null;
let cachedOptionsKey = null;

function buildOptionsKey(options = {}) {
  const years = options.years ? [...options.years] : undefined;
  return JSON.stringify({
    years,
    filename: options.filename,
  });
}

export async function getHistoricalSnfTimelines(options = {}) {
  const key = buildOptionsKey(options);
  if (cachedTimelines && cachedOptionsKey === key) {
    return cachedTimelines;
  }

  cachedTimelines = await loadHistoricalSNFQuality(options);
  cachedOptionsKey = key;
  return cachedTimelines;
}

export function getHistoricalSnfMeta() {
  return describeHistoricalRequirements();
}
