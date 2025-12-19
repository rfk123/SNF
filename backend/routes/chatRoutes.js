import express from "express";
import fetch from "node-fetch";
import { performAnalysis } from "../services/analyzeService.js";

const METRIC_KEYS = [
  { key: "self_care", label: "Self-care at Discharge" },
  { key: "mobility", label: "Mobility at Discharge" },
  { key: "discharge", label: "Discharge to Community Rate" },
  { key: "pressure_ulcer", label: "Pressure Ulcer Rate" },
  { key: "falls", label: "Fall with Major Injury Rate" },
  { key: "infection", label: "Healthcare-Associated Infection Rate" },
  { key: "rehospitalization", label: "Short-stay Rehospitalization Rate" },
  { key: "readmission", label: "Preventable Readmission Rate" },
  { key: "med_review", label: "Medication Review Rate" },
  { key: "mspb", label: "MSPB" },
  { key: "ss_ed_visit", label: "Short-stay ED Visit Rate" },
  { key: "ls_hosp", label: "Long-stay Hospitalization Rate" },
  { key: "ls_ed_visit", label: "Long-stay ED Visit Rate" },
];

const TREND_METRICS = {
  self_care: {
    historicalKey: "self_care_at_discharge",
    label: "Self-care at Discharge",
    unit: "%",
    higherIsBetter: true,
  },
  mobility: {
    historicalKey: "mobility_at_discharge",
    label: "Mobility at Discharge",
    unit: "%",
    higherIsBetter: true,
  },
  discharge: {
    historicalKey: "discharge_to_community_rate",
    label: "Discharge to Community Rate",
    unit: "%",
    higherIsBetter: true,
  },
  pressure_ulcer: {
    historicalKey: "pressure_ulcer_rate",
    label: "Pressure Ulcer Rate",
    unit: "%",
    higherIsBetter: false,
  },
  infection: {
    historicalKey: "healthcare_associated_infection_rate",
    label: "Healthcare-Associated Infection Rate",
    unit: "%",
    higherIsBetter: false,
  },
};

export default function chatRoutes({
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
      const { hospitalName, question, mode, radiusMiles, limit, sortBy, order, history } =
        req.body || {};
      if (!hospitalName || !question) {
        return res.status(400).json({ error: "hospitalName and question required" });
      }

      const { inferredSortBy, inferredOrder } = inferSort(question, sortBy, order);
      const isSortRequest = Boolean(inferredSortBy);

      const analysis = await performAnalysis({
        hospitalName,
        hospitals,
        snfs,
        historicalSnfTimelines,
        historicalRegulatory,
        googleReviewsService,
        googlePlaceIds,
        googlePlaceResolver,
        options: {
          mode,
          radiusMiles,
          limit,
          sortBy: inferredSortBy,
          order: inferredOrder,
        },
      });

      // If the user asked for a specific ordering, provide a deterministic answer
      // from our sorted facilities to avoid hallucinated facilities.
      let reply = null;
      if (isSortRequest) {
        reply = formatSortedFacilities({
          facilities: analysis.facilities,
          sortBy: inferredSortBy,
          order: inferredOrder,
          hospitalName,
        });
      }

      if (!reply) {
        const trendFocus = detectTrendFocus(question);
        const trendAnswer = trendFocus
          ? buildTrendAnswer(analysis.facilities, trendFocus, hospitalName)
          : null;
        if (trendAnswer) {
          reply = trendAnswer;
        }
      }

      if (!reply) {
        const context = buildContext(analysis, question);
        reply = await generateChatReply(question, context, history);
      }

      res.json({
        reply,
        hospital: analysis.hospital,
        facilities: analysis.facilities,
      });
    } catch (err) {
      console.error("[Chat] Failed:", err);
      if (err.status === 404) {
        return res.status(404).json({ error: err.message });
      }
      res.status(500).json({ error: err.message || "Chat failed" });
    }
  });

  // Tool-friendly endpoint: lets the assistant or UI request a sorted/filtered view
  // without invoking the LLM, so the page can update (e.g., "top 5 best-rated SNFs").
  router.get("/view", async (req, res) => {
    try {
      const {
        hospitalName,
        mode,
        radiusMiles,
        limit,
        sortBy,
        order,
      } = req.query || {};

      if (!hospitalName) {
        return res.status(400).json({ error: "hospitalName required" });
      }

      const analysis = await performAnalysis({
        hospitalName,
        hospitals,
        snfs,
        historicalSnfTimelines,
        historicalRegulatory,
        googleReviewsService,
        googlePlaceIds,
        googlePlaceResolver,
        options: {
          mode,
          radiusMiles: radiusMiles ? Number(radiusMiles) : undefined,
          limit: limit ? Number(limit) : undefined,
          sortBy,
          order,
        },
      });

      res.json({
        hospital: analysis.hospital,
        facilities: analysis.facilities,
        totalWithinRadius: analysis.totalWithinRadius,
        sort: {
          by: sortBy || (mode === "best" ? "composite" : "distance"),
          order: order || (sortBy === "distance" ? "asc" : "desc"),
        },
      });
    } catch (err) {
      console.error("[Chat:view] Failed:", err);
      if (err.status === 404) {
        return res.status(404).json({ error: err.message });
      }
      res.status(500).json({ error: err.message || "View fetch failed" });
    }
  });

  return router;
}

