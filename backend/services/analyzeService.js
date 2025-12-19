import { haversine } from "../utils/distance.js";
import { geocodeHospitalAddress } from "../utils/geocode.js";
import { fetchQualityMetrics } from "../utils/cmsMetrics.js";

const DEFAULT_RADIUS_MILES = 50;
const DEFAULT_LIMIT = 5;

export async function performAnalysis({
  hospitalName,
  hospitals,
  snfs,
  historicalSnfTimelines = {},
  historicalRegulatory = {},
  googleReviewsService = null,
  googlePlaceIds = {},
  googlePlaceResolver = null,
  options = {},
}) {
  if (!hospitalName) throw new Error("hospitalName required");

  const {
    mode = "closest",
    radiusMiles = DEFAULT_RADIUS_MILES,
    limit = DEFAULT_LIMIT,
    sortBy,
    order,
  } = options;

  const hospital = hospitals.find(
    (h) => h.hospital_name.toUpperCase().trim() === hospitalName.toUpperCase().trim()
  );
  if (!hospital) {
    const err = new Error("Hospital not found");
    err.status = 404;
    throw err;
  }

  let hLat = parseFloat(hospital.Latitude);
  let hLon = parseFloat(hospital.Longitude);
  if (Number.isNaN(hLat) || Number.isNaN(hLon)) {
    const geo = await geocodeHospitalAddress({
      name: hospital.hospital_name,
      address: hospital.address,
      city: hospital.city,
      state: hospital.state,
      zip: hospital.zip_code,
    });
    hLat = geo.lat;
    hLon = geo.lon;
    hospital.latitude = hLat;
    hospital.longitude = hLon;
  }

  const withDistance = snfs
    .filter((f) => !isNaN(f.latitude) && !isNaN(f.longitude))
    .map((f) => ({
      ...f,
      distance: haversine(
        { lat: hLat, lon: hLon },
        { lat: f.latitude, lon: f.longitude }
      ),
    }))
    .filter((f) => f.distance <= radiusMiles);

  const resolvedSortBy = (sortBy || "").toLowerCase() || (mode === "best" ? "composite" : "distance");
  const defaultOrder = resolvedSortBy === "distance" ? "asc" : "desc";
  const resolvedOrder =
    (order || "").toLowerCase() === "asc" || (order || "").toLowerCase() === "desc"
      ? (order || "").toLowerCase()
      : defaultOrder;

  const ranked = [...withDistance].sort((a, b) => {
    const valueFor = (f) => {
      switch (resolvedSortBy) {
        case "rating":
        case "overall_rating":
          return f.overall_rating ?? f["Overall Rating"] ?? null;
        case "composite":
        case "composite_score":
          return f.Composite_Score ?? null;
        case "distance":
          return f.distance ?? null;
        case "name":
          return (f.facility_name || "").toLowerCase();
        default:
          return null;
      }
    };

    const valA = valueFor(a);
    const valB = valueFor(b);

    // Missing values sink to the bottom.
    if (valA == null && valB == null) return 0;
    if (valA == null) return 1;
    if (valB == null) return -1;

    const isAscending = resolvedOrder === "asc";

    if (typeof valA === "string" || typeof valB === "string") {
      return isAscending ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }

    return isAscending ? valA - valB : valB - valA;
  });

  const topFacilities = ranked.slice(0, limit || DEFAULT_LIMIT);
  const results = [];
  for (const [index, facility] of topFacilities.entries()) {
    const ccn =
      facility["CMS Certification Number (CCN)"] ||
      facility.CCN ||
      facility.provider_id ||
      facility.federal_provider_number;
    const normalizedCcn = ccn ? String(ccn).padStart(6, "0") : null;
    let placeId =
      facility.google_place_id ||
      facility.google_placeid ||
      facility.place_id ||
      facility.googlePlaceId ||
      (normalizedCcn ? googlePlaceIds[normalizedCcn]?.google_place_id : null) ||
      null;

    let quality = {};
    try {
      quality = await fetchQualityMetrics(ccn);
    } catch (err) {
      console.warn("CMS metrics fetch failed:", err.message);
    }

    const historical = ccn ? historicalSnfTimelines[ccn]?.years || {} : {};
    const regulatory = ccn ? historicalRegulatory[ccn] || null : null;
    if (!placeId && googlePlaceResolver) {
      const resolved = await googlePlaceResolver.getPlaceId(facility);
      if (resolved?.place_id) {
        placeId = resolved.place_id;
      }
    }

    let reviewEnrichment = null;
    if (googleReviewsService && placeId) {
      reviewEnrichment = await googleReviewsService.getReviewSnapshot(placeId);
    }

    results.push({
      ...facility,
      Local_Rank: index + 1,
      ...quality,
      historical_metrics: historical,
      historical_years_available: Object.keys(historical).length,
      regulatory_history: regulatory,
      review_enrichment: reviewEnrichment,
    });
  }

  return {
    hospital: {
      name: hospital.hospital_name,
      city: hospital.city,
      state: hospital.state,
      latitude: hLat,
      longitude: hLon,
    },
    facilities: results,
    totalWithinRadius: withDistance.length,
  };
}
