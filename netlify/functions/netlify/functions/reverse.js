// GET /.netlify/functions/reverse?lat=<lat>&lng=<lng>
// Server-side proxy for Nominatim reverse geocoding (coordinates -> place name). Same reasoning
// as geocode.js: centralizes traffic through one origin instead of every visitor's browser
// calling Nominatim directly, caches results, and sets the required User-Agent.

const CACHE = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function buildAreaLabel(addr) {
  if (!addr) return '';
  const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
  const province = addr.state || addr.province || addr.region || '';
  const country = addr.country || '';
  return [city, province, country].filter(Boolean).join(', ');
}

exports.handler = async (event) => {
  const { lat, lng } = event.queryStringParameters || {};
  if (!lat || !lng) {
    return { statusCode: 400, body: JSON.stringify({ error: true, message: 'missing lat/lng' }) };
  }

  // Round coordinates for the cache key — GPS jitter of a few meters shouldn't cause a cache miss.
  const cacheKey = `${parseFloat(lat).toFixed(3)},${parseFloat(lng).toFixed(3)}`;
  const cached = CACHE.get(cacheKey);
  if (cached && (Date.now() - cached.time) < CACHE_TTL_MS) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cached.data) };
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Boussole-SmartCityGuide/1.0 (contact: set-your-contact-email-here)'
      }
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error('not-found');
    const result = { lat: parseFloat(lat), lng: parseFloat(lng), label: buildAreaLabel(data.address), fullAddress: data.display_name };
    CACHE.set(cacheKey, { data: result, time: Date.now() });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: true, message: 'not-found' }) };
  }
};
