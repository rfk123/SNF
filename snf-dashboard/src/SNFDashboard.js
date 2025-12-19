import React, { useState, useMemo, useEffect } from "react";
import {
  Search,
  ArrowRight,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Activity,
  MapPin,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  X,
} from "lucide-react";

const metricDefinitions = [
  { label: "Mobility at Discharge", currentKey: "Mobility at Discharge", historicalKey: "mobility_at_discharge", higherIsBetter: true, unit: "%", description: "Higher indicates patients regained more function", preference: "Higher is better", group: "outcomes" },
  { label: "Discharge to Community", currentKey: "Discharge to Community Rate", historicalKey: "discharge_to_community_rate", higherIsBetter: true, unit: "%", description: "Share of residents successfully discharged home", preference: "Higher is better", group: "outcomes" },
  { label: "Self-Care at Discharge", currentKey: "Self-Care at Discharge", historicalKey: "self_care_at_discharge", higherIsBetter: true, unit: "%", description: "Improvement in residents' ability to perform daily tasks", preference: "Higher is better", group: "outcomes" },
  { label: "Fall w/ Major Injury", currentKey: "Fall with Major Injury Rate", historicalKey: "fall_with_major_injury_rate", higherIsBetter: false, unit: "%", description: "Lower is safer; serious fall incidents", preference: "Lower is better", group: "safety" },
  { label: "Pressure Ulcer Rate", currentKey: "Pressure Ulcer Rate", historicalKey: "pressure_ulcer_rate", higherIsBetter: false, unit: "%", description: "Lower indicates better wound prevention", preference: "Lower is better", group: "safety" },
  { label: "Preventable Readmission", currentKey: "Preventable Readmission Rate", historicalKey: "preventable_readmission_rate", higherIsBetter: false, unit: "%", description: "Lower suggests fewer residents bounce back to hospitals", preference: "Lower is better", group: "safety" },
  { label: "Medication Review", currentKey: "Medication Review Rate", historicalKey: "medication_review_rate", higherIsBetter: true, unit: "%", description: "Residents receiving appropriate med reviews", preference: "Higher is better", group: "process" },
  { label: "Infection Rate", currentKey: "Healthcare-Associated Infection Rate", historicalKey: "healthcare_associated_infection_rate", higherIsBetter: false, unit: "%", description: "Lower is better; infection control indicator", preference: "Lower is better", group: "safety" },
  { label: "Short-stay Rehospitalization", currentKey: null, historicalKey: "short_stay_rehospitalization_rate", higherIsBetter: false, unit: "%", description: "After SNF admission, lower rehospitalization is better", preference: "Lower is better", group: "utilization" },
  { label: "Short-stay ED Visit", currentKey: null, historicalKey: "short_stay_ed_visit_rate", higherIsBetter: false, unit: "%", description: "ED visits after SNF admission (short-stay)", preference: "Lower is better", group: "utilization" },
  { label: "Long-stay Hospitalizations", currentKey: null, historicalKey: "long_stay_hospitalization_rate", higherIsBetter: false, unit: "", description: "Per 1000 long-stay resident days", preference: "Lower is better", group: "utilization" },
  { label: "Long-stay ED Visits", currentKey: null, historicalKey: "long_stay_ed_visit_rate", higherIsBetter: false, unit: "", description: "Per 1000 long-stay resident days", preference: "Lower is better", group: "utilization" },
];

const metricGroupLabels = {
  outcomes: "Patient Outcomes",
  safety: "Safety & Risk",
  process: "Care Process",
  utilization: "Utilization & Access",
};

const API_BASE =
  (process.env.REACT_APP_API_URL && process.env.REACT_APP_API_URL.replace(/\/$/, "")) ||
  "http://localhost:8080";

const formatNumber = (value, fractionDigits = 1) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toFixed(fractionDigits);
};

const compositeBadge = (score) => {
  if (score == null) return { label: "No score", bg: "pill-neutral" };
  if (score >= 80) return { label: "Excellent", bg: "pill-emerald" };
  if (score >= 60) return { label: "Strong", bg: "pill-lime" };
  if (score >= 40) return { label: "Average", bg: "pill-amber" };
  if (score >= 20) return { label: "Below Avg", bg: "pill-orange" };
  return { label: "High Risk", bg: "pill-rose" };
};

