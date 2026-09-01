// CitationRadar -- Session 15 Step 3 (CORRECTED): score Places matches
// using substring matching against the domain, not exact word tokens.

const { Client } = require('pg');

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

function score(decName, website) {
  const decTokens = distinctiveTokens(decName).filter((t) => t.length >= 4);
  if (decTokens.length === 0) return 'unscoreable';
  if (!website) return 'unscoreable';

  let host;
  try {
    host = new URL(website).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return 'unscoreable';
  }

  const matched = decTokens.filter((t) => host.includes(t.toLowerCase()));
  const ratio = matched.length / decTokens.length;

  if (matched.length === 0) return 'none';
  if (ratio >= 0.5) return 'strong';
  return 'partial';
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  await client.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS match_confidence text;`);

  const { rows } = await client.query(`
    SELECT id, business_name, website
    FROM prospects
    WHERE contact_method = 'places_api';
  `);
  console.log(`Scoring ${rows.length} places_api rows...`);

  const testRow = rows.find((r) => r.business_name.includes('EMPIRE EXTERMINATING'));
  if (testRow) {
    console.log(`SANITY CHECK -- Empire website: ${testRow.website} -- scores: ${score(testRow.business_name, testRow.website)}`);
  } else {
    console.log('SANITY CHECK -- Empire Exterminating row not found in this pool.');
  }

  const counts = { strong: 0, none: 0, partial: 0, unscoreable: 0 };

  for (const p of rows) {
    const result = score(p.business_name, p.website);
    counts[result]++;

    if (result === 'strong') {
      await client.query(`UPDATE prospects SET match_confidence = $1, contact_verified = true WHERE id = $2`, [result, p.id]);
    } else if (result === 'none') {
      await client.query(`UPDATE prospects SET match_confidence = $1, phone = NULL, website = NULL, contact_method = 'none' WHERE id = $2`, [result, p.id]);
    } else {
      await client.query(`UPDATE prospects SET match_confidence = $1 WHERE id = $2`, [result, p.id]);
    }
  }

  console.log('=== Scoring Summary ===');
  console.table(counts);
  await client.end();
}

main().catch((err) => { console.error('Scoring failed:', err.message); process.exit(1); });
