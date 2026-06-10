exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  // GET — fetch current suggestion for a report
  if (event.httpMethod === 'GET') {
    const id = (event.queryStringParameters || {}).id || '';
    if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No id' }) };

    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/price_suggestions?report_id=eq.${id}&order=confirmations.desc&limit=1`,
        { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
      );
      const suggestions = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify({ suggestion: suggestions[0] || null }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const { id, suggested_price, user_id, action } = body;

    if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No id' }) };

    // ── CONFIRM SUGGESTION ─────────────────────────────
    if (action === 'confirm' && suggested_price && user_id) {
      // Check if suggestion exists
      const sugRes = await fetch(
        `${SUPABASE_URL}/rest/v1/price_suggestions?report_id=eq.${id}&order=confirmations.desc&limit=1`,
        { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
      );
      const suggestions = await sugRes.json();

      if (suggestions.length > 0) {
        const sug = suggestions[0];
        const newCount = (sug.confirmations || 1) + 1;

        // Update confirmation count
        await fetch(`${SUPABASE_URL}/rest/v1/price_suggestions?id=eq.${sug.id}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ confirmations: newCount })
        });

        // 3 confirmations total = replace original price
        if (newCount >= 3) {
          await fetch(`${SUPABASE_URL}/rest/v1/price_reports?id=eq.${id}`, {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              price: sug.suggested_price,
              flags: 0,
              created_at: new Date().toISOString()
            })
          });

          // Clean up suggestion
          await fetch(`${SUPABASE_URL}/rest/v1/price_suggestions?report_id=eq.${id}`, {
            method: 'DELETE',
            headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
          });

          return { statusCode: 200, headers, body: JSON.stringify({ success: true, price_updated: true, new_price: sug.suggested_price }) };
        }

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, confirmations: newCount, needed: 3 - newCount }) };
      }

      // No existing suggestion — create one
      await fetch(`${SUPABASE_URL}/rest/v1/price_suggestions`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ report_id: id, suggested_price: parseFloat(suggested_price), suggested_by: user_id, confirmations: 1 })
      });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, confirmations: 1, needed: 2 }) };
    }

    // ── FLAG REPORT ────────────────────────────────────
    const getRes = await fetch(
      `${SUPABASE_URL}/rest/v1/price_reports?id=eq.${id}&select=flags&limit=1`,
      { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const rows = await getRes.json();
    if (!rows.length) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Report not found' }) };

    const newFlags = (rows[0].flags || 0) + 1;

    await fetch(`${SUPABASE_URL}/rest/v1/price_reports?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ flags: newFlags })
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, flags: newFlags, hidden: newFlags >= 3 })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
