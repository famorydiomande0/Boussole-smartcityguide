// GET /.netlify/functions/geocode?q=<search text>
// Server-side proxy for Nominatim forward geocoding (text -> coordinates).
//
// Why this exists: every visitor's browser calling Nominatim directly means Nominatim sees many
// different IP addresses all hitting its free public service at once, and its usage policy caps
// requests per IP. Routing through this one function means Netlify's servers make the request —
// all of this site's traffic looks like one well-behaved client to Nominatim instead of dozens,
// and results get cached here so repeat lookups for the same place don't call Nominatim again at
// all. This also lets us set a proper identifying User-Agent, which Nominatim's usage policy
// requires and which browsers block pages from setting themselves.

const CACHE = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

exports.handler = async (event) => {
  const q = (event.queryStringParameters && event.queryStringParameters.q || '').trim();
  if (!q) {
    return { statusCode: 400, body: JSON.stringify({ error: true, message: 'missing q parameter' }) };
  }

  const cached = CACHE.get(q);
  if (cached && (Date.now() - cached.time) < CACHE_TTL_MS) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cached.data) };
  }

  const parts = q.split(',').map(s => s.trim()).filter(Boolean);
  // Same progressive-simplification idea as the client-side fallback: a full "City, State,
  // Country" string sometimes matches nothing on Nominatim's forward search even though shorter
  // versions of the same query succeed — try the full query first, then simpler versions.
  for (let i = parts.length; i >= 1; i--) {
    const query = parts.slice(0, i).join(', ');
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          // Required by Nominatim's usage policy for any non-browser/programmatic use —
          // replace with your own site name/URL if you'd like this to identify your app specifically.
          'User-Agent': 'Boussole-SmartCityGuide/1.0 (contact: set-your-contact-email-here)'
        }
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data[0]) {
        const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: data[0].display_name };
        CACHE.set(q, { data: result, time: Date.now() });
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
      }
    } catch (e) { /* try the next, simpler segment */ }
  }

  return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: true, message: 'not-found' }) };
};
