// POST /.netlify/functions/google-search   (body: { cat, query, lat, lng, radius })
// Server-side proxy for Google Places Text Search (New), using YOUR Google API key from an
// environment variable — never sent to the browser, so visitors don't need (or see) any key
// at all.
//
// Why the caching here matters a lot more than the OSM caching: your app fires one Google
// search PER CATEGORY (about 29 of them) every time someone live-searches a city. Without
// caching, 100 different visitors all searching "Philadelphia" would trigger ~2,900 billed
// Google calls. With this cache, the FIRST person to search a given city/category pair within
// the cache window pays for the Google call — everyone else within that window gets served
// the cached result for free. This is what turns "cost scales with every visitor" into
// "cost scales with how many distinct cities get searched."
//
// Setup: in the Netlify dashboard, go to Site configuration -> Environment variables, and add
// GOOGLE_MAPS_API_KEY with your key as the value. Never put the real key directly in this file
// or commit it to a public repo.

const CACHE = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — long enough to absorb repeat traffic for the
                                       // same city, short enough that ratings/hours don't go
                                       // too stale. Adjust to taste once you see real traffic.

// These two fields (rating, regularOpeningHours) are what push every call into Google's more
// expensive "Enterprise" pricing tier instead of the cheaper "Pro" tier — but they're also
// core to what the app shows people, so they stay. Caching is what controls the cost here,
// not trimming these fields.
const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.regularOpeningHours,places.nationalPhoneNumber,places.websiteUri';

exports.handler = async (event) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: true, message: 'GOOGLE_MAPS_API_KEY not set in Netlify environment variables' }) };
  }
  if (event.httpMethod !== 'POST' || !event.body) {
    return { statusCode: 400, body: JSON.stringify({ error: true, message: 'expected a POST body with {cat, query, lat, lng, radius}' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body); } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: true, message: 'invalid JSON body' }) };
  }
  const { cat, query, lat, lng, radius } = payload;
  if (!query || typeof lat !== 'number' || typeof lng !== 'number') {
    return { statusCode: 400, body: JSON.stringify({ error: true, message: 'missing query/lat/lng' }) };
  }

  // Round coordinates to ~1km precision for the cache key — searches a few blocks apart in
  // the same city should share a cache entry rather than each paying for their own call.
  const cacheKey = `${cat}:${lat.toFixed(2)},${lng.toFixed(2)}:${radius || 8000}`;
  const cached = CACHE.get(cacheKey);
  if (cached && (Date.now() - cached.time) < CACHE_TTL_MS) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cached.data) };
  }

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK
      },
      body: JSON.stringify({
        textQuery: query,
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radius || 8000 } },
        maxResultCount: 8
      })
    });
    const json = await res.json();
    if (!res.ok) throw new Error((json.error && json.error.message) || 'Google Places request failed');

    const results = (json.places || [])
      .filter(r => r.rating)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 6)
      .map((r, i) => ({
        id: `live-${cat}-${i}-${r.id}`, cat, verified: true, live: true, source: 'google',
        name: (r.displayName && r.displayName.text) || '', address: r.formattedAddress || '',
        phone: r.nationalPhoneNumber || null, rating: r.rating || null, count: r.userRatingCount || 0,
        priceLevel: typeof r.priceLevel === 'number' ? r.priceLevel : null, placeId: r.id,
        website: r.websiteUri || null,
        lat: r.location ? r.location.latitude : null, lng: r.location ? r.location.longitude : null,
        hours: (r.regularOpeningHours && r.regularOpeningHours.weekdayDescriptions) ? r.regularOpeningHours.weekdayDescriptions.join(' · ') : null,
        note: null
      }));

    CACHE.set(cacheKey, { data: results, time: Date.now() });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(results) };
  } catch (e) {
    return { statusCode: 502, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: true, message: String(e.message || e) }) };
  }
};
