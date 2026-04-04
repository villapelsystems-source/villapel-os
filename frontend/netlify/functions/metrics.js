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
    const totalLeads = leads.length;
    const replied = leads.filter((l) => (l.status || '').toLowerCase() === 'replied').length;
    const booked = leads.filter((l) => (l.status || '').toLowerCase() === 'booked').length;
    const closed = leads.filter((l) => {
      const s = (l.status || '').toLowerCase();
      return s === 'closed won' || s === 'closed lost' || s === 'closed';
    }).length;

    return json(200, {
      success: true,
      metrics: { totalLeads, replied, booked, closed },
    });
  } catch (err) {
    console.error('metrics', err);
    return json(500, { success: false, error: 'Failed to compute metrics' });
  }
};
