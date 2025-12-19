// backend/routes/analyze.js
import express from "express";
import { performAnalysis } from "../services/analyzeService.js";

export default function analyzeRouter({
  hospitals,
  snfs,
  historicalSnfTimelines = {},
  historicalRegulatory = {},
  googleReviewsService = null,
  googlePlaceIds = {},
  googlePlaceResolver = null,
}) {
  const router = express.Router();

  router.post("/", async (req, res) => {
    try {
      const { hospitalName, mode, radiusMiles, limit } = req.body || {};
      if (!hospitalName) return res.status(400).json({ error: "hospitalName required" });

      const result = await performAnalysis({
        hospitalName,
        hospitals,
        snfs,
        historicalSnfTimelines,
        historicalRegulatory,
        googleReviewsService,
        googlePlaceIds,
        googlePlaceResolver,
        options: { mode, radiusMiles, limit },
      });

      console.log(
        `✅ Analyzed ${result.hospital.name} (${result.hospital.latitude}, ${result.hospital.longitude})`
      );
      console.log(`✅ Within radius: ${result.totalWithinRadius}`);
      console.log(`✅ Returning ${result.facilities.length} ranked facilities`);

      return res.json({
        hospital: result.hospital,
        facilities: result.facilities,
        totalWithinRadius: result.totalWithinRadius,
      });
    } catch (err) {
      console.error(err);
      if (err.status === 404) {
        return res.status(404).json({ error: err.message });
      }
      res.status(500).json({ error: err.message || "Analyze failed" });
    }
  });

  return router;
}
