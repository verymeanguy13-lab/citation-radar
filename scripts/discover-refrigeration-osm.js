// CitationRadar -- Refrigeration/HVAC discovery, Step 0: free OSM/Overpass
// pass, before touching Places (billing) or Tavily (nearly-exhausted
// monthly quota).
//
// Scoped deliberately narrow per the blueprint (Section 10, v1.16):
// COMMERCIAL REFRIGERATION REPAIR specifically, not general comfort HVAC.
// OpenStreetMap tags both the same way (craft=hvac / shop=hvac covers
// furnace/AC installers too), so this script does NOT blindly insert
// every craft=hvac hit as a refrigeration prospect -- that would repeat
// the exact "wrong business" risk the cleaning-company script's own
// comments warned about, just via a different source.
//
// What it actually does:
//   1. Queries Overpass (free, no API key, no billing) for NYC-area
//      businesses tagged craft=hvac / shop=hvac, AND separately for
//      anything with "refrigeration" in its OSM name tag.
//   2. INSERTS only the name-matched ("refrigeration" literally in the
//      name) results into prospects -- a strong, on-scope signal, same
//      "no wrong business" bar the cleaning script held itself to.
//   3. PRINTS (does not insert) the broader craft/shop=hvac results as a
//      manual-review candidate list -- some of these may really do
//      commercial refrigeration repair without saying so in their name,
//      but that's a human judgment call, not a heuristic to encode here.
//
// No GOOGLE_PLACES_API_KEY, no TAVILY_API_KEY, no billing risk at all --
// Overpass is a free public API.
//
// Setup: nothing needed if DATABASE_URL is in .env.local (auto-loaded).
// Run with: node scripts/discover-refrigeration-osm.js

const SCRIPT_VERSION = 'v4-2026-09-04-osm-overpass-user-agent-fix';
console.log(`[discover-refrigeration-osm.js] version: ${SCRIPT_VERSION}`);

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

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

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
pool.on('error', (err) => {
  console.error(`[pool] background error on an idle connection (not fatal): ${err.message}`);
});
process.on('unhandledRejection', async (err) => {
  console.error('[fatal] Unhandled rejection:', err && err.message ? err.message : err);
  try { await pool.end(); } catch {}
  process.exit(1);
});

// Same NYC zip set already used for pest control and cleaning ingestion.
const NYC_ZIPS = new Set([
  '10001','10002','10003','10004','10005','10006','10007','10009','10010',
  '10011','10012','10013','10014','10016','10017','10018','10019','10020',
  '10021','10022','10023','10024','10025','10026','10027','10028','10029',
  '10030','10031','10032','10033','10034','10035','10036','10037','10038',
  '10039','10040','10044','10065','10069','10075','10128','10162','10165',
  '10199','10280','10282',
  '10451','10452','10453','10454','10455','10456','10457','10458','10459',
  '10460','10461','10462','10463','10464','10465','10466','10467','10468',
  '10469','10470','10471','10472','10473','10474','10475',
  '11201','11202','11203','11204','11205','11206','11207','11208','11209',
  '11210','11211','11212','11213','11214','11215','11216','11217','11218',
  '11219','11220','11221','11222','11223','11224','11225','11226','11228',
  '11229','11230','11231','11232','11233','11234','11235','11236','11237',
  '11238','11239','11241','11242','11243','11249','11252','11256',
  '11101','11102','11103','11104','11105','11106','11109','11120','11351',
  '11354','11355','11356','11357','11358','11359','11360','11361','11362',
  '11363','11364','11365','11366','11367','11368','11369','11370','11371',
  '11372','11373','11374','11375','11377','11378','11379','11385','11411',
  '11412','11413','11414','11415','11416','11417','11418','11419','11420',
  '11421','11422','11423','11424','11425','11426','11427','11428','11429',
  '11430','11431','11432','11433','11434','11435','11436','11439','11451',
  '11690','11691','11692','11693','11694','11695','11697',
  '10301','10302','10303','10304','10305','10306','10307','10308','10309',
  '10310','10311','10312','10313','10314',
]);

// NYC-ish bounding box, same one diag.js already used successfully.
const BBOX = '40.49,-74.26,40.92,-73.68';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The original version of this script combined 6 filters into one unioned
// query with "out center tags;" and got a 406 from Overpass's server --
// diag.js's much simpler single-statement query worked fine from the same
// machine seconds later, so the union/complexity was the likely trigger
// (regex name searches across a full city bbox are known to be expensive
// for Overpass's public instance). Real fix: run each filter as its own
// small, single-line query, exactly matching diag.js's proven shape, and
// merge the results in JS instead of asking Overpass to do it server-side.
const QUERIES = [
  { label: 'node craft=hvac', q: `[out:json][timeout:25];node["craft"="hvac"](${BBOX});out center tags;` },
  { label: 'way craft=hvac', q: `[out:json][timeout:25];way["craft"="hvac"](${BBOX});out center tags;` },
  { label: 'node shop=hvac', q: `[out:json][timeout:25];node["shop"="hvac"](${BBOX});out center tags;` },
  { label: 'way shop=hvac', q: `[out:json][timeout:25];way["shop"="hvac"](${BBOX});out center tags;` },
  { label: 'node name~refrigeration', q: `[out:json][timeout:25];node["name"~"refrigeration",i](${BBOX});out center tags;` },
  { label: 'way name~refrigeration', q: `[out:json][timeout:25];way["name"~"refrigeration",i](${BBOX});out center tags;` },
];

