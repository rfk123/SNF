// backend/routes/hospitals.js
import express from "express";
import { norm } from "../utils/strings.js";
import { searchHospitalsByName } from "../services/cmsService.js";

export default function hospitalsRouter({ hospitals }) {
  const router = express.Router();

  // Search hospitals (typeahead)
  router.get("/search", (req, res) => {
    const q = norm(req.query.q || "");
    if (!q) return res.json([]);

    const matches = hospitals
      .filter((h) => norm(h.hospital_name).includes(q))
      .slice(0, 20);

    res.json(matches.map((h) => ({
      hospital_name: h.hospital_name,
      city: h.city,
      state: h.state,
      latitude: h.latitude,
      longitude: h.longitude,
    })));
  });

  // Exact lookup (by name)
  router.get("/by-name", (req, res) => {
    const q = norm(req.query.name || "");
    const found = hospitals.find((h) => norm(h.hospital_name) === q);
    if (!found) return res.status(404).json({ error: "Not found" });
    res.json(found);
  });

  router.get("/cms/search", async (req, res) => {
    try {
      const query = req.query.q || "";
      if (!query.trim()) return res.json([]);

      console.log("[Route] /api/hospitals/cms/search", {
        query,
        state: req.query.state,
        limit: req.query.limit,
      });

      const results = await searchHospitalsByName(query, {
        limit: req.query.limit,
        state: req.query.state,
      });

      res.json(results);
    } catch (err) {
      console.error("[CMS Hospital Search] Failed:", err.message);
      res.status(502).json({ error: "CMS hospital search failed" });
    }
  });

  return router;
}
