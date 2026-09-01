const query = '[out:json][timeout:25];node["name"~"test",i](40.49,-74.26,40.92,-73.68);out body 1;';

fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: query,
})
  .then((r) => r.text())
  .then((t) => console.log('STATUS OK, response length:', t.length))
  .catch((e) => console.log('ERROR:', e.message, '| CAUSE:', e.cause));