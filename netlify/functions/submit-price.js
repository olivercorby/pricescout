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
      user_token: user_token || null
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
