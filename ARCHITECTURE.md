# CitationRadar -- Architecture

## What this is
B2B alert/lead-gen tool built on public restaurant health-inspection-violation data for NYC (DOHMH) and Toronto (DineSafe). Buyers: pest control, commercial cleaning, refrigeration/HVAC companies, food-safety and restaurant consultants.

## Stack
- Next.js (App Router), Vercel Hobby, Neon Postgres (single free-tier project)
- Data ingestion: GitHub Actions ONLY, two independent workflows (one per city) -- never Vercel cron (Hobby cadence/duration limits), never server-side self-chaining, never browser-triggered fetching.
- All ingestion writes are BATCHED (chunks of ~500 rows per multi-row upsert), never one row per query.
- No local dev via GitHub-web-UI-only -- this project uses VS Code + git locally, Windows/PowerShell environment. Repo is public (deliberate choice).

## Data sources
- NYC: DOHMH Restaurant Inspection Results, Socrata (data.cityofnewyork.us), Local Law 11 of 2012 -- explicit "no restrictions," not subject to copyright.
- Toronto: DineSafe, CKAN-based (open.toronto.ca catalogue), Open Government Licence - Toronto -- explicit commercial-use grant. CONFIRMED (v1.7): open.toronto.ca/dataset/dinesafe/ is LIVE, daily-refreshed -- it renders via client-side JS, so static-HTML fetchers see a stale "Retired" banner -- ignore that. resource_id af0f5b8a-4b73-4a50-8781-65e949792b40, package_id b6b4f3fb-2e2c-47e7-931d-b87d22806948. Phone field confirmed native.

## City-scoping -- the core correctness property of this product
A NYC saved search must NEVER match a Toronto violation, and vice versa. Enforced at two independent layers:
1. Application logic: every matching query includes city_code as a hard condition (Session 10).
2. Database trigger: enforce_city_match() on search_matches raises an exception if a saved_search and violation have different city_code -- see schema.sql. A bug in the app layer cannot silently produce a cross-city alert; the database itself refuses the insert.

Session 10 includes a named, mandatory test proving this property holds.

## Monitoring -- two-class failure taxonomy
- LOUD failures (fetch throws, HTTP error, parse exception): GitHub Actions' own workflow-failure notification + a direct Resend email to the owner.
- SILENT failures (nothing looks broken, but something is wrong) -- checked at the end of every ingestion run, before marking status='success':
  a. Zero new rows when the dataset's own historical cadence says there should be some -- distinguish "not published yet" (log no_new_data) from "scraper reading stale/wrong data" (needs a human).
  b. Row count for this run is wildly different from that dataset's typical volume (order-of-magnitude check, not a fixed threshold).
  c. Expected fields missing from the API response (Socrata/CKAN both occasionally restructure columns) -- fail loudly, do not insert nulls.

Any of these sets ingestion_runs.status = 'partial', which triggers the same owner-facing alert email as a loud failure.

## Ingestion cadence vs. digest cadence
Ingestion (Sessions 4-5) runs DAILY, decoupled from the customer-facing digest, which stays WEEKLY (Session 11). Ingestion cost is trivial either way (Section 3), so run it daily and let violations sit in the database as soon as they're published -- this avoids stacking our own schedule on top of the source's own publish lag. Session 11's digest also gets a same-day CRITICAL-flag path, separate from the weekly batch: violations flagged CRITICAL by the source city go out as soon as the next daily ingestion run picks them up, not held for the weekly send. Everything else stays weekly.

## Free-tier constraints (verified)
- Vercel Hobby: cron cadence and duration limits are why ingestion runs on GitHub Actions instead -- see above. ToS prohibits commercial use; upgrade to Pro triggers on first real transaction or resource limits, whichever comes first -- not a fixed session number.
- Neon Free: single project sufficient (100 projects/account allowed on current free tier), 0.5GB storage cap per project -- monitor as both cities' violation tables grow.
- GitHub Actions: 2,000 free minutes/month on private OR public repos -- two city-scoped ingestion runs, once per day each, use a trivial fraction of this.

## Payments
Paddle as Merchant of Record. Built in Session 13, left dormant (no live checkout) until the owner is actually ready to charge real customers. Known Paddle account gotcha from a prior account: fill the Legal Name field and screenshot before submitting -- support response times can be slow.

## How to add corrections or new features in a later session
Never renumber or edit earlier sessions. Add a new session at the end of the current roadmap, state plainly which earlier session/file it corrects, and log it in the Corrections & Additions Log (Section 12). Same rule for schema.sql: append a dated migration block, never edit an existing table.

## Honesty commitments, implemented as real features (see Section 1.3)
- Contact info: NYC DOHMH's dataset natively includes a PHONE field (confirmed: 449,556 of 449,573 records populated, ~99.99% coverage) -- no external API, no cost, already covered by the same license as the rest of the dataset. Toronto's DineSafe schema is unconfirmed as of this writing -- Session 5 Step 0 checks for a native contact field before considering any external source. Do NOT default to a paid API (e.g. Google Places, which costs real money above a small free tier -- see Section 1.3 for the actual numbers) without exhausting free options first: the source dataset itself, then OpenStreetMap/Overpass (free, lower coverage) as a fallback only if Toronto's data has no phone field.
- Lag transparency: every ingestion run calculates median_lag_days (inspection_date to actual ingestion). Ingestion polls MORE frequently than each source's own update cadence, specifically so our pipeline never adds delay on top of the government's. The measured number becomes a marketing claim in Session 15, not a caveat.

## Two-city ceiling -- validation footprint, not the end state
NYC + Toronto's combined buyer pool across all five vendor categories is realistically in the hundreds, not thousands -- fine for proving the model, not the growth plan. city_code is a first-class field throughout the schema specifically so a third city is a new ingestion pipeline plus a cities row, not a redesign.

## Session log
(updated after every session)

- **Session 1** -- Project Setup. Created package.json (Next.js 14.x), app/layout.js, app/page.js (placeholder), vercel.json (empty crons array -- ingestion runs via GitHub Actions, not Vercel).
- **Session 2** -- Architecture doc + Design System. Created this ARCHITECTURE.md from the blueprint's Section 6. Added app/globals.css with a clean B2B compliance-tool design system, including a distinct visual tag/color per city (NYC vs Toronto) so the UI never lets a user forget which city's data they're looking at -- reinforces the Section 1 city-scoping requirement at the UI layer, ahead of the DB-level enforcement landing in Session 3/10.