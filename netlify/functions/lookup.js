exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const code = (event.queryStringParameters || {}).code || '';
  if (!code) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No code' }) };

  const BUYCOTT_API_KEY = process.env.BUYCOTT_API_KEY;
  if (!BUYCOTT_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'BUYCOTT_API_KEY not configured' }) };
  }

  const isBarcode = /^\d{6,14}$/.test(code.trim());

  try {
    let endpoint, bodyPayload;

    if (isBarcode) {
      endpoint = 'https://buycott.com/api/v4/products/lookup';
      bodyPayload = { barcode: code.trim(), access_token: BUYCOTT_API_KEY };
    } else {
      endpoint = 'https://buycott.com/api/v4/products/search';
      bodyPayload = { query: code.trim(), access_token: BUYCOTT_API_KEY };
    }

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

    // Normalize Buycott response to match what app.js expects
    // Buycott returns { products: [...] }
    const products = data.products || [];
    const normalized = products.map(p => ({
      title: p.product_name || '',
      brand: p.brand_name || p.manufacturer_name || '',
      images: p.product_image_url ? [p.product_image_url] : [],
      category: p.category_name || '',
      description: p.product_description || '',
      searchQuery: p.product_name || code
    }));

    // Return in UPCitemdb-compatible shape so app.js needs no changes
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ items: normalized })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