// The main public instance (overpass-api.de) is a free, shared,
// sometimes-flaky community resource -- it can start rejecting or
// dropping requests under load with no relation to query correctness.
// Kumi Systems runs a separate, independently-operated public mirror of
// the same Overpass API as a fallback for exactly this situation.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function fetchOverpassOne(query) {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          // Kumi's mirror said this outright (HTTP 429 with a plain-text
          // explanation); overpass-api.de's vague 406 was almost
          // certainly the same root cause with a less helpful message.
          'User-Agent': 'CitationRadarBot/1.0 (+business contact research for citationradar.pro; not a scraper of personal data)',
        },
        body: query,
      });
      if (!res.ok) {
        throw new Error(`${endpoint} -> HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      // try the next endpoint
    }
  }
  throw lastErr;
}

async function fetchOverpass() {
  let elements = [];
  for (const { label, q } of QUERIES) {
    process.stdout.write(`Querying Overpass: ${label}... `);
    try {
      const data = await fetchOverpassOne(q);
      console.log(`${data.elements.length} results.`);
      elements = elements.concat(data.elements);
    } catch (err) {
      console.log(`FAILED on all endpoints: ${err.message}`);
    }
    await sleep(1500); // be polite to these shared public instances
  }
  return { elements };
}

function extractRecord(el) {
  const tags = el.tags || {};
  const name = tags.name || null;
  if (!name) return null;
  const phone = tags.phone || tags['contact:phone'] || null;
  const website = tags.website || tags['contact:website'] || null;
  const zip = tags['addr:postcode'] || null;
  const isNameMatch = /refrigeration/i.test(name);
  const isHvacTag = tags.craft === 'hvac' || tags.shop === 'hvac';
  return {
    osm_id: `${el.type}/${el.id}`,
    name,
    phone,
    website,
    zip,
    isNameMatch,
    isHvacTag,
  };
}

async function main() {
  console.log('Querying Overpass (free, no API key, no billing)...\n');
  const data = await fetchOverpass();
  console.log(`Overpass returned ${data.elements.length} raw elements.\n`);

  const seen = new Set();
  const nameMatches = [];
  const hvacTagOnly = [];

  for (const el of data.elements) {
    const rec = extractRecord(el);
    if (!rec) continue;
    if (seen.has(rec.osm_id)) continue;
    seen.add(rec.osm_id);

    // Only reject if a zip IS present and it's clearly not NYC -- missing
    // zip is common in OSM and shouldn't disqualify an in-bbox result.
    if (rec.zip && !NYC_ZIPS.has(rec.zip)) continue;

    if (rec.isNameMatch) {
      nameMatches.push(rec);
    } else if (rec.isHvacTag) {
      hvacTagOnly.push(rec);
    }
  }

  console.log(`"refrigeration" literally in the name: ${nameMatches.length} (these get inserted as real prospects)`);
  console.log(`Tagged craft/shop=hvac only, no "refrigeration" in name: ${hvacTagOnly.length} (printed only, NOT inserted -- general HVAC/AC installers live in here too)\n`);

  const SOURCE_NAME = 'osm_overpass_refrigeration_name_match';
  console.log(`Clearing any prior '${SOURCE_NAME}' rows (safe re-run)...`);
  const deleted = await pool.query('DELETE FROM prospects WHERE source = $1', [SOURCE_NAME]);
  console.log(`Removed ${deleted.rowCount} old rows.\n`);

  console.log(`Inserting ${nameMatches.length} name-matched refrigeration prospects...`);
  for (const r of nameMatches) {
    const contactMethod = (r.phone || r.website) ? 'osm_website' : 'none';
    await pool.query(
      `INSERT INTO prospects (business_name, buyer_category, city_code, zip_code, source, contact_method, phone, website)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [r.name, 'refrigeration', 'NYC', r.zip, SOURCE_NAME, contactMethod, r.phone, r.website]
    );
  }

  const total = await pool.query('SELECT count(*) FROM prospects WHERE source = $1', [SOURCE_NAME]);
  const withPhone = await pool.query(`SELECT count(*) FROM prospects WHERE source = $1 AND phone IS NOT NULL`, [SOURCE_NAME]);
  const withWebsite = await pool.query(`SELECT count(*) FROM prospects WHERE source = $1 AND website IS NOT NULL`, [SOURCE_NAME]);

  console.log('\n=== Inserted (name-matched "refrigeration") ===');
  console.log(`Total: ${total.rows[0].count}`);
  console.log(`With phone: ${withPhone.rows[0].count}`);
  console.log(`With website: ${withWebsite.rows[0].count}`);

  console.log('\n=== NOT inserted -- craft/shop=hvac candidates for manual review ===');
  console.log('(business name | zip | phone | website)');
  for (const r of hvacTagOnly.slice(0, 60)) {
    console.log(`${r.name} | ${r.zip || '?'} | ${r.phone || '-'} | ${r.website || '-'}`);
  }
  if (hvacTagOnly.length > 60) {
    console.log(`...and ${hvacTagOnly.length - 60} more (not printed, list was capped at 60 for readability).`);
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error('Discovery failed:', err.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
