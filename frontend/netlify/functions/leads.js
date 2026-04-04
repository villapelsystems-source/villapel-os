const { readLeads } = require('./_leadsStore');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { success: false, error: 'Method not allowed' });
  }

  try {
    const leads = await readLeads();
    return json(200, { success: true, leads });
  } catch (err) {
    console.error('leads', err);
    return json(500, { success: false, error: 'Failed to read leads' });
  }
};
