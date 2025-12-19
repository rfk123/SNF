# Historical SNF Quality Data

The backend now supports loading historical (2022‑2024) SNF quality extracts directly from CSV files. Place the files in:

```
backend/data/historical/<year>/snf_quality.csv
```

The loader parses the standard CMS columns (e.g. `CMS Certification Number (CCN)`, `Pressure Ulcer Rate`, `Discharge to Community Rate`, etc.) and exposes a timeline of metrics keyed by CCN.

The historical loader reads:

- `NH_ProviderInfo_JanYYYY.csv` for baseline facility info (city, county, ownership, etc.)
- `NH_QualityMsr_MDS_JanYYYY.csv` for resident-outcome measures (pressure ulcers, falls, etc.)
- `NH_QualityMsr_Claims_JanYYYY.csv` for claim-based utilization measures (rehospitalizations, ED visits)

Selected metric mappings:

| Metric Key | Source | CMS Measure Description |
| --- | --- | --- |
| `pressure_ulcer_rate` | MDS (code 453) | % of high-risk long-stay residents with pressure ulcers |
| `fall_with_major_injury_rate` | MDS (code 410) | % of long-stay residents with falls causing major injury |
| `medication_review_rate` | MDS (code 452) | % of residents receiving appropriate med reviews |
| `self_care_at_discharge` | SNF QRP Provider (code S_024_04_OBS_RATE) | % of residents meeting expected self-care ability at discharge |
| `mobility_at_discharge` | SNF QRP Provider (code S_025_04_OBS_RATE) | % of residents meeting expected mobility at discharge |
| `discharge_to_community_rate` | MDS (code 430 proxy) | % of residents successfully discharged (placeholder) |
| `healthcare_associated_infection_rate` | MDS (code 407 proxy) | Infection-control proxy |
| `short_stay_rehospitalization_rate` | Claims (code 521) | % of short-stay residents rehospitalized after SNF admission |
| `short_stay_ed_visit_rate` | Claims (code 522) | % of short-stay residents with outpatient ED visits |
| `long_stay_hospitalization_rate` | Claims (code 551) | Hospitalizations per 1000 long-stay resident days |
| `long_stay_ed_visit_rate` | Claims (code 552) | ED visits per 1000 long-stay resident days |

Usage example:

```js
import { getHistoricalSnfTimelines } from "../services/historicalSnfService.js";

const timelines = await getHistoricalSnfTimelines(); // loads 2022-2024
console.log(timelines["015009"].years[2023].pressure_ulcer_rate);
```

Facilities missing city/county/zip in the CMS feed automatically inherit those values from the provider info CSV, so distance calculations remain accurate.
