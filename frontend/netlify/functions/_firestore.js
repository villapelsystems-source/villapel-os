const admin = require('firebase-admin');

let _db = null;

function getDb() {
  if (!_db) {
    if (!admin.apps.length) {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is not set');
      const sa = JSON.parse(raw);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
    }
    _db = admin.firestore();
  }
  return _db;
}

module.exports = { getDb, admin };