function formatSortedFacilities({ facilities = [], sortBy, order, hospitalName }) {
  if (!facilities.length) {
    return `I couldn't find any skilled nursing facilities for ${hospitalName || "that hospital"}.`;
  }

  const label =
    sortBy === "rating"
      ? "overall rating"
      : sortBy === "distance"
      ? "distance"
      : "composite score";

  const direction = order === "asc" ? "lowest to highest" : "highest to lowest";

  const lines = facilities.slice(0, 5).map((f, idx) => {
    const composite = f.Composite_Score ?? f.composite_score ?? "n/a";
    const stars = f.overall_rating ?? f["Overall Rating"] ?? "n/a";
    const distance = f.distance != null ? `${f.distance.toFixed(1)} mi` : "distance n/a";
    return `${idx + 1}. ${f.facility_name} – Composite ${composite}, Stars ${stars}, ${distance}`;
  });

  return `Here are the SNFs ordered by ${label} (${direction}):\n${lines.join("\n")}`;
}

function inferSort(question, explicitSortBy, explicitOrder) {
  if (explicitSortBy) {
    return {
      inferredSortBy: explicitSortBy,
      inferredOrder: explicitOrder,
    };
  }

  const q = (question || "").toLowerCase();
  const descHint =
    q.includes("highest") ||
    q.includes("greatest") ||
    q.includes("top") ||
    q.includes("best") ||
    q.includes("high to low") ||
    q.includes("desc");
  const ascHint =
    q.includes("lowest") ||
    q.includes("least") ||
    q.includes("low to high") ||
    q.includes("asc") ||
    q.includes("smallest");
  const inferredOrder = descHint ? "desc" : ascHint ? "asc" : undefined;

  if (q.includes("composite")) {
    return {
      inferredSortBy: "composite",
      inferredOrder: inferredOrder || "desc",
    };
  }
  if (q.includes("rating") || q.includes("stars")) {
    return {
      inferredSortBy: "rating",
      inferredOrder: inferredOrder || "desc",
    };
  }
  if (q.includes("distance") || q.includes("closest") || q.includes("nearest")) {
    return { inferredSortBy: "distance", inferredOrder: "asc" };
  }

  return { inferredSortBy: explicitSortBy, inferredOrder: explicitOrder };
}

function detectTrendFocus(question = "") {
  const q = question.toLowerCase();
  const hasTrendIntent =
    q.includes("trend") ||
    q.includes("improve") ||
    q.includes("increase") ||
    q.includes("change") ||
    q.includes("delta");
  if (!hasTrendIntent) return null;
  if (q.includes("self-care") || q.includes("self care")) return "self_care";
  if (q.includes("mobility")) return "mobility";
  if (q.includes("discharge")) return "discharge";
  if (q.includes("pressure ulcer") || q.includes("ulcer")) return "pressure_ulcer";
  if (q.includes("infection")) return "infection";
  return "mobility"; // default to a meaningful higher-is-better metric
}

