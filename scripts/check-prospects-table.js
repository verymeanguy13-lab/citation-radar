console.log("Script started.");
console.log("DATABASE_URL is set:", !!process.env.DATABASE_URL);

let Client;
try {
  Client = require('pg').Client;
  console.log("pg module loaded OK.");
} catch (err) {
  console.error("Failed to load 'pg' module:", err.message);
  process.exit(1);
}

const c = new Client({ connectionString: process.env.DATABASE_URL });

console.log("Attempting to connect...");
c.connect()
  .then(() => {
    console.log("Connected. Running query...");
    return c.query("SELECT buyer_category, count(*) FROM prospects GROUP BY buyer_category");
  })
  .then((r) => {
    console.log("Query result:", r.rows);
    return c.end();
  })
  .catch((e) => {
    console.error("Error occurred:", e.message);
    c.end();
  });