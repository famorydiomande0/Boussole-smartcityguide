// POST /.netlify/functions/places   (body: the raw Overpass QL query text, built client-side)
// Server-side proxy for Overpass (the "nearby places" search). This is the important one:
// Overpass's public mirrors throttle hard per IP after a handful of requests in a short window —
// that's the "temporarily overloaded" message. Every visitor's browser calling Overpass directly
// means dozens of different IPs all competing for that same shared limit. Routing through this
// one function means it's Netlify's servers making the request, not each visitor's own
// connection — and identical/nearby queries get served from cache instead of hitting Overpass
// again at all, which is what actually reduces how often the limit gets hit.

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter'
];

const CACHE = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST' || !event.body) {
    return { statusCode: 400, body: JSON.stringify({ error: true, message: 'expected a POST body with the Overpass query' }) };
  }

  const query = event.body;
  const cached = CACHE.get(query);
  if (cached && (Date.now() - cached.time) < CACHE_TTL_MS) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cached.data) };
  }

  let lastErr;
  for (let i = 0; i < OVERPASS_MIRRORS.length; i++) {
    try {
      const res = await fetch(OVERPASS_MIRRORS[i], { method: 'POST', body: query });
      if (!res.ok) throw new Error('http-' + res.status);
      const data = await res.json();
      CACHE.set(query, { data, time: Date.now() });
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
    } catch (e) {
      lastErr = e;
      if (i < OVERPASS_MIRRORS.length - 1) await delay(400);
    }
  }

  return { statusCode: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: true, message: String(lastErr) }) };
};
