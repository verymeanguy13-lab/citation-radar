// CitationRadar -- run the matching engine against unprocessed violations
// (Session 10)
//
// Run with: node scripts/run-matching.js
// Wiring this into the daily ingestion workflows (so it runs automatically
// after new violations land) is Session 11's job, not this one.

const { Pool } = require('pg');
const { matchUnprocessedViolations } = require('./lib/matching');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    const nyc = await matchUnprocessedViolations(client, 'NYC');
    console.log(`NYC: processed ${nyc.violationsProcessed} violations, created ${nyc.totalMatches} matches`);

    const tor = await matchUnprocessedViolations(client, 'TOR');
    console.log(`TOR: processed ${tor.violationsProcessed} violations, created ${tor.totalMatches} matches`);
  } finally {
    client.release();
    await pool.end();
  }
}

main();