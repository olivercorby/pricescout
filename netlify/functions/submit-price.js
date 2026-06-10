exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { barcode, product_name, product_brand, store_name, price, currency, city, lat, lng, user_token } = body;

    if (!barcode || !store_name || !price || !city) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // Duplicate suppression — block same user submitting same barcode+store within 24 hours
    if (user_token) {
      const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
      const checkUrl = `${SUPABASE_URL}/rest/v1/price_reports`
        + `?barcode=eq.${encodeURIComponent(barcode)}`
        + `&store_name=eq.${encodeURIComponent(store_name.trim())}`
        + `&user_token=eq.${encodeURIComponent(user_token)}`
        + `&created_at=gte.${oneDayAgo}`
        + `&limit=1`;

      const checkRes = await fetch(checkUrl, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      });

      if (checkRes.ok) {
        const existing = await checkRes.json();
        if (existing.length > 0) {
          return {
            statusCode: 429,
            headers,
            body: JSON.stringify({ error: 'You already reported this product at this store today' })
          };
        }
      }
    }

    const record = {
      barcode: String(barcode).trim(),
      product_name: product_name || '',
      product_brand: product_brand || '',
      store_name: String(store_name).trim(),
      price: parseFloat(price),
      currency: currency || 'CAD',
      city: String(city).trim(),
      lat: lat ? parseFloat(lat) : null,
      lng: lng ? parseFloat(lng) : null,
      user_token: user_token || null,
      flags: 0
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/price_reports`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(record)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase insert failed: ${err}`);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
