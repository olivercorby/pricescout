exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const code = (event.queryStringParameters || {}).code || '';
  if (!code) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No code' }) };

  try {
    const isBarcode = /^\d{6,14}$/.test(code.trim());
    const url = isBarcode
      ? `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`
      : `https://api.upcitemdb.com/prod/trial/search?s=${encodeURIComponent(code)}&type=product`;

    const res = await fetch(url, { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } });
    const data = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
