exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const user_id = (event.queryStringParameters || {}).user_id || '';
  if (!user_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No user_id' }) };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/price_reports?user_id=eq.${encodeURIComponent(user_id)}&select=id`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Prefer': 'count=exact',
          'Range': '0-0'
        }
      }
    );

    const range = res.headers.get('content-range') || '';
    const total = parseInt(range.split('/')[1]) || 0;

    return { statusCode: 200, headers, body: JSON.stringify({ count: total }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