function buildTrendAnswer(facilities, metricKey, hospitalName) {
  if (!facilities?.length || !TREND_METRICS[metricKey]) return null;
  const ranked = facilities
    .map((f) => {
      const trend = f.trends?.[metricKey];
      if (!trend) return null;
      return { facility: f, trend };
    })
    .filter(Boolean)
    .sort((a, b) => b.trend.improvement - a.trend.improvement || (a.facility.distance || 0) - (b.facility.distance || 0));

  if (!ranked.length) return null;

  const top = ranked.slice(0, 3);
  const metricLabel = TREND_METRICS[metricKey].label;

  const lines = top.map(({ facility, trend }, idx) => {
    const deltaStr = `${trend.delta > 0 ? "+" : ""}${trend.delta.toFixed(1)}${trend.unit || ""}`;
    return `${idx + 1}. ${facility.facility_name} – ${deltaStr} ${trend.earliestYear}→${trend.latestYear}, ${formatDistance(
      facility.distance
    )}`;
  });

  return `Biggest improvement in ${metricLabel} near ${hospitalName}:\n${lines.join("\n")}`;
}

function formatDistance(d) {
  if (d == null) return "";
  return `${Number(d).toFixed(1)} mi`;
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  const trimmed = history.slice(-6); // keep last 6 turns max
  return trimmed
    .map((h) => {
      const role = h.role === "assistant" ? "assistant" : "user";
      return { role, text: String(h.text || "").slice(0, 800) };
    })
    .filter((h) => h.text.trim().length);
}

