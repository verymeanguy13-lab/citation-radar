// Checks your REAL Tavily usage/limit directly from their own API --
// no guessing from generic pricing pages.
// Run with: node scripts/check-tavily-usage.js
// (Needs $env:TAVILY_API_KEY set first)

const API_KEY = process.env.TAVILY_API_KEY;
if (!API_KEY) {
  console.error('Missing TAVILY_API_KEY.');
  process.exit(1);
}

fetch('https://api.tavily.com/usage', {
  headers: { 'Authorization': `Bearer ${API_KEY}` },
})
  .then((res) => res.json())
  .then((data) => {
    console.log(JSON.stringify(data, null, 2));
  })
  .catch((err) => console.error('Failed:', err.message));
