// CitationRadar -- Session 15 (cleaning companies): category-based
// ingestion via Places API. No registry exists for commercial cleaning
// the way DEC exists for pest control, so instead of looking up known
// names one at a time, this searches by CATEGORY across NYC
// neighborhoods and lets Places enumerate the businesses directly --
// getting name, phone, website, and address all in one pass.
//
// Dedupes by Places' own place ID (the same business can turn up in
// more than one overlapping neighborhood search). Filters to real NYC
// zip codes the same way pest control ingestion did.
//
// Setup:
//   $env:DATABASE_URL = "your-connection-string"
//   $env:GOOGLE_PLACES_API_KEY = "your-places-key"
// Run with: node scripts/ingest-cleaning-companies-places.js

const { Client } = require('pg');

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) {
  console.error('Missing GOOGLE_PLACES_API_KEY.');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Same NYC zip set used for pest control ingestion.
const NYC_ZIPS = new Set([
  '10001','10002','10003','10004','10005','10006','10007','10009','10010',
  '10011','10012','10013','10014','10016','10017','10018','10019','10020',
  '10021','10022','10023','10024','10025','10026','10027','10028','10029',
  '10030','10031','10032','10033','10034','10035','10036','10037','10038',
  '10039','10040','10044','10065','10069','10075','10128','10162','10165',
  '10199','10280','10282',
  '10451','10452','10453','10454','10455','10456','10457','10458','10459',
  '10460','10461','10462','10463','10464','10465','10466','10467','10468',
  '10469','10470','10471','10472','10473','10474','10475',
  '11201','11202','11203','11204','11205','11206','11207','11208','11209',
  '11210','11211','11212','11213','11214','11215','11216','11217','11218',
  '11219','11220','11221','11222','11223','11224','11225','11226','11228',
  '11229','11230','11231','11232','11233','11234','11235','11236','11237',
  '11238','11239','11241','11242','11243','11249','11252','11256',
  '11101','11102','11103','11104','11105','11106','11109','11120','11351',
  '11354','11355','11356','11357','11358','11359','11360','11361','11362',
  '11363','11364','11365','11366','11367','11368','11369','11370','11371',
  '11372','11373','11374','11375','11377','11378','11379','11385','11411',
  '11412','11413','11414','11415','11416','11417','11418','11419','11420',
  '11421','11422','11423','11424','11425','11426','11427','11428','11429',
  '11430','11431','11432','11433','11434','11435','11436','11439','11451',
  '11690','11691','11692','11693','11694','11695','11697',
  '10301','10302','10303','10304','10305','10306','10307','10308','10309',
  '10310','10311','10312','10313','10314',
]);

// Enough neighborhood spread across all 5 boroughs to get real coverage
// without needing dozens of overlapping queries.
const AREAS = [
  'Manhattan, New York, NY',
  'Brooklyn, NY',
  'Bronx, NY',
  'Staten Island, NY',
  'Flushing, Queens, NY',
  'Jamaica, Queens, NY',
  'Astoria, Queens, NY',
  'Long Island City, Queens, NY',
  'Forest Hills, Queens, NY',
];

const SOURCE_NAME = 'google_places_category_search';

function extractZip(formattedAddress) {
  const match = (formattedAddress || '').match(/NY\s+(\d{5})/);
  return match ? match[1] : null;
}

async function placesTextSearch(query, pageToken) {
  const body = pageToken
    ? { textQuery: query, pageToken }
    : { textQuery: query };

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.nationalPhoneNumber',
        'places.websiteUri',
        'nextPageToken',
      ].join(','),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Places API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function searchArea(area, seen) {
  const results = [];
  let pageToken = null;
  let page = 0;

  do {
    const data = await placesTextSearch(`commercial cleaning company in ${area}`, pageToken);
    for (const place of data.places || []) {
      if (seen.has(place.id)) continue;
      seen.add(place.id);

      const zip = extractZip(place.formattedAddress);
      if (!zip || !NYC_ZIPS.has(zip)) continue;

      results.push({
        business_name: place.displayName?.text || 'Unknown',
        zip_code: zip,
        phone: place.nationalPhoneNumber || null,
        website: place.websiteUri || null,
      });
    }

    pageToken = data.nextPageToken || null;
    page++;
    if (pageToken) await sleep(2000); // Google requires a short delay before a page token is valid
  } while (pageToken && page < 3); // cap at 3 pages (~60 results) per area

  return results;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log(`Clearing any prior '${SOURCE_NAME}' rows (safe re-run)...`);
  const deleted = await client.query('DELETE FROM prospects WHERE source = $1', [SOURCE_NAME]);
  console.log(`Removed ${deleted.rowCount} old rows.\n`);

  const seen = new Set();
  let allResults = [];

  for (const area of AREAS) {
    console.log(`Searching: ${area}...`);
    const results = await searchArea(area, seen);
    console.log(`  Found ${results.length} new NYC-zip cleaning companies.`);
    allResults = allResults.concat(results);
    await sleep(300);
  }

  console.log(`\nInserting ${allResults.length} unique cleaning companies...`);
  for (const r of allResults) {
    await client.query(
      `INSERT INTO prospects (business_name, buyer_category, city_code, zip_code, source, contact_method, phone, website)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [r.business_name, 'cleaning', 'NYC', r.zip_code, SOURCE_NAME, 'places_api', r.phone, r.website]
    );
  }

  const total = await client.query('SELECT count(*) FROM prospects WHERE source = $1', [SOURCE_NAME]);
  const withPhone = await client.query(
    `SELECT count(*) FROM prospects WHERE source = $1 AND phone IS NOT NULL`, [SOURCE_NAME]
  );
  const withWebsite = await client.query(
    `SELECT count(*) FROM prospects WHERE source = $1 AND website IS NOT NULL`, [SOURCE_NAME]
  );

  console.log('\n=== Cleaning Company Ingestion Summary ===');
  console.log(`Total unique NYC cleaning companies: ${total.rows[0].count}`);
  console.log(`With phone: ${withPhone.rows[0].count}`);
  console.log(`With website: ${withWebsite.rows[0].count}`);
  console.log('\nNote: these came directly from category search, not name-matched');
  console.log('against a registry -- so there is no "wrong business" risk the way');
  console.log('pest control had. The remaining risk is category drift (e.g. a');
  console.log('cleaning SUPPLY store instead of a cleaning SERVICE company) -- worth');
  console.log('a quick manual skim of the list, not a full verification pass.');

  await client.end();
}

main().catch((err) => {
  console.error('Ingestion failed:', err.message);
  process.exit(1);
});
