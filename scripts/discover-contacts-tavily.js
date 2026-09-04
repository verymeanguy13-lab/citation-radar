// CitationRadar -- Tavily contact discovery.
//
// VERSION MARKER (change this string any time you touch this file, so a
// crash's first console line always proves which file actually ran):
const SCRIPT_VERSION = 'v3-2026-09-04-pool-tavily-attempted';
console.log(`[discover-contacts-tavily.js] version: ${SCRIPT_VERSION}`);

// Session 15 continuation -- real root cause of the "Connection terminated
// unexpectedly" / "Unhandled 'error' event" crash:
//
//   The old version opened ONE pg Client and held it open for the entire
//   run (~20-30 min for ~1,000 rows). Most of that time is spent waiting
//   on Tavily + outbound fetch() calls to prospect websites -- the DB
//   connection just sits there idle. Neon's serverless compute can drop an
//   idle connection in the background at any point; when it does, pg's
//   Client emits an 'error' EVENT (not a promise rejection), and Node
//   crashes the whole process if nothing is listening for it -- which is
//   exactly the raw-stack-trace crash reported. A client.on('error', ...)
//   handler alone would have caught THIS specific event, but the file that
//   was actually being run (confirmed by its Aug 25 file timestamp) never
//   had one -- the fix never made it into the file that was run.
//
//   Real fix here: switch to a Pool. A Pool only checks out a real
//   connection for the instant a query actually runs, so nothing is ever
//   idle long enough to hit Neon's timeout, AND pool.on('error', ...)
//   catches any background disconnect of an idle pooled client without
//   crashing the process (this is node-postgres's own documented pattern
//   for this exact failure mode).
//
// Also added: a tavily_attempted column so re-runs skip rows that were
// already tried and came back with a genuine negative (no candidate / not
// live / domain mismatch), not just rows that already succeeded -- this
// was described in the last handoff but, like the crash fix, never
// actually made it into this file. Transient failures (network errors,
// Tavily rate limits, a DB write hiccup) do NOT set tavily_attempted, so
// those rows are retried on the next run instead of being silently
// skipped forever.
//
// Also added: an 8s timeout on every outbound fetch (Tavily search and the
// "is this site live" GET) via AbortController -- previously an
// unresponsive small-business server could hang a fetch indefinitely,
// which is exactly the kind of long gap that made the old idle-connection
// problem worse.
//
// Setup: nothing needed if DATABASE_URL and TAVILY_API_KEY are already in
// your .env.local (this script loads it automatically, see loadEnvLocal
// below). Otherwise set them yourself first:
//   $env:DATABASE_URL = "your-connection-string"
//   $env:TAVILY_API_KEY = "your-tavily-key"
// Run with: node scripts/discover-contacts-tavily.js

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Loads KEY=value lines from .env.local in the project root into
// process.env, WITHOUT ever printing or logging their values, and only
// for keys that aren't already set (so an explicit $env:... still wins).
// No new dependency -- this is intentionally a few lines, not the full
// dotenv package.
function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  let loaded = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = value;
      loaded++;
    }
  }
  if (loaded > 0) console.log(`Loaded ${loaded} value(s) from .env.local.`);
}
loadEnvLocal();

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
if (!TAVILY_API_KEY) {
  console.error('Missing TAVILY_API_KEY.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

// Required pattern for pg Pools: without this listener, a background
// disconnect of an idle pooled client crashes the process with an
// unhandled 'error' event -- the exact bug this rewrite fixes.
pool.on('error', (err) => {
  console.error(`[pool] background error on an idle connection (expected occasionally with Neon's serverless compute -- not fatal): ${err.message}`);
});

// Belt-and-suspenders: if anything else still slips through as an
// unhandled rejection or exception, log it clearly instead of dumping a
// bare Node stack trace, and shut the pool down cleanly before exiting.
process.on('unhandledRejection', async (err) => {
  console.error('[fatal] Unhandled rejection:', err && err.message ? err.message : err);
  try { await pool.end(); } catch {}
  process.exit(1);
});
process.on('uncaughtException', async (err) => {
  console.error('[fatal] Uncaught exception:', err && err.message ? err.message : err);
  try { await pool.end(); } catch {}
  process.exit(1);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const AGGREGATOR_DOMAINS = [
  'yelp.com', 'facebook.com', 'mapquest.com', 'yellowpages.com',
  'bbb.org', 'linkedin.com', 'instagram.com', 'google.com',
  'manta.com', 'yellowbook.com', 'angi.com', 'thumbtack.com',
  'zoominfo.com', 'dnb.com', 'buzzfile.com', 'chamberofcommerce.com',
  'crunchbase.com', 'opencorporates.com', 'superpages.com', 'local.com',
];

const STOPWORDS = new Set([
  'INC','LLC','CORP','CO','LTD','PC','PEST','CONTROL','EXTERMINATING',
  'EXTERMINATION','EXTERMINATOR','EXTERMINATORS','MANAGEMENT','SOLUTIONS',
  'SERVICES','SERVICE','OF','THE','AND','NYC','NEW','YORK','US','USA',
]);

function distinctiveTokens(name) {
  return (name || '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function isAggregator(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return AGGREGATOR_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return true;
  }
}

// Returns { ok, rateLimited, results }. rateLimited=true means "transient,
// retry later" -- distinct from a normal empty result.
async function tavilySearch(query) {
  const res = await fetchWithTimeout('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: TAVILY_API_KEY, query, max_results: 5 }),
  }, 10000);

  if (res.status === 429) {
    return { ok: false, rateLimited: true, results: [] };
  }
  if (!res.ok) {
    throw new Error(`Tavily API error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return { ok: true, rateLimited: false, results: data.results || [] };
}

// GET instead of HEAD -- many real servers block/mishandle HEAD requests
// even when the site works completely fine.
async function confirmLive(url) {
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'CitationRadarBot/1.0 (+contact info lookup for B2B outreach)' },
    }, 8000);
    return res.ok;
  } catch {
    return false;
  }
}

function verifyAgainstDomain(url, businessName) {
  const tokens = distinctiveTokens(businessName);
  if (tokens.length === 0) return { status: 'no_tokens' };
  const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  const matched = tokens.filter((t) => host.includes(t.toLowerCase()));
  return matched.length > 0 ? { status: 'match' } : { status: 'no_match' };
}

// Marks a row's outcome. `attempted` should be true for a genuine result
// (found / no candidate / not live / no match / too generic) and false for
// a transient failure that should be retried next run.
async function recordOutcome(id, { attempted, website, matchConfidence }) {
  if (website) {
    await pool.query(
      `UPDATE prospects
       SET website = $1, contact_method = 'tavily_search', match_confidence = $2,
           contact_verified = true, tavily_attempted = true
       WHERE id = $3`,
      [website, matchConfidence, id]
    );
  } else {
    await pool.query(
      `UPDATE prospects SET tavily_attempted = $1 WHERE id = $2`,
      [attempted, id]
    );
  }
}

async function main() {
  console.log('Connecting and running startup migrations...');
  await pool.query(`ALTER TABLE prospects DROP CONSTRAINT IF EXISTS prospects_contact_method_check;`);
  await pool.query(`
    ALTER TABLE prospects ADD CONSTRAINT prospects_contact_method_check
    CHECK (contact_method IN ('osm_website','domain_guess','manual_maps','places_api','tavily_search','none'));
  `);
  await pool.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS tavily_attempted BOOLEAN DEFAULT false;`);
  console.log('Migrations done.\n');

  const { rows } = await pool.query(`
    SELECT id, business_name, registry_city
    FROM prospects
    WHERE source = 'ny_dec_pesticide_registry'
      AND contact_verified = false
      AND tavily_attempted = false
    ORDER BY id;
  `);
  console.log(`${rows.length} prospects still need contact discovery (never verified, never attempted).`);
  console.log('Note: this pool is specifically the businesses Places already');
  console.log('could NOT confidently verify -- expect a real hit rate lower');
  console.log('than the 30-40% seen elsewhere, not the same rate.\n');

  const toProcess = rows.slice(0, 1000);
  let verified = 0;
  let noTokens = 0;
  let noMatch = 0;
  let notLive = 0;
  let noCandidate = 0;
  let rateLimitSkipped = 0;
  let transientErrors = 0;

  for (const [i, p] of toProcess.entries()) {
    process.stdout.write(`[${i + 1}/${toProcess.length}] ${p.business_name}... `);
    try {
      const search = await tavilySearch(`${p.business_name} ${p.registry_city || 'NYC'} pest control`);

      if (search.rateLimited) {
        rateLimitSkipped++;
        console.log('Tavily rate-limited -- will retry next run, backing off 10s');
        await sleep(10000);
        continue; // NOT marked attempted -- retried next run
      }

      const candidate = search.results.find((r) => r.url && !isAggregator(r.url));

      if (!candidate) {
        noCandidate++;
        console.log('no candidate');
        await recordOutcome(p.id, { attempted: true });
        await sleep(300);
        continue;
      }

      const live = await confirmLive(candidate.url);
      if (!live) {
        notLive++;
        console.log('candidate found but not live -- skipped');
        await recordOutcome(p.id, { attempted: true });
        await sleep(300);
        continue;
      }

      const verification = verifyAgainstDomain(candidate.url, p.business_name);
      if (verification.status === 'match') {
        await recordOutcome(p.id, { attempted: true, website: candidate.url, matchConfidence: 'strong' });
        verified++;
        console.log(`FOUND -> ${candidate.url}`);
      } else if (verification.status === 'no_tokens') {
        noTokens++;
        console.log('business name too generic to verify -- skipped');
        await recordOutcome(p.id, { attempted: true });
      } else {
        noMatch++;
        console.log(`candidate found but domain does not match -- skipped (${candidate.url})`);
        await recordOutcome(p.id, { attempted: true });
      }
    } catch (err) {
      // Transient (network blip, DB write hiccup, etc.) -- do NOT mark
      // attempted, so this row is retried next run instead of silently
      // wasting its one shot.
      transientErrors++;
      console.log(`TRANSIENT ERROR (will retry next run): ${err.message}`);
    }
    await sleep(300);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Found and verified: ${verified}`);
  console.log(`No candidate at all: ${noCandidate}`);
  console.log(`Candidate not live: ${notLive}`);
  console.log(`Candidate found, domain didn't match: ${noMatch}`);
  console.log(`Business name too generic to verify: ${noTokens}`);
  console.log(`Rate-limited by Tavily (will retry next run): ${rateLimitSkipped}`);
  console.log(`Transient errors (will retry next run): ${transientErrors}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error('Discovery failed:', err.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
