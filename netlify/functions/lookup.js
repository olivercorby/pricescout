exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const code = (event.queryStringParameters || {}).code || '';
  if (!code) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No code' }) };

  const BUYCOTT_API_KEY = process.env.BUYCOTT_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!BUYCOTT_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'BUYCOTT_API_KEY not configured' }) };
  }

  const isBarcode = /^\d{6,14}$/.test(code.trim());

  // ── CHECK CACHE FIRST ──────────────────────────────────
  if (isBarcode && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const cacheRes = await fetch(
        `${SUPABASE_URL}/rest/v1/products?barcode=eq.${encodeURIComponent(code.trim())}&limit=1`,
        {
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
          }
        }
      );
      if (cacheRes.ok) {
        const cached = await cacheRes.json();
        if (cached.length > 0) {
          const p = cached[0];
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              items: [{
                title: p.title,
                brand: p.brand,
                images: p.image_url ? [p.image_url] : [],
                category: p.category,
                description: p.description,
                searchQuery: p.title || code
              }],
              cached: true
            })
          };
        }
      }
    } catch (e) {
      // Cache miss — fall through to Buycott
    }
  }

  // ── CALL BUYCOTT ───────────────────────────────────────
  try {
    const endpoint = isBarcode
      ? 'https://buycott.com/api/v4/products/lookup'
      : 'https://buycott.com/api/v4/products/search';

    const bodyPayload = isBarcode
      ? { barcode: code.trim(), access_token: BUYCOTT_API_KEY }
      : { query: code.trim(), access_token: BUYCOTT_API_KEY };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });

    if (!res.ok) {
      const err = await res.text();
      return { statusCode: res.status, headers, body: JSON.stringify({ error: `Buycott error ${res.status}`, detail: err }) };
    }

    const data = await res.json();
    const products = data.products || [];

    const normalized = products.map(p => ({
      title: p.product_name || '',
      brand: p.brand_name || p.manufacturer_name || '',
      images: p.product_image_url ? [p.product_image_url] : [],
      category: p.category_name || '',
      description: p.product_description || '',
      searchQuery: p.product_name || code
    }));

    // ── WRITE TO CACHE ─────────────────────────────────
    if (isBarcode && normalized.length > 0 && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const p = normalized[0];
      fetch(`${SUPABASE_URL}/rest/v1/products`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal',
          'On-Conflict': 'barcode'
        },
        body: JSON.stringify({
          barcode: code.trim(),
          title: p.title,
          brand: p.brand,
          image_url: p.images[0] || null,
          category: p.category,
          description: p.description,
          cached_at: new Date().toISOString()
        })
      }).catch(() => {}); // fire and forget
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ items: normalized })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
