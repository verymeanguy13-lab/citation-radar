// CitationRadar -- Session 15 Step 0 validation (run once, before Step 1)
//
// Tests the 3-layer contact discovery approach against 10 real, currently
// -registered NYC pest control businesses (pulled live from the NY DEC
// dataset, resource h8u2-6ejg), spread across all five boroughs. Per the
// blueprint: if the automated hit rate looks poor, STOP -- do not
// proceed to build the full target-list pipeline automatically.
//
// Run with: node scripts/test-step0-contact-discovery.js

const { discoverContact } = require('./lib/contact-discovery');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TEST_BUSINESSES = [
  'EZX INC',
  'ANNIHILATOR EX-TERMINATION INC',
  'EMPIRE EXTERMINATING LLC',
  'BUG TECHS PEST CONTROL CO INC',
  'A TO Z PEST CONTROL OF QUEENS LLC',
  'DEKONE PEST CONTROL LLC',
  'ONSITE PEST SOLUTIONS INC',
  'HORIZON PEST MANAGEMENT INC',
  'TOPCO PEST CONTROL INC',
  'SAFEGUARD EXTERMINATING INC',
];

async function main() {
  console.log('=== Session 15 Step 0: Contact Discovery Validation ===\n');

  const results = [];
  for (const name of TEST_BUSINESSES) {
    process.stdout.write(`Checking "${name}"... `);
    const result = await discoverContact(name);
    console.log(result.contactMethod === 'none' ? 'MISS (none)' : `HIT (${result.contactMethod}) -> ${result.website}`);
    results.push({ name, ...result });
    await sleep(2000); // be a well-behaved client of the free Overpass API
  }

  const osmHits = results.filter((r) => r.contactMethod === 'osm_website').length;
  const guessHits = results.filter((r) => r.contactMethod === 'domain_guess').length;
  const misses = results.filter((r) => r.contactMethod === 'none').length;
  const totalHits = osmHits + guessHits;
  const hitRate = ((totalHits / TEST_BUSINESSES.length) * 100).toFixed(0);

  console.log('\n=== Summary ===');
  console.log(`OSM Overpass hits: ${osmHits}`);
  console.log(`Domain-guess hits: ${guessHits}`);
  console.log(`Misses (need manual lookup): ${misses}`);
  console.log(`Overall automated hit rate: ${hitRate}% (${totalHits}/${TEST_BUSINESSES.length})`);
  console.log('\nPer the blueprint: if this hit rate looks poor, STOP here and report it --');
  console.log('do not proceed to build the full target-list pipeline automatically.');
}

main();