function buildContext(analysis, question) {
  function detectMetricFocus(question = "") {
    const q = question.toLowerCase();
    if (q.includes("self-care") || q.includes("self care")) return "self_care";
    if (q.includes("mobility")) return "mobility";
    if (q.includes("discharge to community") || q.includes("community discharge"))
      return "discharge";
    if (q.includes("pressure ulcer") || q.includes("ulcer")) return "pressure_ulcer";
    return null;
  }

  function getMetricValue(f, latestHistorical, key) {
    if (key === "self_care") {
      return f["Self-Care at Discharge"] ?? latestHistorical.self_care_at_discharge ?? null;
    }
    if (key === "mobility") {
      return f["Mobility at Discharge"] ?? latestHistorical.mobility_at_discharge ?? null;
    }
    if (key === "discharge") {
      return (
        f["Discharge to Community Rate"] ??
        latestHistorical.discharge_to_community_rate ??
        null
      );
    }
    if (key === "falls") {
      return (
        f["Fall with Major Injury Rate"] ??
        latestHistorical.fall_with_major_injury_rate ??
        null
      );
    }
    if (key === "infection") {
      return (
        f["Healthcare-Associated Infection Rate"] ??
        latestHistorical.healthcare_associated_infection_rate ??
        null
      );
    }
    if (key === "pressure_ulcer") {
      return f["Pressure Ulcer Rate"] ?? latestHistorical.pressure_ulcer_rate ?? null;
    }
    if (key === "med_review") {
      return (
        f["Medication Review Rate"] ??
        latestHistorical.medication_review_rate ??
        null
      );
    }
    if (key === "mspb") {
      return f["Medicare Spending Per Beneficiary (MSPB)"] ?? latestHistorical.mspb ?? null;
    }
    if (key === "rehospitalization") {
      return (
        f["Preventable Readmission Rate"] ??
        latestHistorical.short_stay_rehospitalization_rate ??
        null
      );
    }
    if (key === "readmission") {
      return latestHistorical.preventable_readmission_rate ?? f["Preventable Readmission Rate"] ?? null;
    }
    if (key === "ss_ed_visit") {
      return latestHistorical.short_stay_ed_visit_rate ?? null;
    }
    if (key === "ls_hosp") {
      return latestHistorical.long_stay_hospitalization_rate ?? null;
    }
    if (key === "ls_ed_visit") {
      return latestHistorical.long_stay_ed_visit_rate ?? null;
    }
    return null;
  }

  const metricFocus = detectMetricFocus(question);

  function computeTrend(f, metricKey) {
    const meta = TREND_METRICS[metricKey];
    if (!meta) return null;
    const history = f.historical_metrics || {};
    const years = Object.keys(history)
      .map(Number)
      .sort((a, b) => a - b);
    if (years.length < 2) return null;
    const earliestYear = years[0];
    const latestYear = years[years.length - 1];
    const earliestVal = history[earliestYear]?.[meta.historicalKey];
    const latestVal = history[latestYear]?.[meta.historicalKey];
    if (earliestVal == null || latestVal == null) return null;
    const delta = latestVal - earliestVal;
    const improvement = meta.higherIsBetter ? delta : -delta;
    return { delta, improvement, earliestYear, latestYear, earliestVal, latestVal, unit: meta.unit, label: meta.label };
  }

  const sortedFacilities = metricFocus
    ? [...analysis.facilities].sort((a, b) => {
        const latestYearA = Object.keys(a.historical_metrics || {})
          .map(Number)
          .sort((x, y) => y - x)[0];
        const latestYearB = Object.keys(b.historical_metrics || {})
          .map(Number)
          .sort((x, y) => y - x)[0];
        const latestHistoricalA =
          latestYearA !== undefined ? a.historical_metrics?.[latestYearA] || {} : {};
        const latestHistoricalB =
          latestYearB !== undefined ? b.historical_metrics?.[latestYearB] || {} : {};

        const metricA = getMetricValue(a, latestHistoricalA, metricFocus);
        const metricB = getMetricValue(b, latestHistoricalB, metricFocus);

        const scoreA = metricA ?? -Infinity;
        const scoreB = metricB ?? -Infinity;
        if (scoreA === scoreB) return (a.distance || 0) - (b.distance || 0);
        return scoreB - scoreA;
      })
    : analysis.facilities;

  const topFacilities = sortedFacilities
    .map((f) => {
      const latestYear = Object.keys(f.historical_metrics || {})
        .map(Number)
        .sort((a, b) => b - a)[0];
      const latestHistorical =
        latestYear !== undefined ? f.historical_metrics?.[latestYear] || {} : {};

      return {
        name: f.facility_name,
        distance_miles: Number(f.distance?.toFixed(1)),
        composite_score: f.Composite_Score,
        cms_stars: f.overall_rating,
        city: f.city,
        state: f.state,
        review: summarizeReview(f.review_enrichment),
        metrics: Object.fromEntries(
          METRIC_KEYS.map(({ key }) => [
            key,
            getMetricValue(f, latestHistorical, key),
          ])
        ),
        trends: Object.fromEntries(
          Object.keys(TREND_METRICS).map((key) => [key, computeTrend(f, key)])
        ),
        regulatory: summarizeRegulatory(f.regulatory_history),
      };
    })
    .slice(0, 5);

  return {
    hospital: analysis.hospital,
    facilities: topFacilities,
    metricFocus,
  };
}

function summarizeRegulatory(regHistory) {
  if (!regHistory) return null;
  const latestYear = Object.keys(regHistory.citations || {})
    .map(Number)
    .sort((a, b) => b - a)[0];
  const latestPenYear = Object.keys(regHistory.penalties || {})
    .map(Number)
    .sort((a, b) => b - a)[0];

  return {
    citations: latestYear ? regHistory.citations[latestYear] : null,
    penalties: latestPenYear ? regHistory.penalties[latestPenYear] : null,
  };
}

function summarizeReview(enrichment) {
  if (!enrichment) return null;
  const snippets = Array.isArray(enrichment.recent_reviews)
    ? enrichment.recent_reviews.slice(0, 2)
    : [];
  return {
    google_rating: enrichment.google_rating ?? null,
    google_rating_count: enrichment.google_rating_count ?? null,
    recent_avg_rating: enrichment.recent_avg_rating ?? null,
    recent_review_count: enrichment.recent_review_count ?? null,
    snippets,
  };
}

