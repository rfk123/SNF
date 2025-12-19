import fs from "fs";
import path from "path";
import csv from "csv-parser";

//
// Generic CSV loader
//
function loadCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => {
        const cleaned = {};
        for (const key in row) {
          const value = row[key];
          if (value === "" || value === null) {
            cleaned[key] = null;
          } else if (!isNaN(value)) {
            cleaned[key] = parseFloat(value);
          } else {
            cleaned[key] = value;
          }
        }
        results.push(cleaned);
      })
      .on("end", () => resolve(results))
      .on("error", reject);
  });
}

//
// Load SNF data (default)
//
export async function loadSNFs() {
  const filePath = path.resolve("data/raw/snfs.csv");
  return await loadCSV(filePath);
}

//
// Load hospitals data
//  - looks for geocoded cache first
//  - falls back to hospitals.csv if cache not found
//
export async function loadHospitals() {
  const rawPath = path.resolve("data/raw/hospitals.csv");
  return await loadCSV(rawPath);
}

//
// Simple combined loader (for quick debugging / analysis)
//
export async function loadCSVData() {
  const snfs = await loadSNFs();
  const hospitals = await loadHospitals();
  return { snfs, hospitals };
}