const resolveMetricValue = (facility, metric) => {
  const currentValue = metric.currentKey && metric.currentKey in facility ? facility[metric.currentKey] : undefined;
  const history = facility.historical_metrics || {};
  const years = Object.keys(history)
    .map((y) => Number(y))
    .sort((a, b) => a - b);

  let historicalLatest = null;
  let historicalLatestYear = null;
  if (years.length) {
    const latestYear = years[years.length - 1];
    const latestValue = history[latestYear]?.[metric.historicalKey];
    if (latestValue != null) {
      historicalLatest = latestValue;
      historicalLatestYear = latestYear;
    }
  }

  const value = currentValue ?? historicalLatest;
  const source = currentValue != null ? "current" : historicalLatest != null ? "historical" : null;

  let trend = null;
  if (years.length >= 2) {
    const earliestYear = years[0];
    const earliestValue = history[earliestYear]?.[metric.historicalKey];
    if (historicalLatest != null && earliestValue != null) {
      const delta = historicalLatest - earliestValue;
      const positive = delta > 0;
      const good = metric.higherIsBetter ? positive : !positive;
      trend = { delta, good, yearSpan: `${earliestYear}→${historicalLatestYear}` };
    }
  }

  return { value, source, historicalLatestYear, trend };
};

const formatMessageHtml = (text = "") => {
  const escape = (str) =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const escaped = escape(text);
  const withBold = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const withBreaks = withBold.replace(/\n/g, "<br />");
  return { __html: withBreaks };
};

