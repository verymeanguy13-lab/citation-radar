// CitationRadar -- Session 15 Step 0c: Google Places API contact discovery
//
// Uses the official Places API (New) instead of scraping or a general
// search API. Same 10 businesses as Step 0/0b, so results are directly
// comparable. Prints the matched business name/address next to what you
// searched for -- eyeball each one yourself rather than trusting an
// automated "verified" label, since Places can still return the wrong
// business for a generic name (same risk we saw with Horizon/Safeguard).
//
// Setup (once per terminal session):
//   $env:GOOGLE_PLACES_API_KEY = "your-key-here"
// Run with: node scripts/test-step0c-places-api-contact-discovery.js

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) {
  console.error('Missing GOOGLE_PLACES_API_KEY. Set it with $env:GOOGLE_PLACES_API_KEY first.');
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

async function placesTextSearch(query) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': [
        'places.displayName',
        'places.formattedAddress',
        'places.nationalPhoneNumber',
        'places.websiteUri',
      ].join(','),
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
  });

  if (!res.ok) {
    throw new Error(`Places API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  console.log('=== Session 15 Step 0c: Google Places API Validation ===\n');
  const results = [];

  for (const name of TEST_BUSINESSES) {
    console.log(`--- ${name} ---`);
    let outcome = { name, found: false, matchedName: null, address: null, phone: null, website: null };

    try {
      const data = await placesTextSearch(`${name}, NYC`);
      const place = (data.places || [])[0];

      if (place) {
        outcome.found = true;
        outcome.matchedName = place.displayName?.text || null;
        outcome.address = place.formattedAddress || null;
        outcome.phone = place.nationalPhoneNumber || null;
        outcome.website = place.websiteUri || null;

        console.log(`  Matched: ${outcome.matchedName}`);
        console.log(`  Address: ${outcome.address || '(none)'}`);
        console.log(`  Phone:   ${outcome.phone || '(none)'}`);
        console.log(`  Website: ${outcome.website || '(none)'}`);
        console.log(`  >>> Compare "${name}" to "${outcome.matchedName}" -- same business? Check before trusting.`);
      } else {
        console.log('  No match found.');
      }
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      outcome.error = err.message;
    }

    results.push(outcome);
    console.log('');
    await sleep(300);
  }

  const withPhone = results.filter((r) => r.phone).length;
  const withWebsite = results.filter((r) => r.website).length;
  const found = results.filter((r) => r.found).length;

  console.log('=== Step 0c Summary ===');
  console.log(`Places API found a candidate: ${found}/${TEST_BUSINESSES.length}`);
  console.log(`Of those, has a phone number: ${withPhone}/${TEST_BUSINESSES.length}`);
  console.log(`Of those, has a website:      ${withWebsite}/${TEST_BUSINESSES.length}`);
  console.log('\nThese numbers count every "found" result, even ones that might be the');
  console.log('wrong business (generic names). Go through the "Matched:" name above for');
  console.log('each one and confirm it actually matches before trusting the contact info.');
}

main();