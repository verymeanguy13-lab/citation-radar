// CitationRadar -- city-scoped matching engine (Session 10)
//
// Given a violation, finds every saved_search whose city_code matches
// AND whose other filters (category, area, critical-only) match, and
// inserts into search_matches. city_code is matched by strict equality
// -- never OR'd, never defaulted -- so a NYC saved_search can only ever
// be compared against NYC violations in the first place. The Session 3
// database trigger is a second, independent layer behind this: even if
// this query had a bug, the trigger would still refuse a cross-city
// insert.

async function matchViolation(client, violationId) {
  const { rows: violationRows } = await client.query(
    `SELECT v.id, v.city_code, v.category, v.critical_flag, e.area, e.address
     FROM violations v
     JOIN establishments e ON v.establishment_id = e.id
     WHERE v.id = $1`,
    [violationId]
  );
  const violation = violationRows[0];
  if (!violation) return { matched: 0, candidateCount: 0 };

  const { rows: searches } = await client.query(
    `SELECT id FROM saved_searches
     WHERE city_code = $1
       AND (category_filter IS NULL OR category_filter = $2)
       AND (min_severity IS NULL OR (min_severity = 'critical' AND $3 = TRUE))
       AND (area_filter IS NULL OR $4 ILIKE '%' || area_filter || '%' OR $5 ILIKE '%' || area_filter || '%')`,
    [violation.city_code, violation.category, violation.critical_flag, violation.area || '', violation.address || '']
  );

  let matched = 0;
  for (const s of searches) {
    const result = await client.query(
      `INSERT INTO search_matches (saved_search_id, violation_id, matched_city_code)
       VALUES ($1, $2, $3)
       ON CONFLICT (saved_search_id, violation_id) DO NOTHING
       RETURNING id`,
      [s.id, violation.id, violation.city_code]
    );
    if (result.rows.length > 0) matched++;
  }
  return { matched, candidateCount: searches.length };
}

// Processes violations that don't have any search_matches row yet.
// cityCode is optional -- pass null to process both cities.
async function matchUnprocessedViolations(client, cityCode, limit = 500) {
  const { rows } = await client.query(
    `SELECT v.id FROM violations v
     WHERE ($1::varchar IS NULL OR v.city_code = $1)
       AND NOT EXISTS (SELECT 1 FROM search_matches sm WHERE sm.violation_id = v.id)
     ORDER BY v.id
     LIMIT $2`,
    [cityCode || null, limit]
  );

  let totalMatches = 0;
  for (const row of rows) {
    const { matched } = await matchViolation(client, row.id);
    totalMatches += matched;
  }
  return { violationsProcessed: rows.length, totalMatches };
}

module.exports = { matchViolation, matchUnprocessedViolations };