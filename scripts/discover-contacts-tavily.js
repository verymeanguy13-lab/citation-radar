// CitationRadar -- Tavily contact discovery, FIXED.
// Bug 1: contact_method CHECK constraint didn't allow 'tavily_search' --
// this script now adds it via migration before running.
// Bug 2: HEAD requests were wrongly rejecting known-good, working sites
// (many servers block/mishandle HEAD even when GET works fine) -- now
// uses GET instead.
//
// Setup:
//   $env:DATABASE_URL = "your-connection-string"
//   $env:TAVILY_API_KEY = "your-tavily-key"
// Run with: node scripts/discover-contacts-tavily.js

const { Client } = require('pg');

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
if (!TAVILY_API_KEY) {
  console.error('Missing TAVILY_API_KEY.');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function tavilySearch(query) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: TAVILY_API_KEY, query, max_results: 5 }),
  });
  if (!res.ok) {
    throw new Error(`Tavily API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// FIXED: GET instead of HEAD -- many real servers block/mishandle HEAD
// requests even when the site works completely fine, which was wrongly
// rejecting known-good sites like Alternative Pest Control's.
async function confirmLive(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'CitationRadarBot/1.0 (+contact info lookup for B2B outreach)' },
    });
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

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log('Adding tavily_search to allowed contact_method values...');
  await client.query(`ALTER TABLE prospects DROP CONSTRAINT IF EXISTS prospects_contact_method_check;`);
  await client.query(`
    ALTER TABLE prospects ADD CONSTRAINT prospects_contact_method_check
    CHECK (contact_method IN ('osm_website','domain_guess','manual_maps','places_api','tavily_search','none'));
  `);
  console.log('Done.\n');

  const { rows } = await client.query(`
    SELECT id, business_name, registry_city
    FROM prospects
    WHERE source = 'ny_dec_pesticide_registry' AND contact_verified = false
    ORDER BY id;
  `);
  console.log(`${rows.length} prospects still need contact discovery.`);
  console.log('Note: this pool is specifically the businesses Places already');
  console.log('could NOT confidently verify -- expect a real hit rate lower');
  console.log('than the 30-40% seen elsewhere, not the same rate.\n');

  const toProcess = rows.slice(0, 1000);
  let verified = 0;
  let noTokens = 0;
  let noMatch = 0;
  let notLive = 0;
  let noCandidate = 0;

  for (const [i, p] of toProcess.entries()) {
    process.stdout.write(`[${i + 1}/${toProcess.length}] ${p.business_name}... `);
    try {
      const data = await tavilySearch(`${p.business_name} ${p.registry_city || 'NYC'} pest control`);
      const candidate = (data.results || []).find((r) => r.url && !isAggregator(r.url));

      if (!candidate) {
        noCandidate++;
        console.log('no candidate');
        await sleep(300);
        continue;
      }

      const live = await confirmLive(candidate.url);
      if (!live) {
        notLive++;
        console.log('candidate found but not live -- skipped');
        await sleep(300);
        continue;
      }

      const verification = verifyAgainstDomain(candidate.url, p.business_name);
      if (verification.status === 'match') {
        await client.query(
          `UPDATE prospects SET website = $1, contact_method = 'tavily_search', match_confidence = 'strong', contact_verified = true WHERE id = $2`,
          [candidate.url, p.id]
        );
        verified++;
        console.log(`FOUND -> ${candidate.url}`);
      } else if (verification.status === 'no_tokens') {
        noTokens++;
        console.log('business name too generic to verify -- skipped');
      } else {
        noMatch++;
        console.log(`candidate found but domain does not match -- skipped (${candidate.url})`);
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
    await sleep(300);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Found and verified: ${verified}`);
  console.log(`No candidate at all: ${noCandidate}`);
  console.log(`Candidate not live: ${notLive}`);
  console.log(`Candidate found, domain didn't match: ${noMatch}`);
  console.log(`Business name too generic to verify: ${noTokens}`);

  await client.end();
}

main().catch((err) => {
  console.error('Discovery failed:', err.message);
  process.exit(1);
});
