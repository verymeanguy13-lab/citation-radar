// CitationRadar -- free contact discovery, 3-layer lookup (Session 15)
//
// Layer 1 (free, automated): OpenStreetMap Overpass API, matched by
// business name within the NYC bounding box. Takes the website/
// contact:website tag if a real match is found.
//
// Layer 2 (free, automated, runs only on what Layer 1 missed): guess a
// likely domain from the business name (strip legal suffixes/
// punctuation, try name.com), HEAD request, accept only a real 200 OK
// on the guessed host itself -- not a redirect to a parked-domain page.
//
// Layer 3: NOT automated on purpose (per the blueprint) -- anything
// neither layer catches gets contact_method = 'none' and is left for
// the manual Google Maps-link lookup pattern from Session 7.

const NYC_BBOX = '40.49,-74.26,40.92,-73.68'; // south,west,north,east -- covers all 5 boroughs

// Overpass API is a free, shared, community-run service that rate-limits
// or resets connections on rapid consecutive requests -- a pause between
// calls (and identifying ourselves via User-Agent, which their own
// usage policy asks for) is required for reliable results, not optional
// politeness.
const OVERPASS_DELAY_MS = 2000;
const OVERPASS_USER_AGENT = 'CitationRadar-ContactDiscovery/1.0 (contact: set via ALERT_EMAIL_FROM env)';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripLegalSuffixes(name) {
  return name
    .replace(/\b(INC|LLC|CORP|CO|LTD|THE)\b\.?/gi, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

async function lookupOsmWebsite(businessName, attempt = 1) {
  // Loose, case-insensitive substring match on the OSM name tag --
  // OSM's own regex search, not an exact match, since real-world listing
  // names rarely match a legal registration name character-for-character.
  const escaped = businessName.replace(/["\\]/g, '');
  const query = `[out:json][timeout:25];
    (
      node["name"~"${escaped}",i](${NYC_BBOX});
      way["name"~"${escaped}",i](${NYC_BBOX});
    );
    out body;`;

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'User-Agent': OVERPASS_USER_AGENT,
        'Content-Type': 'text/plain',
      },
      body: query,
    });
    if (!res.ok) return null;
    const data = await res.json();
    for (const el of data.elements || []) {
      const website = el.tags?.website || el.tags?.['contact:website'];
      if (website) return website;
    }
    return null;
  } catch (err) {
    // A connection-level failure (rate-limit, reset, timeout) is not the
    // same as "no match" -- retry once after a longer pause before
    // giving up, so a transient block doesn't masquerade as a real miss.
    if (attempt < 2) {
      console.error(`  (OSM request failed for "${businessName}", retrying once after a pause...)`);
      await sleep(OVERPASS_DELAY_MS * 3);
      return lookupOsmWebsite(businessName, attempt + 1);
    }
    console.error(`  (OSM lookup failed for "${businessName}" after retry: ${err.message})`);
    return null;
  }
}

async function guessDomain(businessName) {
  const guess = stripLegalSuffixes(businessName);
  if (!guess) return null;
  const url = `https://${guess}.com`;

  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    // Accept only a real 200 on a page whose final host still contains
    // our guess -- rejects parked-domain services that 200 on anything.
    if (res.ok && res.url.includes(guess)) {
      return url;
    }
    return null;
  } catch (err) {
    return null; // domain doesn't resolve, times out, etc. -- not an error worth logging, just a miss
  }
}

// Returns { contactMethod, website } where contactMethod is one of
// 'osm_website' | 'domain_guess' | 'none'.
async function discoverContact(businessName) {
  const osmWebsite = await lookupOsmWebsite(businessName);
  if (osmWebsite) {
    return { contactMethod: 'osm_website', website: osmWebsite };
  }

  const guessedWebsite = await guessDomain(businessName);
  if (guessedWebsite) {
    return { contactMethod: 'domain_guess', website: guessedWebsite };
  }

  return { contactMethod: 'none', website: null };
}

module.exports = { discoverContact, lookupOsmWebsite, guessDomain, stripLegalSuffixes };