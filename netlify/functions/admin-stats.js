exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Auth check
  const password = event.headers['x-admin-password'] || '';
  if (password !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  const sb = (path) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Prefer': 'count=exact',
      'Range': '0-0'
    }
  });

  const sbData = (path) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    }
  });

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    // Run all queries in parallel
    const [
      totalUsersRes,
      totalReportsRes,
      reportsWeekRes,
      reportsMonthRes,
      flaggedRes,
      recentUsersRes,
      topProductsRes,
      topCitiesRes,
      cachedProductsRes
    ] = await Promise.all([
      sb('users?select=id'),
      sb('price_reports?select=id'),
      sb(`price_reports?select=id&created_at=gte.${sevenDaysAgo}`),
      sb(`price_reports?select=id&created_at=gte.${thirtyDaysAgo}`),
      sbData('price_reports?flags=gte.2&select=id,store_name,product_name,price,city,flags,created_at&order=flags.desc&limit=20'),
      sbData(`users?select=id,email,created_at&order=created_at.desc&limit=10`),
      sbData('price_reports?select=barcode,product_name&order=created_at.desc&limit=200'),
      sbData('price_reports?select=city&limit=500'),
      sb('products?select=barcode')
    ]);

    const getCount = (res) => {
      const range = res.headers.get('content-range') || '';
      return parseInt(range.split('/')[1]) || 0;
    };

    const totalUsers = getCount(totalUsersRes);
    const totalReports = getCount(totalReportsRes);
    const reportsWeek = getCount(reportsWeekRes);
    const reportsMonth = getCount(reportsMonthRes);
    const cachedProducts = getCount(cachedProductsRes);

    const flagged = await flaggedRes.json();
    const recentUsers = await recentUsersRes.json();
    const allReports = await topProductsRes.json();
    const allCities = await topCitiesRes.json();

    // Top products by scan count
    const productCounts = {};
    for (const r of allReports) {
      const key = r.barcode;
      if (!productCounts[key]) productCounts[key] = { barcode: r.barcode, name: r.product_name || r.barcode, count: 0 };
      productCounts[key].count++;
    }
    const topProducts = Object.values(productCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Top cities
    const cityCounts = {};
    for (const r of allCities) {
      if (!r.city) continue;
      cityCounts[r.city] = (cityCounts[r.city] || 0) + 1;
    }
    const topCities = Object.entries(cityCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([city, count]) => ({ city, count }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        users: { total: totalUsers, recent: recentUsers },
        reports: { total: totalReports, week: reportsWeek, month: reportsMonth },
        products: { cached: cachedProducts, top: topProducts },
        cities: topCities,
        flagged
      })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
