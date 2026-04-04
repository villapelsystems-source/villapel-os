const crypto = require('crypto');
const { appendLead } = require('./_leadsStore');

const uuid = () => crypto.randomUUID();

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

  const clean = (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    return s || null;
  };

  const lead = {
    id: uuid(),
    company_name: clean(body.company_name),
    contact_name: clean(body.contact_name),
    phone: clean(body.phone),
    city: clean(body.city),
    state: clean(body.state),
    status: clean(body.status) || 'New Lead',
    source_platform: clean(body.source_platform) || 'Other',
    notes: clean(body.notes),
    created_at: new Date().toISOString(),
  };

  if (!lead.company_name) {
    return json(400, { success: false, error: 'company_name is required' }, corsHeaders(origin));
  }

  try {
    await appendLead(lead);
    return json(200, { success: true, lead }, corsHeaders(origin));
  } catch (err) {
    console.error('leads-intake', err);
    return json(500, { success: false, error: 'Failed to save lead' }, corsHeaders(origin));
  }
};
