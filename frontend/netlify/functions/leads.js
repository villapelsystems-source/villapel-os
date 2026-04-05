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
    const leads = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    return json(200, { success: true, leads });
  } catch (err) {
    console.error('leads', err);
    return json(500, { success: false, error: 'Failed to read leads' });
  }
};
