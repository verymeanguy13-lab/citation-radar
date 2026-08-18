// CitationRadar -- send same-day critical violation alerts (Session 11)
//
// Run with: node scripts/run-critical-alerts.js
// Intended to run daily, right after scripts/run-matching.js.

const { Pool } = require('pg');
const { runCriticalAlerts } = require('./lib/digest');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    const result = await runCriticalAlerts(client);
    console.log(`Critical alerts: notified ${result.usersNotified} user(s), ${result.matchesSent} match(es) sent`);
  } finally {
    client.release();
    await pool.end();
  }
}

main();