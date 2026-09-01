// CitationRadar -- Bulk email discovery. Scrapes each verified contact's
// OWN website (their own public page, not a third-party platform) for a
// mailto: link or plain-text email. Free, no API involved. Validated
// earlier on 5 test businesses (4/5 found real emails) -- this runs the
// same logic against your real 656 contacts.
//
// Setup: $env:DATABASE_URL = "your-connection-string"
// Run with: node scripts/discover-emails-bulk.js

const { Client } = require('pg');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PATHS_TO_TRY = ['', 'contact', 'contact-us', 'contactus', 'contactus.html', 'about', 'about-us'];

const NOISE_PATTERNS = [
  /\.(png|jpg|jpeg|gif|svg|webp)$/i,
  /wixpress\.com$/i,
  /sentry\.io$/i,
  /example\.com$/i,
  /godaddy\.com$/i,
  /schema\.org$/i,
  /help\.com$/i, // caught a real false positive on this one earlier today
  /tawk\.to$/i,
  /drift\.com$/i,
  /intercom\.io$/i,
  /zopim\.com$/i,
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
      signal: AbortSignal.timeout(8000),
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

  const mailtoMatches = html.matchAll(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi);
  for (const m of mailtoMatches) {
    if (!isNoise(m[1])) found.add(m[1].toLowerCase());
  }

  if (found.size === 0) {
    const textMatches = html.matchAll(EMAIL_REGEX);
    for (const m of textMatches) {
      if (!isNoise(m[0])) found.add(m[0].toLowerCase());
    }
  }

  return [...found];
}

async function findEmailForSite(baseUrl) {
  let base;
  try {
    base = baseUrl.replace(/\/$/, '');
  } catch {
    return null;
  }

  for (const path of PATHS_TO_TRY) {
    const url = path ? `${base}/${path}` : base;
    const html = await fetchPage(url);
    const emails = extractEmails(html);
    if (emails.length > 0) return emails[0]; // take the first confident match
    await sleep(300);
  }
  return null;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows } = await client.query(`
    SELECT id, business_name, website
    FROM prospects
    WHERE contact_verified = true AND website IS NOT NULL AND email IS NULL;
  `);
  console.log(`Checking ${rows.length} verified contacts with a website for an email address...\n`);

  let found = 0;

  for (const [i, p] of rows.entries()) {
    process.stdout.write(`[${i + 1}/${rows.length}] ${p.business_name}... `);
    const email = await findEmailForSite(p.website);

    if (email) {
      await client.query(`UPDATE prospects SET email = $1 WHERE id = $2`, [email, p.id]);
      found++;
      console.log(email);
    } else {
      console.log('no email found');
    }
  }

  console.log(`\n=== Summary: ${found}/${rows.length} emails found and saved ===`);
  console.log(`Contacts with no website at all were skipped -- those go to the phone-call list instead.`);

  await client.end();
}

main().catch((err) => {
  console.error('Email discovery failed:', err.message);
  process.exit(1);
});
