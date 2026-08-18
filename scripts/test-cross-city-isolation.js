// CitationRadar -- test_cross_city_isolation (Session 10)
//
// MANDATORY TEST per the blueprint (Section 1 + Section 5). This is the
// core correctness property of the entire product: a NYC saved_search
// must never match a Toronto violation, and vice versa, even when every
// OTHER filter (category, area, severity) deliberately overlaps.
//
// Three checks:
//   1. The matching engine (Session 10) does not create a cross-city match.
//   2. Control: the same-city case DOES match, proving the matcher isn't
//      just silently broken/no-op.
//   3. Even bypassing the application entirely with a raw INSERT, the
//      Session 3 database trigger refuses the cross-city row.
//
// Run with: node scripts/test-cross-city-isolation.js
// Exits 1 if any check fails (CI-friendly).

const { Pool } = require('pg');
const { matchViolation } = require('./lib/matching');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`[PASS] ${label}`);
    passed++;
  } else {
    console.log(`[FAIL] ${label}`);
    failed++;
  }
}

async function main() {
  const client = await pool.connect();
  console.log('=== test_cross_city_isolation ===\n');

  try {
    // ---- Setup: deliberately overlapping data, differing ONLY in city ----
    const OVERLAP_AREA = 'IsolationTestArea';

    await client.query(
      `INSERT INTO establishments (city_code, external_id, legal_name, area, address)
       VALUES ('NYC', 'TEST-ISO-NYC-001', 'Isolation Test NYC', $1, $1)`,
      [OVERLAP_AREA]
    );
    await client.query(
      `INSERT INTO establishments (city_code, external_id, legal_name, area, address)
       VALUES ('TOR', 'TEST-ISO-TOR-001', 'Isolation Test TOR', $1, $1)`,
      [OVERLAP_AREA]
    );

    const nycViolation = await client.query(
      `INSERT INTO violations (establishment_id, city_code, inspection_date, category, critical_flag)
       SELECT id, 'NYC', CURRENT_DATE, 'pest', TRUE FROM establishments WHERE external_id = 'TEST-ISO-NYC-001'
       RETURNING id`
    );
    const torViolation = await client.query(
      `INSERT INTO violations (establishment_id, city_code, inspection_date, category, critical_flag)
       SELECT id, 'TOR', CURRENT_DATE, 'pest', TRUE FROM establishments WHERE external_id = 'TEST-ISO-TOR-001'
       RETURNING id`
    );
    const nycViolationId = nycViolation.rows[0].id;
    const torViolationId = torViolation.rows[0].id;

    await client.query(
      `INSERT INTO users (email, business_name, buyer_category)
       VALUES ('test-isolation@citationradar.local', 'Isolation Test Co', 'pest_control')`
    );

    // NYC saved search whose filters deliberately match the TOR violation
    // exactly (same category, same area text, same severity) -- the ONLY
    // thing that should stop a match is city_code.
    const nycSearch = await client.query(
      `INSERT INTO saved_searches (user_id, city_code, label, category_filter, area_filter, min_severity)
       SELECT id, 'NYC', 'Isolation test search', 'pest', $1, 'critical'
       FROM users WHERE email = 'test-isolation@citationradar.local'
       RETURNING id`,
      [OVERLAP_AREA]
    );
    const nycSearchId = nycSearch.rows[0].id;

    // ---- Check 1: matching engine must NOT match NYC search to TOR violation ----
    await matchViolation(client, torViolationId);
    const crossCityMatch = await client.query(
      'SELECT id FROM search_matches WHERE saved_search_id = $1 AND violation_id = $2',
      [nycSearchId, torViolationId]
    );
    check('Matching engine did not create a cross-city match', crossCityMatch.rows.length === 0);

    // ---- Check 2 (control): matching engine MUST match same-city case ----
    await matchViolation(client, nycViolationId);
    const sameCityMatch = await client.query(
      'SELECT id FROM search_matches WHERE saved_search_id = $1 AND violation_id = $2',
      [nycSearchId, nycViolationId]
    );
    check('Control: same-city match was correctly created (matcher is not just silently broken)', sameCityMatch.rows.length === 1);

    // ---- Check 3: raw INSERT bypassing the app entirely must be blocked by the DB trigger ----
    let triggerBlocked = false;
    let triggerErrorMessage = '';
    try {
      await client.query(
        `INSERT INTO search_matches (saved_search_id, violation_id, matched_city_code)
         VALUES ($1, $2, 'NYC')`,
        [nycSearchId, torViolationId]
      );
    } catch (err) {
      triggerBlocked = true;
      triggerErrorMessage = err.message;
    }
    check(
      `Database trigger blocked a direct bypass attempt (error: "${triggerErrorMessage}")`,
      triggerBlocked && /City mismatch/i.test(triggerErrorMessage)
    );

    // ---- Cleanup ----
    // Delete ALL search_matches referencing our test violations -- not just
    // ones tied to our test saved_search. The matcher correctly checks
    // every real saved_search too, so a real saved_search with no
    // area/category filter may have legitimately matched our test data.
    await client.query('DELETE FROM search_matches WHERE violation_id IN ($1, $2)', [nycViolationId, torViolationId]);
    await client.query('DELETE FROM saved_searches WHERE id = $1', [nycSearchId]);
    await client.query('DELETE FROM users WHERE email = $1', ['test-isolation@citationradar.local']);
    await client.query('DELETE FROM violations WHERE id IN ($1, $2)', [nycViolationId, torViolationId]);
    await client.query(
      "DELETE FROM establishments WHERE external_id IN ('TEST-ISO-NYC-001', 'TEST-ISO-TOR-001')"
    );
    console.log('\nTest data cleaned up.');
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log('RESULT: FAIL');
    process.exitCode = 1;
  } else {
    console.log('RESULT: PASS');
  }
}

main();