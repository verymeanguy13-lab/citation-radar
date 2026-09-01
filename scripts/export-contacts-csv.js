// CitationRadar -- Exports all usable contacts (phone, email, contact
// form URL) to a CSV file you can open directly in Excel/Sheets.
// Run with: node scripts/export-contacts-csv.js
// Output: contacts-export.csv in your project folder

const { Client } = require('pg');
const fs = require('fs');

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows } = await client.query(`
    SELECT
      business_name,
      buyer_category,
      registry_city,
      phone,
      email,
      website,
      has_contact_form,
      contact_form_url
    FROM prospects
    WHERE (source = 'ny_dec_pesticide_registry' AND contact_verified = true)
       OR source = 'google_places_category_search'
    ORDER BY buyer_category, business_name;
  `);

  const headers = ['Business Name', 'Category', 'City', 'Phone', 'Email', 'Website', 'Has Contact Form', 'Contact Form URL'];
  const lines = [headers.join(',')];

  for (const r of rows) {
    lines.push([
      csvEscape(r.business_name),
      csvEscape(r.buyer_category),
      csvEscape(r.registry_city),
      csvEscape(r.phone),
      csvEscape(r.email),
      csvEscape(r.website),
      csvEscape(r.has_contact_form ? 'Yes' : ''),
      csvEscape(r.contact_form_url),
    ].join(','));
  }

  const outputPath = './contacts-export.csv';
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');

  console.log(`Exported ${rows.length} contacts to ${outputPath}`);
  console.log(`Open it from your project folder in Excel, Google Sheets, or any spreadsheet app.`);

  await client.end();
}

main().catch((err) => {
  console.error('Export failed:', err.message);
  process.exit(1);
});
