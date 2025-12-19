# SNF Referral Assistant

An end-to-end prototype for hospital-to-SNF referral assistance. It includes:
- **backend/**: Express API for hospital/SNF lookup, analysis, and chat responses.
- **snf-dashboard/**: React app that consumes the API and renders the assistant UI.

## Quick start
Prereqs: Node 18+, PostgreSQL.

1) Install deps  
```
cd backend && npm install
cd ../snf-dashboard && npm install
```
2) Configure env (see below), create your Postgres database, and sync the schema  
```
cd ../backend
npx prisma generate
npx prisma db push   # creates tables defined in prisma/schema.prisma
npm start            # defaults to http://localhost:8080
```
3) Start the frontend in another shell  
```
cd snf-dashboard
npm start         # http://localhost:3000
```
4) Open http://localhost:3000 and choose a hospital to see nearby SNFs.

## Environment variables (backend)
- `OPENAI_API_KEY` (optional): Enables live LLM replies; without it you get deterministic fallbacks.
- `OPENAI_MODEL` (optional): Defaults to `gpt-4o-mini`. Avoid passing temperature; the route is hardcoded to a safe default.
- `PORT` (optional): API port (default 8080).
- `GOOGLE_MAPS_KEY` (optional): Used first for geocoding hospitals that lack coordinates.
- `GOOGLE_PLACES_API_KEY` (optional): Used to resolve Google Place IDs and fetch reviews.
- `NOMINATIM_USER_AGENT` (optional): Custom UA for the OpenStreetMap geocoder fallback.
- `DATABASE_URL` (required): Postgres connection string (see `backend/.env.example`).

## Data flow (backend)
- Hospitals and SNFs load at boot from Postgres (canonical storage). If the tables are empty or `CMS_FORCE_REFRESH=1`, data is fetched from CMS and normalized, using CSVs in `backend/data/raw/` only as seed/fallback inputs. Normalized results are upserted into Postgres.
- Geocode cache, Google place IDs, and Google review snapshots are persisted in Postgres (no filesystem writes at runtime).
- `performAnalysis` ranks SNFs by distance or composite score and attaches historical metrics/regulatory data.
- The chat route can either call the LLM (if a key is present) or return deterministic summaries/fallbacks.

## API surface
Base URL: `http://localhost:8080/api`

- `GET /hospitals/search?q=` — typeahead; returns up to 20 hospitals.
- `GET /hospitals/by-name?name=` — exact hospital match.
- `GET /hospitals/cms/search?q=&state=&limit=` — CMS hospital search via `cmsService` (requires network).
- `POST /analyze` — rank SNFs near a hospital. Body: `{ hospitalName, mode?, radiusMiles?, limit? }`.  
  - `mode`: `closest` (default) or `best` (composite score).
  - Returns `{ hospital, facilities, totalWithinRadius }`.
- `GET /chat/view` — tool/UI-friendly view of sorted SNFs, no LLM. Query: `hospitalName`, plus optional `sortBy`, `order`, `radiusMiles`, `limit`, `mode`.  
  - `sortBy`: `composite` | `rating` | `distance` | `name`.  
  - `order`: `asc` | `desc`.  
  - Returns `{ hospital, facilities, totalWithinRadius, sort }`.
- `POST /chat` — chat reply plus facilities. Body: `{ hospitalName, question, sortBy?, order?, mode?, radiusMiles?, limit? }`.  
  - If `sortBy`/`order` or a sort intent is detected, the reply is deterministic from the server-sorted facilities.  
  - With `OPENAI_API_KEY`, non-sort questions use the LLM; otherwise a fallback answer is returned.  
  - Returns `{ reply, hospital, facilities }`.

### Example requests
Top 5 by composite for a hospital (deterministic, no LLM):
```
curl "http://localhost:8080/api/chat/view?hospitalName=Johnson%20City%20Medical%20Center&sortBy=composite&order=desc&limit=5"
```

Chat with LLM/fallback:
```
curl -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"hospitalName":"Johnson City Medical Center","question":"Order the SNFs by composite score, highest to lowest","sortBy":"composite","order":"desc","limit":5}'
```

## Frontend (snf-dashboard)
- Create React App, served at http://localhost:3000 via `npm start`.
- Expects the API at `http://localhost:8080`. Update any API base path in frontend config if you change ports.
- The assistant UI should call `POST /api/chat` for natural-language replies and `GET /api/chat/view` for deterministic sort/filter updates (e.g., `update_view` tool actions).

## Development tips
- If geocoding is blocked, ensure hospitals in `backend/data` include lat/lon, or supply `GOOGLE_MAPS_KEY`.
- If the LLM model rejects parameters, the route falls back automatically; verify `OPENAI_MODEL` if you override it.
- Logs are printed from the backend on analyze/chat calls to show counts and sorting behavior.

## Project layout
- `backend/` — Express API, loaders, services, utils, data cache.
- `snf-dashboard/` — React frontend (CRA). Default CRA README remains inside this folder.
