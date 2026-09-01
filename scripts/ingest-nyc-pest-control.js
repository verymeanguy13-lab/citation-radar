// CitationRadar -- Session 15 Step 1: Full NYC pest control ingestion.
//
// Pulls the live NY DEC "Currently Registered Pesticide Businesses and
// Agencies" dataset (resource h8u2-6ejg), filters to NY-state
// registrants in categories 7A/7C/7F (Structural & Rodent, Termite,
// Food Processing -- see Section 10 log for why 7B was excluded and
// why 7A alone would have missed real, confirmed businesses like
// Empire Exterminating and Horizon Pest Management), then filters to
// NYC zip codes client-side, and inserts into prospects.
//
// Safe to re-run: clears prior ny_dec_pesticide_registry rows first,
// so reruns don't create duplicates.
//
// Setup: $env:DATABASE_URL = "your-connection-string"
// Run with: node scripts/ingest-nyc-pest-control.js

const { Client } = require('pg');

// All NYC ZIP codes across the 5 boroughs.
const NYC_ZIPS = new Set([
  // Manhattan
  '10001','10002','10003','10004','10005','10006','10007','10009','10010',
  '10011','10012','10013','10014','10016','10017','10018','10019','10020',
  '10021','10022','10023','10024','10025','10026','10027','10028','10029',
  '10030','10031','10032','10033','10034','10035','10036','10037','10038',
  '10039','10040','10044','10065','10069','10075','10128','10162','10165',
  '10199','10280','10282',
  // Bronx
  '10451','10452','10453','10454','10455','10456','10457','10458','10459',
  '10460','10461','10462','10463','10464','10465','10466','10467','10468',
  '10469','10470','10471','10472','10473','10474','10475',
  // Brooklyn
  '11201','11202','11203','11204','11205','11206','11207','11208','11209',
  '11210','11211','11212','11213','11214','11215','11216','11217','11218',
  '11219','11220','11221','11222','11223','11224','11225','11226','11228',
  '11229','11230','11231','11232','11233','11234','11235','11236','11237',
  '11238','11239','11241','11242','11243','11249','11252','11256',
  // Queens
  '11101','11102','11103','11104','11105','11106','11109','11120','11351',
  '11354','11355','11356','11357','11358','11359','11360','11361','11362',
  '11363','11364','11365','11366','11367','11368','11369','11370','11371',
  '11372','11373','11374','11375','11377','11378','11379','11385','11411',
  '11412','11413','11414','11415','11416','11417','11418','11419','11420',
  '11421','11422','11423','11424','11425','11426','11427','11428','11429',
  '11430','11431','11432','11433','11434','11435','11436','11439','11451',
  '11690','11691','11692','11693','11694','11695','11697',
  // Staten Island
  '10301','10302','10303','10304','10305','10306','10307','10308','10309',
  '10310','10311','10312','10313','10314',
]);

const CATEGORY_CODES = ['7a', '7c', '7f'];
const SOURCE_NAME = 'ny_dec_pesticide_registry';

async function fetchDecData() {
  const catFilter = CATEGORY_CODES.map((c) => `'${c}'`).join(',');
  const url = `https://data.ny.gov/resource/h8u2-6ejg.json?$where=upper(state)='NY' AND lower(pesticide_category_code) in(${catFilter})&$limit=50000`;

  console.log('Fetching live DEC dataset...');
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`DEC API error ${res.status}: ${await res.text()}`);
  }
  const rows = await res.json();
  console.log(`Fetched ${rows.length} NY-state rows in categories 7A/7C/7F.`);
  return rows;
}

function filterToNyc(rows) {
  const filtered = rows.filter((r) => NYC_ZIPS.has(r.zip_code));
  console.log(`${filtered.length} of those rows are in an NYC zip code.`);
  return filtered;
}

async function main() {
  const allRows = await fetchDecData();
  const nycRows = filterToNyc(allRows);

  if (nycRows.length === 0) {
    console.error('No NYC rows found -- stopping before touching the database.');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log(`\nClearing any prior '${SOURCE_NAME}' rows (safe re-run)...`);
  const deleted = await client.query(
    'DELETE FROM prospects WHERE source = $1',
    [SOURCE_NAME]
  );
  console.log(`Removed ${deleted.rowCount} old rows.`);

  console.log(`Inserting ${nycRows.length} new rows...`);
  let inserted = 0;
  for (const row of nycRows) {
    await client.query(
      `INSERT INTO prospects (business_name, buyer_category, city_code, registry_city, zip_code, source, contact_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.business_agency_name,
        'pest_control',
        'NYC',
        row.city,
        row.zip_code,
        SOURCE_NAME,
        'none',
      ]
    );
    inserted++;
  }
  console.log(`Inserted ${inserted} rows.\n`);

  console.log('=== Confirmation: rows by registry_city ===');
  const byCity = await client.query(`
    SELECT registry_city, count(*)
    FROM prospects
    WHERE source = $1
    GROUP BY registry_city
    ORDER BY count(*) DESC
    LIMIT 20;
  `, [SOURCE_NAME]);
  console.table(byCity.rows);

  const total = await client.query(
    'SELECT count(*) FROM prospects WHERE source = $1',
    [SOURCE_NAME]
  );
  console.log(`Total pest_control prospects now in table: ${total.rows[0].count}`);

  await client.end();
}

main().catch((err) => {
  console.error('Ingestion failed:', err.message);
  process.exit(1);
});