async function generateChatReply(question, context, history = []) {
  const apiKey = process.env.OPENAI_API_KEY;
  const prompt = createPrompt(question, context);

  if (!apiKey) {
    return fallbackAnswer(context, question);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You explain hospital-to-SNF referral information clearly and concisely. Rules: (1) Use only the facilities provided—never add others. (2) If the list is already sorted or top-N, just restate it. (3) Use conversation history to resolve pronouns like 'that SNF'. (4) Keep answers tight and factual. (5) You may ask ONE short, relevant follow-up only if it meaningfully improves the answer (e.g., clarify metric focus or distance). Otherwise, don't ask questions. (6) No chit-chat.",
          },
          ...normalizeHistory(history).map((msg) => ({
            role: msg.role,
            content: msg.text,
          })),
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`LLM call failed: ${details}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim();
    return reply || fallbackAnswer(context, question);
  } catch (err) {
    console.warn("[Chat] LLM fallback triggered:", err.message);
    return fallbackAnswer(context, question);
  }
}

function createPrompt(question, context) {
  const hospitalLine = `${context.hospital.name} (${context.hospital.city}, ${context.hospital.state})`;
  const facilityLines = context.facilities
    .map((f, idx) => {
      const metrics = METRIC_KEYS.map(({ key, label }) => {
        const val = f.metrics[key];
        return val != null ? `${label} ${val}%` : null;
      }).filter(Boolean);
      const trends = Object.entries(f.trends || {})
        .map(([key, trend]) => {
          if (!trend) return null;
          const meta = TREND_METRICS[key];
          const formattedDelta = `${trend.delta > 0 ? "+" : ""}${trend.delta.toFixed(1)}${meta?.unit || ""}`;
          return `${meta?.label || key} ${formattedDelta} (${trend.earliestYear}→${trend.latestYear})`;
        })
        .filter(Boolean)
        .slice(0, 3);
      if (f.regulatory?.citations?.total)
        metrics.push(`Citations ${f.regulatory.citations.total}`);
      if (f.review?.google_rating != null) {
        metrics.push(
          `Google ${Number(f.review.google_rating).toFixed(1)} (${f.review.google_rating_count ?? "?"} reviews)`
        );
      }

      const reviewSnippet =
        f.review?.snippets && f.review.snippets.length
          ? ` Review: "${f.review.snippets[0].slice(0, 160)}${f.review.snippets[0].length > 160 ? "..." : ""}"`
          : "";

      return `${idx + 1}. ${f.name} (${f.city}, ${f.state}) – ${(f.distance_miles ?? "?")} mi, Composite ${
        f.composite_score ?? "n/a"
      }, Stars ${f.cms_stars ?? "n/a"}. ${metrics.join("; ")}${trends.length ? ` | Trends: ${trends.join("; ")}` : ""}${reviewSnippet}`;
    })
    .join("\n");

  return `Hospital: ${hospitalLine}

Nearby facilities:
${facilityLines}

${context.metricFocus ? `Primary metric focus for this question: ${
    context.metricFocus === "self_care"
      ? "Self-care at Discharge"
      : context.metricFocus === "mobility"
      ? "Mobility at Discharge"
      : context.metricFocus === "pressure_ulcer"
      ? "Pressure Ulcer Rate"
      : "Discharge to Community Rate"
  }` : ""}

Question: ${question}

Answer the question using only this data.`;
}

function fallbackAnswer(context, question) {
  if (!context.facilities.length) {
    return "I couldn't find any skilled nursing facilities within range of that hospital.";
  }

  const top = context.facilities[0];
  return `I don't have access to the AI service right now, but ${top.name} (Composite ${
    top.composite_score ?? "n/a"
  }, ${top.distance_miles ?? "?"} miles away) appears to be one of the stronger options near ${
    context.hospital.name
  }.`;
}
