// Free, read-only. Checks the 'unscoreable' bucket -- these are rows
// where there was no website to domain-check against, or the business
// name was too short/generic to score. Many likely still have a real
// phone number from Places that was just never auto-confirmed.
// Run with: node scripts/check-unscoreable.js

const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const summary = await client.query(`
    SELECT
      count(*) AS total_unscoreable,
      count(*) FILTER (WHERE phone IS NOT NULL) AS has_phone,
      count(*) FILTER (WHERE website IS NOT NULL) AS has_website
    FROM prospects
    WHERE source = 'ny_dec_pesticide_registry' AND match_confidence = 'unscoreable';
  `);
  console.log('=== Unscoreable rows ===');
  console.table(summary.rows);

  const sample = await client.query(`
    SELECT business_name, phone, website
    FROM prospects
    WHERE source = 'ny_dec_pesticide_registry' AND match_confidence = 'unscoreable' AND phone IS NOT NULL
    LIMIT 15;
  `);
  console.log('\n=== Sample of 15 (business_name + phone, for a quick eyeball check) ===');
  console.table(sample.rows);

  await client.end();
}

main().catch((err) => {
  console.error('Check failed:', err.message);
  process.exit(1);
});
