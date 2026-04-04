const { intakeLeadFromBody } = require('./_leadIntakeShared');

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function corsHeaders(origin) {
  const allow = process.env.CORS_ORIGINS || '*';
  const h = {
    'Access-Control-Allow-Origin': allow.includes('*') ? '*' : origin || allow.split(',')[0].trim(),
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, X-API-Key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (allow !== '*' && !allow.includes('*')) {
    h['Access-Control-Allow-Credentials'] = 'false';
  }
  return h;
}

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, error: 'Method not allowed' }, corsHeaders(origin));
  }

  const expected = process.env.VILLAPEL_API_KEY;
  const key = event.headers['x-api-key'] || event.headers['X-API-Key'] || '';
  if (!expected || key !== expected) {
    return json(401, { success: false, error: 'Invalid or missing x-api-key' }, corsHeaders(origin));
  }

  let body;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { success: false, error: 'Invalid JSON body' }, corsHeaders(origin));
  }

  try {
    const { statusCode, json: out } = await intakeLeadFromBody(body);
    return json(statusCode, out, corsHeaders(origin));
  } catch (err) {
    console.error('leads-intake', err);
    const msg = err.message && String(err.message).includes('FIREBASE') ? 'Database configuration error' : 'Failed to save lead';
    return json(500, { success: false, error: msg }, corsHeaders(origin));
  }
};
