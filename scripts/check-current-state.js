// CitationRadar -- Read-only diagnostic. No Places API calls, no writes.
// Just tells us the REAL current state of the table before deciding
// whether anything else needs to run.
//
// Setup: $env:DATABASE_URL = "your-connection-string"
// Run with: node scripts/check-current-state.js

const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log('=== Current state of pest_control prospects ===\n');

  const byMethod = await client.query(`
    SELECT contact_method, match_confidence, count(*)
    FROM prospects
    WHERE source = 'ny_dec_pesticide_registry'
    GROUP BY contact_method, match_confidence
    ORDER BY count(*) DESC;
  `);
  console.log('Breakdown by contact_method + match_confidence:');
  console.table(byMethod.rows);

  const totals = await client.query(`
    SELECT
      count(*) FILTER (WHERE phone IS NOT NULL) AS has_phone,
      count(*) FILTER (WHERE website IS NOT NULL) AS has_website,
      count(*) FILTER (WHERE contact_verified = true) AS verified,
      count(*) AS total
    FROM prospects
    WHERE source = 'ny_dec_pesticide_registry';
  `);
  console.log('\nOverall totals:');
  console.table(totals.rows);

  await client.end();
}

main().catch((err) => {
  console.error('Check failed:', err.message);
  process.exit(1);
});
