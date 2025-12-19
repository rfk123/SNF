// backend/scripts/geocode_hospitals.js
import { loadHospitalsRaw } from "../utils/csvLoader.js";
import { geocodeHospitalAddress } from "../utils/geocode.js";

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  const hospitals = await loadHospitalsRaw(); // raw rows from hospitals.csv (no lat/lon)
  const out = [];

  for (let i = 0; i < hospitals.length; i++) {
    const h = hospitals[i];
    const addr = {
      name: h["Facility Name"],
      address: h["Address"],
      city: h["City/Town"],
      state: h["State"],
      zip: h["ZIP Code"]
    };

    try {
      const coords = await geocodeHospitalAddress(addr);
      out.push({ ...h, latitude: coords.lat, longitude: coords.lon, geocoder: coords.provider });
      // Nominatim courtesy: 1 req/sec max. If using only Google, you can reduce/dismiss delay.
      if (!process.env.GOOGLE_MAPS_KEY) await sleep(1100);
    } catch (e) {
      console.error(`Failed: ${addr.name} — ${e.message}`);
      out.push({ ...h, latitude: null, longitude: null, geocoder: null });
      // brief pause anyway
      await sleep(300);
    }

    if ((i + 1) % 50 === 0) {
      console.log(`Progress: ${i + 1}/${hospitals.length}`);
    }
  }

  console.log(`Done. Geocoded ${out.length} hospitals (results cached in Postgres)`);
})();
