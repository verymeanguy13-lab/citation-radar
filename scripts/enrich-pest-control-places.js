// CitationRadar -- Session 15 Step 2: Places API enrichment for all
// NYC pest control prospects. Writes phone + website back to the
// prospects table. contact_verified stays false -- per everything
// learned in Step 0/0b/0c validation, a human glance is still needed
// before trusting a match enough to email someone.
//
// Setup:
//   $env:DATABASE_URL = "your-connection-string"
//   $env:GOOGLE_PLACES_API_KEY = "your-places-key"
// Run with: node scripts/enrich-pest-control-places.js

const { Client } = require('pg');

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) {
  console.error('Missing GOOGLE_PLACES_API_KEY.');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows } = await client.query(`
    SELECT id, business_name, registry_city
    FROM prospects
    WHERE source = 'ny_dec_pesticide_registry'
    ORDER BY id;
  `);
  console.log(`Enriching ${rows.length} prospects via Places API...\n`);

  let matched = 0;
  let withPhone = 0;
  let withWebsite = 0;

  for (const [i, p] of rows.entries()) {
    process.stdout.write(`[${i + 1}/${rows.length}] ${p.business_name}... `);
    try {
      const data = await placesTextSearch(`${p.business_name}, ${p.registry_city}, NY`);
      const place = (data.places || [])[0];

      if (place) {
        matched++;
        const phone = place.nationalPhoneNumber || null;
        const website = place.websiteUri || null;
        if (phone) withPhone++;
        if (website) withWebsite++;

        await client.query(
          `UPDATE prospects SET phone = $1, website = $2, contact_method = 'places_api' WHERE id = $3`,
          [phone, website, p.id]
        );
        console.log(`matched "${place.displayName?.text || '?'}" -- phone:${phone ? 'Y' : 'N'} site:${website ? 'Y' : 'N'}`);
      } else {
        await client.query(
          `UPDATE prospects SET contact_method = 'none' WHERE id = $1`,
          [p.id]
        );
        console.log('no match');
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
    await sleep(150);
  }

  console.log('\n=== Enrichment Summary ===');
  console.log(`Total prospects: ${rows.length}`);
  console.log(`Places found a candidate: ${matched}`);
  console.log(`Of those, has a phone: ${withPhone}`);
  console.log(`Of those, has a website: ${withWebsite}`);
  console.log('\nRemember: these counts include unverified matches (same risk as');
  console.log('Horizon/Safeguard/Topco earlier -- generic names can match the wrong');
  console.log('business). contact_verified is still false on every row.');

  await client.end();
}

main().catch((err) => {
  console.error('Enrichment failed:', err.message);
  process.exit(1);
});