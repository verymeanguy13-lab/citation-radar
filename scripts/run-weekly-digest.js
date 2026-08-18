// CitationRadar -- send the weekly customer digest (Session 11)
//
// Run with: node scripts/run-weekly-digest.js
// Intended to run once a week. Critical matches are excluded
// automatically -- they're already marked alert_sent_at by the daily
// critical-alerts run before this ever executes.

const { Pool } = require('pg');
const { runWeeklyDigest } = require('./lib/digest');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    const result = await runWeeklyDigest(client);
    console.log(`Weekly digest: notified ${result.usersNotified} user(s), ${result.matchesSent} match(es) sent`);
  } finally {
    client.release();
    await pool.end();
  }
}

main();