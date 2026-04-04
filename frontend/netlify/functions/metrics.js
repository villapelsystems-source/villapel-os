const { getDb } = require('./_firestore');

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
    const db = getDb();
    const snap = await db.collection('leads').get();
    const leads = snap.docs.map((d) => d.data());
    const totalLeads = leads.length;
    const replied = leads.filter((l) => l.status === 'Replied').length;
    const booked = leads.filter((l) => l.status === 'Booked').length;
    const closed = leads.filter((l) => l.status === 'Closed Won' || l.status === 'Closed Lost').length;

    return json(200, {
      success: true,
      metrics: { totalLeads, replied, booked, closed },
    });
  } catch (err) {
    console.error('metrics', err);
    return json(500, { success: false, error: 'Failed to compute metrics' });
  }
};
