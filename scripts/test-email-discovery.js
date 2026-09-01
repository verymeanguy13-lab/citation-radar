// CitationRadar -- Email discovery from a business's OWN website.
//
// Not scraping Yelp/Google (ToS-restricted third-party platforms) --
// this fetches each business's own public homepage/contact page and
// looks for a mailto: link or a plain-text email, which is their own
// voluntarily-published contact info. Standalone test first, on the
// 5 websites we've already confirmed are real today -- so we know if
// this works before trusting it on hundreds of unknowns.
//
// Run with: node scripts/test-email-discovery.js
// (No API key needed for this one.)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TEST_SITES = [
  { name: 'EMPIRE EXTERMINATING LLC', website: 'https://empireexterminating.com/' },
  { name: 'BUG TECHS PEST CONTROL', website: 'http://bugtechs.com/' },
  { name: 'ANNIHILATOR EX-TERMINATION (You Got Bugs)', website: 'https://yougotbugs.com/' },
  { name: 'HORIZON PEST MANAGEMENT', website: 'http://www.horizonpest.com/' },
  { name: 'EZX INC', website: 'http://www.ezxinc.com/' },
];

const PATHS_TO_TRY = ['', 'contact', 'contact-us', 'contactus', 'about', 'about-us'];

// Filters out placeholder/tracking addresses that show up in raw HTML but
// aren't real contact emails -- Wix/Squarespace boilerplate, image
// filenames that happen to match the email regex, sentry.io error
// tracking addresses, etc.
const NOISE_PATTERNS = [
  /\.(png|jpg|jpeg|gif|svg|webp)$/i,
  /wixpress\.com$/i,
  /sentry\.io$/i,
  /example\.com$/i,
  /godaddy\.com$/i,
  /schema\.org$/i,
];

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function isNoise(email) {
  return NOISE_PATTERNS.some((p) => p.test(email));
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'CitationRadarBot/1.0 (+contact info lookup for B2B outreach)' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractEmails(html) {
  if (!html) return [];
  const found = new Set();

  // mailto: links first -- highest confidence signal
  const mailtoMatches = html.matchAll(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi);
  for (const m of mailtoMatches) {
    if (!isNoise(m[1])) found.add(m[1].toLowerCase());
  }

  // plain-text emails as a fallback
  const textMatches = html.matchAll(EMAIL_REGEX);
  for (const m of textMatches) {
    if (!isNoise(m[0])) found.add(m[0].toLowerCase());
  }

  return [...found];
}

async function findEmailsForSite(baseUrl) {
  const base = baseUrl.replace(/\/$/, '');
  const allFound = new Set();

  for (const path of PATHS_TO_TRY) {
    const url = path ? `${base}/${path}` : base;
    const html = await fetchPage(url);
    const emails = extractEmails(html);
    emails.forEach((e) => allFound.add(e));

    if (allFound.size > 0) break; // stop once we've found something
    await sleep(500); // be polite between requests to the same site
  }

  return [...allFound];
}

async function main() {
  console.log('=== Email Discovery Test (own-website lookup) ===\n');
  const results = [];

  for (const site of TEST_SITES) {
    process.stdout.write(`Checking "${site.name}" (${site.website})... `);
    const emails = await findEmailsForSite(site.website);
    console.log(emails.length > 0 ? emails.join(', ') : 'no email found');
    results.push({ ...site, emails });
    await sleep(500);
  }

  const withEmail = results.filter((r) => r.emails.length > 0).length;
  console.log(`\n=== Summary: ${withEmail}/${TEST_SITES.length} sites had a findable email ===`);
}

main();