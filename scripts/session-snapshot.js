// CitationRadar -- Free, read-only snapshot before documenting today's
// session. No API calls, no writes.
// Run with: node scripts/session-snapshot.js

const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log('=== Pest Control (ny_dec_pesticide_registry) ===');
  const pest = await client.query(`
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE contact_verified = true) AS verified,
      count(*) FILTER (WHERE phone IS NOT NULL) AS has_phone,
      count(*) FILTER (WHERE website IS NOT NULL) AS has_website,
      count(*) FILTER (WHERE contact_method = 'places_api') AS via_places,
      count(*) FILTER (WHERE contact_method = 'tavily_search') AS via_tavily
    FROM prospects WHERE source = 'ny_dec_pesticide_registry';
  `);
  console.table(pest.rows);

  console.log('\n=== Cleaning (google_places_category_search) ===');
  const cleaning = await client.query(`
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE phone IS NOT NULL) AS has_phone,
      count(*) FILTER (WHERE website IS NOT NULL) AS has_website
    FROM prospects WHERE source = 'google_places_category_search';
  `);
  console.table(cleaning.rows);

  console.log('\n=== All buyer_category totals ===');
  const all = await client.query(`
    SELECT buyer_category, count(*), count(*) FILTER (WHERE contact_verified = true) AS verified
    FROM prospects GROUP BY buyer_category;
  `);
  console.table(all.rows);

  await client.end();
}

main().catch((err) => {
  console.error('Snapshot failed:', err.message);
  process.exit(1);
});
