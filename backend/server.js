// backend/server.js
import "dotenv/config";
import express from "express";
import cors from "cors";

import { loadHospitals } from "./loaders/hospitalsLoader.js";
import { loadSNFs } from "./loaders/snfsLoader.js";
import hospitalsRouter from "./routes/hospitals.js";
import analyzeRouter from "./routes/analyze.js";
import chatRoutes from "./routes/chatRoutes.js";
import { getHistoricalSnfTimelines } from "./services/historicalSnfService.js";
import { getHistoricalRegulatory } from "./services/historicalRegulatoryService.js";
import { createGoogleReviewsService } from "./services/googleReviewsService.js";
import { loadGooglePlaceIds } from "./loaders/googlePlaceIdsLoader.js";
import { createGooglePlaceResolver } from "./services/googlePlaceResolverService.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Load datasets at boot
const hospitals = await loadHospitals();
const snfs = await loadSNFs();
const historicalSnfTimelines = await getHistoricalSnfTimelines();
const historicalRegulatory = await getHistoricalRegulatory();
const googleReviewsService = createGoogleReviewsService();
const googlePlaceIds = await loadGooglePlaceIds();
const googlePlaceResolver = createGooglePlaceResolver({ seedPlaceIds: googlePlaceIds });

console.log(
  `Loaded ${hospitals.length} hospitals, ${snfs.length} SNFs, ${Object.keys(historicalSnfTimelines).length} historical SNF timelines, ${Object.keys(historicalRegulatory).length} regulatory timelines, ${Object.keys(googlePlaceIds).length} Google place ids`
);

app.get("/", (_req, res) => res.json({ ok: true }));

// Routes
app.use("/api/hospitals", hospitalsRouter({ hospitals }));
app.use(
  "/api/analyze",
  analyzeRouter({
    hospitals,
    snfs,
    historicalSnfTimelines,
    historicalRegulatory,
    googleReviewsService,
    googlePlaceIds,
    googlePlaceResolver,
  })
);
app.use(
  "/api/chat",
  chatRoutes({
    hospitals,
    snfs,
    historicalSnfTimelines,
    historicalRegulatory,
    googleReviewsService,
    googlePlaceIds,
    googlePlaceResolver,
  })
);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
});
