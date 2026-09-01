const raw = process.env.DATABASE_URL || '';
console.log('Raw length:', raw.length);
try {
  const parsed = new URL(raw);
  console.log('Parsed hostname:', parsed.hostname);
  console.log('Parsed protocol:', parsed.protocol);
  console.log('Parsed pathname (db name):', parsed.pathname);
} catch (e) {
  console.log('Could NOT parse as a URL at all:', e.message);
  console.log('First 40 chars:', JSON.stringify(raw.slice(0, 40)));
  console.log('Last 40 chars:', JSON.stringify(raw.slice(-40)));
}