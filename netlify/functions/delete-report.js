exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'DELETE') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const id = (event.queryStringParameters || {}).id || '';
  if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No id' }) };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    // Only allow deletion of very recent reports (within 30 seconds — undo window)
    const cutoff = new Date(Date.now() - 30000).toISOString();

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/price_reports?id=eq.${encodeURIComponent(id)}&created_at=gte.${cutoff}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      }
    );

    if (!res.ok) throw new Error('Delete failed');
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
