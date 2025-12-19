import fetch from "node-fetch";

const ENDPOINTS = {
  mobility: "https://data.cms.gov/data-api/v1/dataset/7n6i-h54b/data",
  discharge: "https://data.cms.gov/data-api/v1/dataset/wx4g-vf68/data",
  falls: "https://data.cms.gov/data-api/v1/dataset/pudx-xr8z/data",
  hai: "https://data.cms.gov/data-api/v1/dataset/9v7z-2f5y/data",
};

// generic helper to fetch CMS rows by CCN
async function fetchCMSMetric(ccn, metric) {
  const url = `${ENDPOINTS[metric]}?provider_number=${ccn}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CMS ${metric} fetch failed`);
  const data = await res.json();
  // defensive: return first row if any
  return data[0] || null;
}

export async function fetchQualityMetrics(ccn) {
  try {
    const [mob, dis, fall, hai] = await Promise.allSettled([
      fetchCMSMetric(ccn, "mobility"),
      fetchCMSMetric(ccn, "discharge"),
      fetchCMSMetric(ccn, "falls"),
      fetchCMSMetric(ccn, "hai"),
    ]);

    return {
      "Mobility at Discharge": mob.value?.mobility_percent ?? null,
      "Discharge to Community Rate": dis.value?.discharge_to_community_percent ?? null,
      "Fall with Major Injury Rate": fall.value?.fall_with_major_injury_percent ?? null,
      "Healthcare-Associated Infection Rate": hai.value?.hai_percent ?? null,
    };
  } catch (e) {
    console.warn("CMS metrics fetch failed:", e.message);
    return {};
  }
}
