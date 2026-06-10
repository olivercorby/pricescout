exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const params = event.queryStringParameters || {};
  const barcode = params.barcode || '';
  const radiusKm = parseFloat(params.radius_km) || 25;
  const lat = parseFloat(params.lat) || null;
  const lng = parseFloat(params.lng) || null;

  if (!barcode) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No barcode' }) };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  try {
    // Fetch reports for this barcode, most recent first
    // Filter by radius client-side since Supabase free tier doesn't have PostGIS
    const url = `${SUPABASE_URL}/rest/v1/price_reports?barcode=eq.${encodeURIComponent(barcode)}&order=created_at.desc&limit=100`;

    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) throw new Error(`Supabase error ${res.status}`);
    let results = await res.json();

    // Filter by radius if location available
    if (lat && lng && results.length > 0) {
      results = results.filter(r => {
        if (!r.lat || !r.lng) return true; // include if no location
        const dist = haversineKm(lat, lng, r.lat, r.lng);
        return dist <= radiusKm;
      });
    }

    // Deduplicate: keep most recent report per store
    const seen = {};
    const deduped = [];
    for (const r of results) {
      const key = (r.store_name || '').toLowerCase().trim() + '_' + (r.city || '').toLowerCase().trim();
      if (!seen[key]) {
        seen[key] = true;
        deduped.push(r);
      }
    }

    // Sort by price
    deduped.sort((a, b) => a.price - b.price);

    return { statusCode: 200, headers, body: JSON.stringify({ results: deduped }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
