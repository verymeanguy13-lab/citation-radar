// CitationRadar -- Two things:
// 1. Cleans up junk/placeholder emails already saved (e.g.
//    "email@location.com" -- template placeholder text, not real).
// 2. For businesses where no real email was found, checks their
//    website for a contact form as a fallback reach channel.
//
// Setup: $env:DATABASE_URL = "your-connection-string"
// Run with: node scripts/check-contact-forms.js

const { Client } = require('pg');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Placeholder/template junk that isn't a real business email, even
// though it matches the email regex pattern.
const JUNK_EMAIL_PATTERNS = [
  /^email@location\.com$/i,
  /^your@email\.com$/i,
  /^name@email\.com$/i,
  /^user@example\.com$/i,
  /^info@yourdomain\.com$/i,
  /^test@test\.com$/i,
  /^admin@website\.com$/i,
  /^user@domain\.com$/i,
];

function isJunkEmail(email) {
  return JUNK_EMAIL_PATTERNS.some((p) => p.test(email));
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

// Looks for real signals of an actual contact form -- not just any
// <form> tag (search bars, newsletter signups, etc. also use <form>).
function hasLikelyContactForm(html) {
  if (!html) return false;
  const lower = html.toLowerCase();

  const hasEmailInput = /<input[^>]+type=["']email["']/i.test(html);
  const hasMessageField = /<textarea/i.test(html);
  const hasContactKeyword = /contact.{0,20}(us|form)|get in touch|send.{0,10}message/i.test(lower);
  const hasFormHandler = /(formspree\.io|netlify|wix\.com\/forms|jotform|typeform|hubspot.*form)/i.test(lower);

  return (hasEmailInput && hasMessageField) || (hasContactKeyword && hasMessageField) || hasFormHandler;
}

async function checkForForm(baseUrl) {
  const base = baseUrl.replace(/\/$/, '');
  const paths = ['', 'contact', 'contact-us', 'contactus', 'contactus.html'];

  for (const path of paths) {
    const url = path ? `${base}/${path}` : base;
    const html = await fetchPage(url);
    if (hasLikelyContactForm(html)) return url;
    await sleep(300);
  }
  return null;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  await client.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS has_contact_form boolean;`);
  await client.query(`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS contact_form_url text;`);

  console.log('=== Step 1: Cleaning up junk placeholder emails ===');
  const { rows: allEmails } = await client.query(`
    SELECT id, email FROM prospects WHERE email IS NOT NULL;
  `);
  let cleaned = 0;
  for (const row of allEmails) {
    if (isJunkEmail(row.email)) {
      await client.query(`UPDATE prospects SET email = NULL WHERE id = $1`, [row.id]);
      console.log(`Removed junk email "${row.email}" from business id ${row.id}`);
      cleaned++;
    }
  }
  console.log(`Cleaned ${cleaned} junk email(s).\n`);

  console.log('=== Step 2: Checking contact forms for businesses with no email ===');
  const { rows } = await client.query(`
    SELECT id, business_name, website
    FROM prospects
    WHERE contact_verified = true AND website IS NOT NULL AND email IS NULL AND has_contact_form = true AND contact_form_url IS NULL;
  `);
  console.log(`Checking ${rows.length} businesses for a contact form...\n`);

  let formsFound = 0;
  for (const [i, p] of rows.entries()) {
    process.stdout.write(`[${i + 1}/${rows.length}] ${p.business_name}... `);
    const formUrl = await checkForForm(p.website);
    await client.query(
      `UPDATE prospects SET has_contact_form = $1, contact_form_url = $2 WHERE id = $3`,
      [!!formUrl, formUrl, p.id]
    );
    console.log(formUrl ? `HAS a contact form -> ${formUrl}` : 'no form found');
    if (formUrl) formsFound++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Junk emails cleaned: ${cleaned}`);
  console.log(`Contact forms found: ${formsFound}/${rows.length}`);
  console.log(`Truly phone-only (no email, no form): ${rows.length - formsFound}`);

  await client.end();
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
