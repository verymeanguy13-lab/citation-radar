// CitationRadar -- Final summary: what contact channels does each
// verified business actually have? Free, read-only.
// Run with: node scripts/final-contact-summary.js

const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log('=== Pest Control (contact_verified = true, n=385) ===');
  const pest = await client.query(`
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE phone IS NOT NULL) AS has_phone,
      count(*) FILTER (WHERE email IS NOT NULL) AS has_email,
      count(*) FILTER (WHERE has_contact_form = true) AS has_form,
      count(*) FILTER (WHERE phone IS NULL AND email IS NULL AND (has_contact_form IS NULL OR has_contact_form = false)) AS no_channel_at_all
    FROM prospects
    WHERE source = 'ny_dec_pesticide_registry' AND contact_verified = true;
  `);
  console.table(pest.rows);

  console.log('\n=== Cleaning (n=271) ===');
  const cleaning = await client.query(`
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE phone IS NOT NULL) AS has_phone,
      count(*) FILTER (WHERE email IS NOT NULL) AS has_email
    FROM prospects
    WHERE source = 'google_places_category_search';
  `);
  console.table(cleaning.rows);

  await client.end();
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
