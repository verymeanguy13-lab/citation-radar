// CitationRadar -- Session 15 Step 0b validation, v3
//
// v1 accepted any non-aggregator search result with no verification.
// v2 added text-on-page verification, but short/generic tokens (like
// "EX" matching inside "exterminator", or "ONSITE" being generic
// marketing copy every competitor uses) still caused false positives.
// v3 fixes this by checking whether the business's distinctive name
// appears in the DOMAIN itself -- a much sharper, higher-precision
// signal, and it needs no extra page fetch (so no more 403s from
// sites that block scraping).
//
// Setup (once per terminal session):
//   $env:TAVILY_API_KEY = "your-key-here"
// Run with: node scripts/test-step0b-search-contact-discovery.js

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
if (!TAVILY_API_KEY) {
  console.error('Missing TAVILY_API_KEY. Set it with $env:TAVILY_API_KEY first.');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TEST_BUSINESSES = [
  'EZX INC',
  'ANNIHILATOR EX-TERMINATION INC',
  'EMPIRE EXTERMINATING LLC',
  'BUG TECHS PEST CONTROL CO INC',
  'A TO Z PEST CONTROL OF QUEENS LLC',
  'DEKONE PEST CONTROL LLC',
  'ONSITE PEST SOLUTIONS INC',
  'HORIZON PEST MANAGEMENT INC',
  'TOPCO PEST CONTROL INC',
  'SAFEGUARD EXTERMINATING INC',
];

// Directory / aggregator / data-broker sites -- never the business's own
// contact page. Added zoominfo, dnb, and similar after v2's Horizon run
// surfaced a ZoomInfo profile page as a false "candidate."
const AGGREGATOR_DOMAINS = [
  'yelp.com', 'facebook.com', 'mapquest.com', 'yellowpages.com',
  'bbb.org', 'linkedin.com', 'instagram.com', 'google.com',
  'manta.com', 'yellowbook.com', 'angi.com', 'thumbtack.com',
  'zoominfo.com', 'dnb.com', 'buzzfile.com', 'chamberofcommerce.com',
  'crunchbase.com', 'opencorporates.com', 'superpages.com', 'local.com',
];

const STOPWORDS = new Set([
  'INC', 'LLC', 'CORP', 'CO', 'LTD', 'PEST', 'CONTROL', 'EXTERMINATING',
  'EXTERMINATION', 'MANAGEMENT', 'SOLUTIONS', 'SERVICES', 'OF', 'THE',
  'AND', 'NYC', 'NEW', 'YORK', 'QUEENS', 'BROOKLYN', 'BRONX', 'MANHATTAN',
  'STATEN', 'ISLAND',
]);

// Minimum length 3 -- excludes 2-letter fragments like "EX" / "TO" that
// match almost any domain by coincidence, while still keeping short-but-
// real distinctive words like "BUG" or "EZX".
function distinctiveTokens(name) {
  return name
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

async function confirmLive(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return res.ok;
  } catch {
    return false;
  }
}

// The real fix: does the business's own distinctive name show up in the
// DOMAIN, not the page body? Domains are short and specific, so a token
// match here is strong evidence -- unlike body text, which is full of
// generic industry language every competitor shares.
function verifyAgainstDomain(url, businessName) {
  const tokens = distinctiveTokens(businessName);
  if (tokens.length === 0) return { status: 'no_tokens' };

  const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  const matched = tokens.filter((t) => host.includes(t.toLowerCase()));
  return matched.length > 0
    ? { status: 'match', matchedOn: matched }
    : { status: 'no_match' };
}

async function main() {
  console.log('=== Session 15 Step 0b: Search-API Contact Discovery Validation (v3) ===\n');
  const results = [];

  for (const name of TEST_BUSINESSES) {
    process.stdout.write(`Checking "${name}"... `);
    let outcome = { name, contactMethod: 'none', website: null, note: '' };

    try {
      const data = await tavilySearch(`${name} NYC pest control`);
      const candidate = (data.results || []).find((r) => r.url && !isAggregator(r.url));

      if (candidate) {
        const live = await confirmLive(candidate.url);
        if (live) {
          const verification = verifyAgainstDomain(candidate.url, name);
          if (verification.status === 'match') {
            outcome.contactMethod = 'search_api_website';
            outcome.website = candidate.url;
            outcome.note = `domain matched on: ${verification.matchedOn.join(', ')}`;
          } else if (verification.status === 'no_tokens') {
            outcome.contactMethod = 'search_api_needs_manual_review';
            outcome.website = candidate.url;
            outcome.note = 'business name too generic/short to auto-verify -- glance manually';
          } else {
            outcome.contactMethod = 'search_api_unverified';
            outcome.website = candidate.url;
            outcome.note = 'domain does not contain the business name -- likely wrong company';
          }
        }
      }
    } catch (err) {
      outcome.contactMethod = 'error';
      outcome.note = err.message;
    }

    const label =
      outcome.contactMethod === 'search_api_website' ? `VERIFIED HIT -> ${outcome.website}` :
      outcome.contactMethod === 'search_api_unverified' ? `REJECTED (wrong company) -> ${outcome.website}` :
      outcome.contactMethod === 'search_api_needs_manual_review' ? `NEEDS MANUAL GLANCE -> ${outcome.website}` :
      outcome.contactMethod === 'error' ? `ERROR (${outcome.note})` :
      'MISS (none)';
    console.log(label);

    results.push(outcome);
    await sleep(1000);
  }

  const verified = results.filter((r) => r.contactMethod === 'search_api_website').length;
  const needsReview = results.filter((r) => r.contactMethod === 'search_api_needs_manual_review').length;
  const rate = ((verified / TEST_BUSINESSES.length) * 100).toFixed(0);

  console.log('\n=== Step 0b Summary (this layer only) ===');
  console.log(`Verified hits: ${verified}/${TEST_BUSINESSES.length} (${rate}%)`);
  console.log(`Needs a manual glance (name too generic to auto-verify): ${needsReview}`);
  console.log('\nOnly "Verified hits" is safe to combine with Step 0\'s osm_website +');
  console.log('domain_guess results for the real gate decision -- and check whether any');
  console.log('of these verified businesses are the SAME ones Step 0 already caught,');
  console.log('so you count unique hits, not double-counted ones.');
}

main();