const truncateReview = (text = "", maxLength = 220) => {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength).trim()}...`;
};

const SNFDashboard = () => {
  const [hospitalQuery, setHospitalQuery] = useState("");
  const [hospitalSuggestions, setHospitalSuggestions] = useState([]);
  const [selectedHospital, setSelectedHospital] = useState(null);
  const [facilities, setFacilities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastAnalyzedHospital, setLastAnalyzedHospital] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState(null);
  const [expandedFacilities, setExpandedFacilities] = useState({});
  const [showChatPanel, setShowChatPanel] = useState(false);

  useEffect(() => {
    if (!hospitalQuery || hospitalQuery.length < 2) {
      setHospitalSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const fetchSuggestions = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/hospitals/search?q=${encodeURIComponent(hospitalQuery)}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          setHospitalSuggestions(data);
        }
      } catch (err) {
        if (err.name !== "AbortError") console.error("Hospital search failed", err);
      }
    };

    fetchSuggestions();
    return () => controller.abort();
  }, [hospitalQuery]);

  const handleAnalyze = async () => {
    if (!selectedHospital) {
      alert("Please pick a hospital from the list before analyzing.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hospitalName: selectedHospital.hospital_name }),
      });
      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(details.error || "Failed to fetch data");
      }
      const data = await response.json();
      setFacilities(data.facilities || []);
      setLastAnalyzedHospital(data.hospital);
      setExpandedFacilities({});
    } catch (err) {
      console.error(err);
      setError(err.message || "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  const summary = useMemo(() => {
    if (!facilities.length) return null;
    const avgDistance = facilities.reduce((sum, f) => sum + (f.distance || 0), 0) / facilities.length;
    const avgComposite = facilities.reduce((sum, f) => sum + (f.Composite_Score || 0), 0) / facilities.length;
    const historicalCoverage = facilities.reduce((sum, f) => sum + (f.historical_years_available || 0), 0) / facilities.length;
    return { avgDistance, avgComposite, historicalCoverage };
  }, [facilities]);

  const buildRegulatorySnapshot = (facility) => {
    const reg = facility.regulatory_history || {};
    const citationYears = Object.keys(reg.citations || {})
      .map(Number)
      .sort((a, b) => a - b);
    const penaltyYears = Object.keys(reg.penalties || {})
      .map(Number)
      .sort((a, b) => a - b);
    const latestCitationYear = citationYears[citationYears.length - 1];
    const latestPenaltyYear = penaltyYears[penaltyYears.length - 1];
    return {
      citationYear: latestCitationYear,
      citationData: latestCitationYear ? reg.citations[latestCitationYear] : null,
      penaltyYear: latestPenaltyYear,
      penaltyData: latestPenaltyYear ? reg.penalties[latestPenaltyYear] : null,
    };
  };

  const handleChatSubmit = async () => {
    if (!selectedHospital || !chatInput.trim()) return;
    const question = chatInput.trim();
    setChatInput("");
    setChatError(null);
    setChatHistory((prev) => [...prev, { role: "user", text: question }]);

    setChatLoading(true);
    try {
      const outgoingHistory = [...chatHistory, { role: "user", text: question }];
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hospitalName: selectedHospital.hospital_name,
          question,
          history: outgoingHistory,
        }),
      });
      if (!res.ok) {
        const details = await res.json().catch(() => ({}));
        throw new Error(details.error || "Chat request failed");
      }
      const data = await res.json();
      setChatHistory((prev) => [...prev, { role: "assistant", text: data.reply }]);
    } catch (err) {
      console.error(err);
      setChatError(err.message || "Chat failed");
      setChatHistory((prev) => [...prev, { role: "assistant", text: "Sorry, I couldn't generate a response right now." }]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Hospital → SNF Explorer</p>
          <h1>Find reliable post-acute partners</h1>
          <p className="lede">
            Search any hospital, instantly see high-quality SNFs nearby, compare performance, and ask the assistant to sort or explain the results.
          </p>
        </div>
        <div className="hero-badge">
          <span className="dot" /> Live CMS metrics + historical trends
        </div>
      </header>

      <section className="panel search-panel">
        <div className="search-control">
          <label>Hospital</label>
          <div className="input-wrap">
            <Search className="icon" />
            <input
              placeholder="Search for a hospital..."
              value={hospitalQuery}
              onChange={(e) => {
                setHospitalQuery(e.target.value);
                setSelectedHospital(null);
              }}
            />
          </div>
          {hospitalSuggestions.length > 0 && (
            <div className="suggestions">
              {hospitalSuggestions.map((h) => (
                <button
                  key={`${h.hospital_name}-${h.city}`}
                  onClick={() => {
                    setSelectedHospital(h);
                    setHospitalQuery(h.hospital_name);
                    setHospitalSuggestions([]);
                  }}
                >
                  <div className="suggestion-title">{h.hospital_name}</div>
                  <div className="suggestion-sub">
                    {h.city ? `${h.city}, ` : ""}
                    {h.state}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="search-actions">
          <button className="ghost-btn" onClick={() => setHospitalQuery("")}>
            Clear
          </button>
          <button className="primary-btn" onClick={handleAnalyze} disabled={!selectedHospital || loading}>
            {loading ? (
              <>
                <RefreshCw className="icon spin" /> Running analysis...
              </>
            ) : (
              <>
                Run analysis <ArrowRight className="icon" />
              </>
            )}
          </button>
        </div>
        {selectedHospital && !loading && (
          <p className="selected-note">
            Selected: <strong>{selectedHospital.hospital_name}</strong>
            {selectedHospital.city && ` (${selectedHospital.city}, ${selectedHospital.state})`}
          </p>
        )}
        {error && <div className="alert">{error}</div>}
      </section>

      <div className="layout">
        <div className="main">
          {facilities.length > 0 ? (
            <>
              <section className="stat-grid">
                <div className="stat-card">
                  <p className="label">Facilities in scope</p>
                  <p className="value">{facilities.length}</p>
                  <p className="hint">Within 50 miles of {lastAnalyzedHospital?.name}</p>
                </div>
                <div className="stat-card">
                  <p className="label">Average distance</p>
                  <p className="value">{summary ? `${summary.avgDistance.toFixed(1)} mi` : "—"}</p>
                  <p className="hint">door-to-door estimate</p>
                </div>
                <div className="stat-card">
                  <p className="label">Composite score</p>
                  <p className="value">{summary ? summary.avgComposite.toFixed(0) : "—"}</p>
                  <p className="hint">average across returned facilities</p>
                </div>
                <div className="stat-card">
                  <p className="label">Historical coverage</p>
                  <p className="value">{summary ? summary.historicalCoverage.toFixed(1) : "0.0"}</p>
                  <p className="hint">avg. years of data available</p>
                </div>
              </section>

              <section className="facility-list">
                {facilities.map((facility) => {
                  const badge = compositeBadge(facility.Composite_Score);
                  const regulatorySnapshot = buildRegulatorySnapshot(facility);
                  const facilityKey = facility.provider_id || facility.facility_name;
                  const isExpanded = Boolean(expandedFacilities[facilityKey]);
                  const toggleExpanded = () =>
                    setExpandedFacilities((prev) => ({
                      ...prev,
                      [facilityKey]: !prev[facilityKey],
                    }));

                  const compactMetrics = [
                    {
                      label: "Mobility at Discharge",
                      value: resolveMetricValue(
                        facility,
                        metricDefinitions.find((m) => m.historicalKey === "mobility_at_discharge")
                      ).value,
                      unit: "%",
                    },
                    {
                      label: "Discharge to Community",
                      value: resolveMetricValue(
                        facility,
                        metricDefinitions.find((m) => m.historicalKey === "discharge_to_community_rate")
                      ).value,
                      unit: "%",
                    },
                    {
                      label: "Infection Rate",
                      value: resolveMetricValue(
                        facility,
                        metricDefinitions.find((m) => m.historicalKey === "healthcare_associated_infection_rate")
                      ).value,
                      unit: "%",
                    },
                    {
                      label: "Pressure Ulcer Rate",
                      value: resolveMetricValue(
                        facility,
                        metricDefinitions.find((m) => m.historicalKey === "pressure_ulcer_rate")
                      ).value,
                      unit: "%",
                    },
                  ];

                  const review = facility.review_enrichment;
                  const reviewSnippets = review?.recent_reviews?.slice(0, 3) || [];

                  return (
                    <div key={facilityKey} className="facility-card">
                      <div className="facility-header">
                        <div>
                          <div className="meta">
                            <MapPin className="icon tiny" />
                            {formatNumber(facility.distance, 1)} miles from hospital
                          </div>
                          <h2>{facility.facility_name}</h2>
                          <p className="meta">
                            {facility.city && `${facility.city}, `}
                            {facility.state} · CCN {facility.CCN || facility.provider_id}
                          </p>
                        </div>
                        <div className="metrics-mini">
                          <div>
                            <p className="label">Composite</p>
                            <p className="value">{formatNumber(facility.Composite_Score, 0)}</p>
                            <span className={`pill ${badge.bg}`}>{badge.label}</span>
                          </div>
                          <div>
                            <p className="label">CMS Stars</p>
                            <p className="value">{facility.overall_rating ?? "—"}</p>
                          </div>
                          <div>
                            <p className="label">Hist. coverage</p>
                            <p className="value">{facility.historical_years_available || 0}</p>
                            <p className="hint">years</p>
                          </div>
                        </div>
                      </div>

                      <div className="compact-metrics">
                        {compactMetrics.map((m) => (
                          <div key={m.label} className="compact-metric">
                            <p className="compact-label">{m.label}</p>
                            <p className="compact-value">
                              {formatNumber(m.value)}
                              {m.value !== null && m.value !== undefined && m.value !== "—" && m.unit ? (
                                <span className="unit">{m.unit}</span>
                              ) : null}
                            </p>
                          </div>
                        ))}
                        <button className="toggle-btn" onClick={toggleExpanded}>
                          {isExpanded ? (
                            <>
                              Hide details <ChevronUp className="icon tiny" />
                            </>
                          ) : (
                            <>
                              Show details <ChevronDown className="icon tiny" />
                            </>
                          )}
                        </button>
                      </div>

                      {isExpanded && (
                        <>
                          <div className="metric-groups">
                            {Object.entries(metricGroupLabels).map(([groupId, title]) => {
                              const metrics = metricDefinitions.filter((m) => m.group === groupId);
                              if (!metrics.length) return null;
                              return (
                                <div key={groupId} className="metric-group">
                                  <div className="metric-group-head">
                                    <h3>{title}</h3>
                                    <span>Current + History</span>
                                  </div>
                                  <div className="metric-grid">
                                    {metrics.map((metric) => {
                                      const resolved = resolveMetricValue(facility, metric);
                                      return (
                                        <div key={metric.label} className="metric-card">
                                          <div className="metric-top">
                                            <span>{metric.label}</span>
                                            <span className="source-tag">
                                              {resolved.source === "current"
                                                ? "Current (CMS)"
                                                : resolved.source === "historical"
                                                ? "Historical"
                                                : "No data"}
                                            </span>
                                          </div>
                                          <div className="metric-body">
                                            <div>
                                              <div className="metric-value">
                                                {formatNumber(resolved.value)}
                                                {metric.unit && resolved.value != null && <span className="unit">{metric.unit}</span>}
                                              </div>
                                              <p className="metric-desc">{metric.description}</p>
                                              <p className="metric-pref">{metric.preference}</p>
                                            </div>
                                            {resolved.value != null ? (
                                              resolved.trend ? (
                                                <div className="trend-wrap">
                                                  <div className={`trend-chip ${resolved.trend.good ? "good" : "bad"}`}>
                                                    {resolved.trend.good ? (
                                                      <TrendingUp className="icon tiny" />
                                                    ) : (
                                                      <TrendingDown className="icon tiny" />
                                                    )}
                                                    <span className="trend-delta">
                                                      {resolved.trend.delta > 0 ? "+" : ""}
                                                      {resolved.trend.delta.toFixed(1)}
                                                      {metric.unit}
                                                    </span>
                                                    <span className="trend-years">{resolved.trend.yearSpan}</span>
                                                  </div>
                                                  <div className="trend-timeline">
                                                    <div className="trend-node">
                                                      <span className="trend-label">Start</span>
                                                      <span className="trend-value">
                                                        {formatNumber(resolved.value - resolved.trend.delta)}
                                                        {metric.unit}
                                                      </span>
                                                    </div>
                                                    <span className="trend-line"></span>
                                                    <div className="trend-node">
                                                      <span className="trend-label">Latest</span>
                                                      <span className="trend-value">
                                                        {formatNumber(resolved.value)}
                                                        {metric.unit}
                                                      </span>
                                                    </div>
                                                  </div>
                                                </div>
                                              ) : (
                                                <div className="hint">Most recent: {resolved.historicalLatestYear || "—"}</div>
                                              )
                                            ) : (
                                              <div className="hint">N/A</div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div className="reg-block">
                            <div className="reg-head">
                              <h3>Regulatory snapshot</h3>
                              {regulatorySnapshot.citationYear && <span className="hint">Latest citation year: {regulatorySnapshot.citationYear}</span>}
                            </div>
                            {regulatorySnapshot.citationData || regulatorySnapshot.penaltyData ? (
                              <div className="reg-grid">
                                <div className="reg-card">
                                  <p className="label">Citations</p>
                                  {regulatorySnapshot.citationData ? (
                                    <div className="reg-rows">
                                      <div className="row">
                                        <span>Total citations</span>
                                        <span className="value-sm">{regulatorySnapshot.citationData.total}</span>
                                      </div>
                                      <div className="row">
                                        <span>Immediate jeopardy</span>
                                        <span>{regulatorySnapshot.citationData.immediateJeopardy}</span>
                                      </div>
                                      <div className="row">
                                        <span>Actual harm</span>
                                        <span>{regulatorySnapshot.citationData.actualHarm}</span>
                                      </div>
                                      <div className="row">
                                        <span>Infection control issues</span>
                                        <span>{regulatorySnapshot.citationData.infectionControl}</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="hint">No recent citations reported.</p>
                                  )}
                                </div>
                                <div className="reg-card">
                                  <p className="label">Penalties</p>
                                  {regulatorySnapshot.penaltyData ? (
                                    <div className="reg-rows">
                                      <div className="row">
                                        <span>Penalties issued</span>
                                        <span className="value-sm">{regulatorySnapshot.penaltyData.penalties}</span>
                                      </div>
                                      <div className="row">
                                        <span>Fines</span>
                                        <span>
                                          {regulatorySnapshot.penaltyData.finesCount} (${Number(regulatorySnapshot.penaltyData.finesTotal || 0).toLocaleString()})
                                        </span>
                                      </div>
                                      <div className="row">
                                        <span>Payment denials</span>
                                        <span>{regulatorySnapshot.penaltyData.paymentDenials}</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="hint">No monetary penalties recorded.</p>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <p className="hint">No regulatory data available yet.</p>
                            )}
                          </div>

                          <div className="review-block">
                            <div className="review-head">
                              <div>
                                <h3>Community voice</h3>
                                <p className="hint">Recent Google feedback</p>
                              </div>
                              <div className="review-stats">
                                {review?.google_rating != null && (
                                  <div className="review-pill">
                                    <span className="pill-label">Google rating</span>
                                    <span className="pill-value">{formatNumber(review.google_rating, 1)}</span>
                                    {review?.google_rating_count ? <span className="pill-sub">({review.google_rating_count} reviews)</span> : null}
                                  </div>
                                )}
                                {review?.recent_avg_rating != null && (
                                  <div className="review-pill alt">
                                    <span className="pill-label">Recent avg</span>
                                    <span className="pill-value">{formatNumber(review.recent_avg_rating, 1)}</span>
                                    {review?.recent_review_count ? <span className="pill-sub">last {review.recent_review_count} reviews</span> : null}
                                  </div>
                                )}
                              </div>
                            </div>
                            {reviewSnippets.length ? (
                              <div className="review-grid">
                                {reviewSnippets.map((quote, idx) => (
                                  <div key={idx} className="review-quote">
                                    <p className="quote-text">"{truncateReview(quote)}"</p>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="hint">No recent Google review snippets yet.</p>
                            )}
                          </div>
                        </>
                      )}

                      {facility.historical_years_available === 0 && <p className="hint">Historical CMS data not available for this CCN yet.</p>}
                    </div>
                  );
                })}
              </section>
            </>
          ) : lastAnalyzedHospital ? (
            <div className="empty">
              <Activity className="icon" />
              No facilities found within the default radius. Try a different hospital or widen your radius in the backend request.
            </div>
          ) : (
            <div className="empty">
              <Activity className="icon" />
              Choose a hospital to begin exploring nearby SNFs.
            </div>
          )}
        </div>
      </div>

      <button
        className="floating-chat-btn"
        onClick={() => setShowChatPanel(true)}
        disabled={!selectedHospital}
        title={selectedHospital ? "Open assistant" : "Select a hospital to chat"}
      >
        <MessageSquare className="icon" />
        <span>Assistant</span>
      </button>

      {showChatPanel && (
        <div className="floating-chat-panel">
          <div className="floating-chat-header">
            <div>
              <p className="label">AI Assistant</p>
              <p className="hint">
                {selectedHospital
                  ? `Context: ${selectedHospital.hospital_name}`
                  : "Select a hospital to ask about nearby SNFs."}
              </p>
            </div>
            <button className="ghost-btn close" onClick={() => setShowChatPanel(false)}>
              <X className="icon tiny" /> Close
            </button>
          </div>
          <div className="chat-body">
            {chatHistory.length === 0 && (
              <p className="hint">Ask about high-performing SNFs, trends, or risks near the selected hospital.</p>
            )}
            {chatHistory.map((msg, idx) => (
              <div key={idx} className={`chat-bubble ${msg.role === "user" ? "user" : "assistant"}`}>
                <span dangerouslySetInnerHTML={formatMessageHtml(msg.text)} />
              </div>
            ))}
          </div>
          {chatError && <div className="alert">{chatError}</div>}
          <div className="chat-input">
            <textarea
              rows={2}
              placeholder={
                selectedHospital ? `Ask about facilities near ${selectedHospital.hospital_name}...` : "Select a hospital first..."
              }
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={!selectedHospital || chatLoading}
            />
            <button className="primary-btn" onClick={handleChatSubmit} disabled={!selectedHospital || chatLoading || !chatInput.trim()}>
              {chatLoading ? "Working..." : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SNFDashboard;
