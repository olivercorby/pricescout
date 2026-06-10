exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const id = (event.queryStringParameters || {}).id || '';
  if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No id' }) };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  try {
    // Fetch current flag count
    const getRes = await fetch(`${SUPABASE_URL}/rest/v1/price_reports?id=eq.${encodeURIComponent(id)}&select=flags`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (!getRes.ok) throw new Error('Could not fetch report');
    const rows = await getRes.json();
    if (!rows.length) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Report not found' }) };

    const currentFlags = rows[0].flags || 0;
    const newFlags = currentFlags + 1;

    // Update flag count
    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/price_reports?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ flags: newFlags })
    });

    if (!updateRes.ok) throw new Error('Could not update flags');

    // Tell the client whether this report is now hidden (3+ flags)
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, flags: newFlags, hidden: newFlags >= 3 })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
