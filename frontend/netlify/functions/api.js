const express = require('express');
const serverless = require('serverless-http');
const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

// ==================== FIREBASE INIT ====================
let _db = null;

function getDb() {
  if (!_db) {
    if (!admin.apps.length) {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
    }
    _db = admin.firestore();
  }
  return _db;
}

const FV = admin.firestore.FieldValue;

// ==================== UTILS ====================
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const nowStamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/[\s\-\(\)\.]/g, '');
}
function normalizeInstagram(handle) {
  if (!handle) return '';
  return handle.toLowerCase().replace(/^@/, '').trim();
}
function normalizeFacebook(url) {
  if (!url) return '';
  url = url.toLowerCase().trim();
  url = url.replace(/^https?:\/\/(www\.)?facebook\.com\//, '');
  url = url.replace(/^fb\.com\//, '');
  return url.replace(/\/$/, '');
}
function cleanStr(val) {
  if (val == null) return null;
  val = String(val).trim();
  return val || null;
}
function addActivity(leadId, action, details = null) {
  return { id: uuid(), action, details, timestamp: now() };
}

// Firestore helper: batch-delete all docs matching a where clause, return count
async function deleteWhere(collectionName, field, value) {
  const db = getDb();
  const snap = await db.collection(collectionName).where(field, '==', value).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

// ==================== AUTH HELPERS ====================
const JWT_ALG = 'HS256';
function getJwtSecret() { return process.env.JWT_SECRET || 'changeme_set_jwt_secret_in_env'; }

function createAccessToken(userId, email) {
  return jwt.sign({ sub: userId, email, type: 'access' }, getJwtSecret(), { expiresIn: '15m', algorithm: JWT_ALG });
}
function createRefreshToken(userId) {
  return jwt.sign({ sub: userId, type: 'refresh' }, getJwtSecret(), { expiresIn: '7d', algorithm: JWT_ALG });
}

async function getCurrentUser(req) {
  const db = getDb();
  let token = req.cookies?.access_token;
  if (!token) {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) token = auth.slice(7);
  }
  if (!token) { const e = new Error('Not authenticated'); e.status = 401; throw e; }
  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret(), { algorithms: [JWT_ALG] });
  } catch (e) {
    const err = new Error(e.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token');
    err.status = 401; throw err;
  }
  if (payload.type !== 'access') { const e = new Error('Invalid token type'); e.status = 401; throw e; }
  const doc = await db.collection('users').doc(payload.sub).get();
  if (!doc.exists) { const e = new Error('User not found'); e.status = 401; throw e; }
  const user = doc.data();
  delete user.password_hash;
  return user;
}

function cookieOpts() {
  return { httpOnly: true, secure: process.env.COOKIE_SECURE === 'true', sameSite: 'lax', path: '/' };
}

// ==================== API KEY VALIDATION ====================
function validateApiKeySimple(req) {
  const key = req.headers['x-api-key'];
  const expected = process.env.VILLAPEL_API_KEY;
  if (!key || !expected || key !== expected) {
    const e = new Error('Not authenticated'); e.status = 401; throw e;
  }
}

async function validateApiKey(req, requiredPermission) {
  const db = getDb();
  const key = req.headers['x-api-key'];
  if (!key) { const e = new Error('Missing x-api-key header'); e.status = 401; throw e; }
  const snap = await db.collection('api_keys').where('key', '==', key).where('is_active', '==', true).limit(1).get();
  if (snap.empty) { const e = new Error('Invalid or revoked API key'); e.status = 401; throw e; }
  const keyDoc = snap.docs[0].data();
  if (requiredPermission && !(keyDoc.permissions || []).includes(requiredPermission)) {
    const e = new Error(`API key lacks required permission: ${requiredPermission}`); e.status = 403; throw e;
  }
  await db.collection('api_keys').doc(keyDoc.id).update({ last_used_at: now() });
  return keyDoc;
}

// ==================== SEED ====================
let _seeded = false;
async function seedAdmin() {
  if (_seeded) return;
  _seeded = true;
  const db = getDb();
  const email = (process.env.ADMIN_EMAIL || 'admin@villapel.com').toLowerCase();
  const snap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (snap.empty) {
    const password = process.env.ADMIN_PASSWORD || 'VillapelAdmin2024!';
    const hash = await bcrypt.hash(password, 10);
    const id = uuid();
    await db.collection('users').doc(id).set({ id, email, password_hash: hash, name: 'Admin', role: 'admin', created_at: now() });
  }
}

// ==================== LOG HELPER ====================
async function logIntegrationCall(endpoint, apiKeyName, success, responseCode, summary, requestBody) {
  const db = getDb();
  const id = uuid();
  const entry = { id, timestamp: now(), endpoint, source: apiKeyName, success, response_code: responseCode, summary, request_preview: requestBody ? JSON.stringify(requestBody).slice(0, 500) : null, created_at: now() };
  await db.collection('integration_logs').doc(id).set(entry);
  const snap = await db.collection('integration_logs').get();
  if (snap.size > 500) {
    const sorted = snap.docs.map(d => d).sort((a, b) => (a.data().created_at || '').localeCompare(b.data().created_at || ''));
    const toDelete = sorted.slice(0, snap.size - 500);
    const batch = db.batch();
    toDelete.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

// ==================== DEDUP HELPER ====================
async function findLeadByIdentifiers(phone, instagram, facebook) {
  const db = getDb();
  const snap = await db.collection('leads').get();
  const leads = snap.docs.map(d => d.data());
  let existingLead = null, matchedOn = null;
  if (phone) {
    const norm = normalizePhone(phone);
    existingLead = leads.find(l => l.phone && normalizePhone(l.phone) === norm) || null;
    if (existingLead) matchedOn = 'phone';
  }
  if (!existingLead && instagram) {
    const norm = normalizeInstagram(instagram);
    existingLead = leads.find(l => l.instagram_handle && normalizeInstagram(l.instagram_handle) === norm) || null;
    if (existingLead) matchedOn = 'instagram_handle';
  }
  if (!existingLead && facebook) {
    const norm = normalizeFacebook(facebook);
    existingLead = leads.find(l => l.facebook_page && normalizeFacebook(l.facebook_page) === norm) || null;
    if (existingLead) matchedOn = 'facebook_page';
  }
  return { existingLead, matchedOn };
}

// ==================== EXPRESS APP ====================
const app = express();
app.use(express.json());
app.use(cookieParser());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim());
  if (origin && (allowed.includes(origin) || allowed.includes('*'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-api-key,X-API-Key');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(async (req, res, next) => { try { await seedAdmin(); } catch (e) { /* seed once */ } next(); });

function asyncHandler(fn) { return (req, res, next) => fn(req, res, next).catch(next); }

// ==================== HEALTH ====================
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'villapel-os-api' }));
app.get('/', (req, res) => res.json({ status: 'ok' }));

// ==================== AUTH ROUTES ====================
app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const db = getDb();
  const { email: rawEmail, password } = req.body || {};
  if (!rawEmail || !password) return res.status(400).json({ detail: 'Email and password required' });
  const email = rawEmail.toLowerCase();
  const ip = (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const identifier = `${ip}___${email}`.replace(/\//g, '_');
  const attemptDoc = await db.collection('login_attempts').doc(identifier).get();
  const attempt = attemptDoc.exists ? attemptDoc.data() : null;
  if (attempt?.locked_until && new Date(attempt.locked_until) > new Date()) {
    return res.status(429).json({ detail: 'Too many failed attempts. Try again later.' });
  }
  const userSnap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (userSnap.empty || !(await bcrypt.compare(password, userSnap.docs[0].data().password_hash))) {
    await db.collection('login_attempts').doc(identifier).set({ attempts: FV.increment(1), last_attempt: now() }, { merge: true });
    return res.status(401).json({ detail: 'Invalid email or password' });
  }
  await db.collection('login_attempts').doc(identifier).delete().catch(() => {});
  const userId = userSnap.docs[0].id;
  const user = userSnap.docs[0].data();
  const accessToken = createAccessToken(userId, email);
  const refreshToken = createRefreshToken(userId);
  res.cookie('access_token', accessToken, { ...cookieOpts(), maxAge: 900000 });
  res.cookie('refresh_token', refreshToken, { ...cookieOpts(), maxAge: 604800000 });
  res.json({ id: userId, email: user.email, name: user.name, role: user.role });
}));

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/' });
  res.json({ message: 'Logged out successfully' });
});

app.get('/api/auth/me', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req);
  res.json(user);
}));

app.post('/api/auth/refresh', asyncHandler(async (req, res) => {
  const db = getDb();
  const token = req.cookies?.refresh_token;
  if (!token) return res.status(401).json({ detail: 'No refresh token' });
  let payload;
  try { payload = jwt.verify(token, getJwtSecret(), { algorithms: [JWT_ALG] }); }
  catch (e) { return res.status(401).json({ detail: e.name === 'TokenExpiredError' ? 'Refresh token expired' : 'Invalid refresh token' }); }
  if (payload.type !== 'refresh') return res.status(401).json({ detail: 'Invalid token type' });
  const doc = await db.collection('users').doc(payload.sub).get();
  if (!doc.exists) return res.status(401).json({ detail: 'User not found' });
  const accessToken = createAccessToken(doc.id, doc.data().email);
  res.cookie('access_token', accessToken, { ...cookieOpts(), maxAge: 900000 });
  res.json({ message: 'Token refreshed' });
}));

// ==================== MAKE.COM ENDPOINTS (simple api key) ====================
app.post('/api/leads/intake', asyncHandler(async (req, res) => {
  const db = getDb();
  try { validateApiKeySimple(req); } catch (e) { return res.status(401).json({ success: false, error: e.message }); }
  const data = req.body || {};
  const companyName = cleanStr(data.company_name);
  if (!companyName) return res.status(400).json({ success: false, error: 'company_name is required' });
  const phone = cleanStr(data.phone);
  const instagram = cleanStr(data.instagram_handle);
  const facebook = cleanStr(data.facebook_page);
  const { existingLead, matchedOn } = await findLeadByIdentifiers(phone, instagram, facebook);
  const ts = now();
  const source = cleanStr(data.source) || 'clawbot';
  const channel = cleanStr(data.channel) || 'instagram';
  if (existingLead) {
    const upd = { updated_at: ts, last_contact_date: ts };
    if (data.contact_name && !existingLead.contact_name) upd.contact_name = cleanStr(data.contact_name);
    if (phone && !existingLead.phone) upd.phone = phone;
    if (data.email && !existingLead.email) upd.email = cleanStr(data.email);
    if (instagram && !existingLead.instagram_handle) upd.instagram_handle = instagram;
    if (facebook && !existingLead.facebook_page) upd.facebook_page = facebook;
    if (data.website && !existingLead.website) upd.website = cleanStr(data.website);
    if ((data.city || data.location_city) && !existingLead.city) upd.city = cleanStr(data.city || data.location_city);
    if ((data.state || data.location_state) && !existingLead.state) upd.state = cleanStr(data.state || data.location_state);
    if (data.notes) { const ex = existingLead.notes || ''; upd.notes = `${ex}\n[${nowStamp()}] ${data.notes}`.trim(); }
    if (data.tags?.length) upd.tags = [...new Set([...(existingLead.tags || []), ...data.tags])];
    const activity = existingLead.activity || [];
    activity.push(addActivity(existingLead.id, 'updated_via_api', `Matched on ${matchedOn}`));
    upd.activity = activity;
    await db.collection('leads').doc(existingLead.id).update(upd);
    return res.json({ success: true, action: 'updated', lead_id: existingLead.id, matched_on: matchedOn });
  } else {
    const PLATFORM_MAP = { instagram: 'Instagram', facebook_group: 'Facebook Groups', facebook_dm: 'Facebook Groups', phone: 'Phone', website: 'Website', referral: 'Referral' };
    const leadId = uuid();
    const notes = cleanStr(data.notes);
    const leadDoc = {
      id: leadId, company_name: companyName, contact_name: cleanStr(data.contact_name),
      phone, email: cleanStr(data.email), city: cleanStr(data.city || data.location_city),
      state: cleanStr(data.state || data.location_state), website: cleanStr(data.website),
      instagram_handle: instagram, facebook_page: facebook,
      source_platform: PLATFORM_MAP[channel] || 'Other', source_detail: `via ${source}`,
      status: 'New Lead', priority: 'medium',
      notes: notes ? `[${nowStamp()}] ${notes}` : null,
      notes_history: [], tags: data.tags || [],
      first_contact_date: ts, last_contact_date: ts, next_action_date: null,
      assigned_to: 'Admin',
      activity: [addActivity(leadId, 'created_via_api', `Source: ${source}, Channel: ${channel}`)],
      created_at: ts, updated_at: ts
    };
    await db.collection('leads').doc(leadId).set(leadDoc);
    return res.json({ success: true, action: 'created', lead_id: leadId });
  }
}));

app.patch('/api/leads/:lead_id', asyncHandler(async (req, res) => {
  const db = getDb();
  try { validateApiKeySimple(req); } catch (e) { return res.status(401).json({ success: false, error: e.message }); }
  const { lead_id } = req.params;
  const ref = db.collection('leads').doc(lead_id);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ success: false, error: 'Lead not found' });
  const lead = doc.data();
  const data = req.body || {};
  const VALID_STATUSES = ['New Lead', 'Contacted', 'Replied', 'Interested', 'Qualified', 'Booked', 'No Response', 'Not Interested', 'Closed Won', 'Closed Lost'];
  const STATUS_MAP = { Won: 'Closed Won', Lost: 'Closed Lost', New: 'New Lead' };
  const ts = now();
  const upd = { updated_at: ts };
  const updatedFields = [];
  if ('status' in data) {
    let status = cleanStr(data.status);
    status = STATUS_MAP[status] || status;
    if (VALID_STATUSES.includes(status)) { upd.status = status; updatedFields.push('status'); }
  }
  for (const f of ['contact_name', 'email', 'phone', 'website', 'city', 'state', 'instagram_handle', 'facebook_page', 'priority', 'assigned_to']) {
    if (f in data) { upd[f] = cleanStr(data[f]); updatedFields.push(f); }
  }
  if (data.notes) { upd.notes = `${lead.notes || ''}\n[${nowStamp()}] ${data.notes}`.trim(); updatedFields.push('notes'); }
  if ('qualification_notes' in data) { upd.qualification_notes = cleanStr(data.qualification_notes); updatedFields.push('qualification_notes'); }
  if ('next_action_date' in data) { upd.next_action_date = data.next_action_date; updatedFields.push('next_action_date'); }
  if ('last_contact_date' in data) { upd.last_contact_date = data.last_contact_date; updatedFields.push('last_contact_date'); }
  if (data.tags?.length) { upd.tags = [...new Set([...(lead.tags || []), ...data.tags])]; updatedFields.push('tags'); }
  const activity = lead.activity || [];
  activity.push(addActivity(lead_id, 'updated_via_api', `Fields: ${updatedFields.join(', ')}`));
  upd.activity = activity;
  await ref.update(upd);
  res.json({ success: true, lead_id, updated_fields: updatedFields });
}));

app.get('/api/leads/search', asyncHandler(async (req, res) => {
  try { validateApiKeySimple(req); } catch (e) { return res.status(401).json({ success: false, error: e.message }); }
  const { phone, instagram_handle, facebook_page } = req.query;
  if (!phone && !instagram_handle && !facebook_page) return res.status(400).json({ success: false, error: 'Provide phone, instagram_handle, or facebook_page' });
  const { existingLead: lead, matchedOn } = await findLeadByIdentifiers(phone, instagram_handle, facebook_page);
  if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
  res.json({ success: true, matched_on: matchedOn, lead });
}));

app.post('/api/tasks/create', asyncHandler(async (req, res) => {
  const db = getDb();
  try { validateApiKeySimple(req); } catch (e) { return res.status(401).json({ success: false, error: e.message }); }
  const data = req.body || {};
  const leadId = cleanStr(data.lead_id);
  if (!leadId) return res.status(400).json({ success: false, error: 'lead_id is required' });
  const leadDoc = await db.collection('leads').doc(leadId).get();
  if (!leadDoc.exists) return res.status(400).json({ success: false, error: `Lead not found: ${leadId}` });
  const lead = leadDoc.data();
  const title = cleanStr(data.title);
  if (!title) return res.status(400).json({ success: false, error: 'title is required' });
  const ts = now();
  const taskId = uuid();
  const taskDoc = {
    id: taskId, lead_id: leadId, task_type: cleanStr(data.task_type) || 'send_follow_up', title,
    description: cleanStr(data.description), due_date: data.due_date || new Date(Date.now() + 86400000).toISOString(),
    assigned_to: cleanStr(data.assigned_to) || 'Admin', priority: cleanStr(data.priority) || 'medium',
    channel: cleanStr(data.channel), auto_generated: data.auto_generated !== false,
    completed: false, created_by: 'API', created_at: ts, updated_at: ts
  };
  await db.collection('tasks').doc(taskId).set(taskDoc);
  const activity = lead.activity || [];
  activity.push(addActivity(leadId, 'task_created', `Task: ${title}`));
  await db.collection('leads').doc(leadId).update({ activity, updated_at: ts });
  res.json({ success: true, task_id: taskId, lead_id: leadId });
}));

app.post('/api/bookings/create-or-update', asyncHandler(async (req, res) => {
  const db = getDb();
  try { validateApiKeySimple(req); } catch (e) { return res.status(401).json({ success: false, error: e.message }); }
  const data = req.body || {};
  const leadId = cleanStr(data.lead_id);
  if (!leadId) return res.status(400).json({ success: false, error: 'lead_id is required' });
  const leadDoc = await db.collection('leads').doc(leadId).get();
  if (!leadDoc.exists) return res.status(400).json({ success: false, error: `Lead not found: ${leadId}` });
  const lead = leadDoc.data();
  if (!data.booking_date) return res.status(400).json({ success: false, error: 'booking_date is required' });
  const ts = now();
  const bookingSource = cleanStr(data.booking_source || data.source) || 'manual';
  const status = cleanStr(data.status) || 'scheduled';
  const existingSnap = await db.collection('bookings').where('lead_id', '==', leadId).where('booking_date', '==', data.booking_date).limit(1).get();
  let bookingId, action;
  if (!existingSnap.empty) {
    const existing = existingSnap.docs[0].data();
    const upd = { booking_source: bookingSource, meeting_status: status, updated_at: ts };
    if (data.meeting_url) upd.meeting_url = data.meeting_url;
    if (data.notes) upd.notes = data.notes;
    if (data.calcom_event_id) upd.calcom_event_id = data.calcom_event_id;
    await db.collection('bookings').doc(existing.id).update(upd);
    bookingId = existing.id; action = 'updated';
  } else {
    bookingId = uuid();
    await db.collection('bookings').doc(bookingId).set({ id: bookingId, lead_id: leadId, booking_date: data.booking_date, booking_source: bookingSource, source: bookingSource, booking_type: cleanStr(data.booking_type) || 'demo', meeting_status: status, calcom_event_id: cleanStr(data.calcom_event_id), meeting_url: cleanStr(data.meeting_url), notes: cleanStr(data.notes), outcome: null, created_at: ts, updated_at: ts });
    action = 'created';
  }
  if (status !== 'cancelled' && !['Closed Won', 'Closed Lost'].includes(lead.status)) {
    const activity = lead.activity || [];
    activity.push(addActivity(leadId, 'booking_created', `Booking for ${data.booking_date.slice(0, 10)}`));
    await db.collection('leads').doc(leadId).update({ status: 'Booked', activity, updated_at: ts });
  }
  res.json({ success: true, booking_id: bookingId, lead_id: leadId, action });
}));

// ==================== LEADS ROUTES (JWT) ====================
app.get('/api/leads', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const { status, source_platform, priority, search, skip = 0, limit = 50 } = req.query;
  const snap = await db.collection('leads').get();
  let leads = snap.docs.map(d => d.data());
  if (status) leads = leads.filter(l => l.status === status);
  if (source_platform) leads = leads.filter(l => l.source_platform === source_platform);
  if (priority) leads = leads.filter(l => l.priority === priority);
  if (search) {
    const q = search.toLowerCase();
    leads = leads.filter(l =>
      (l.company_name || '').toLowerCase().includes(q) ||
      (l.contact_name || '').toLowerCase().includes(q) ||
      (l.phone || '').toLowerCase().includes(q) ||
      (l.email || '').toLowerCase().includes(q) ||
      (l.city || '').toLowerCase().includes(q)
    );
  }
  leads.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const total = leads.length;
  leads = leads.slice(Number(skip), Number(skip) + Number(limit));
  res.json({ leads, total });
}));

app.get('/api/leads/:lead_id', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const doc = await db.collection('leads').doc(req.params.lead_id).get();
  if (!doc.exists) return res.status(404).json({ detail: 'Lead not found' });
  res.json(doc.data());
}));

app.post('/api/leads', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const data = req.body || {};
  if (data.phone) {
    const snap = await db.collection('leads').where('phone', '==', data.phone).limit(1).get();
    if (!snap.empty) return res.status(400).json({ detail: 'Lead with this phone number already exists' });
  }
  const ts = now();
  const id = uuid();
  const doc = { ...data, id, first_contact_date: null, last_contact_date: null, next_action_date: null, created_at: ts, updated_at: ts };
  await db.collection('leads').doc(id).set(doc);
  res.json(doc);
}));

app.put('/api/leads/:lead_id', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const ref = db.collection('leads').doc(req.params.lead_id);
  const existing = await ref.get();
  if (!existing.exists) return res.status(404).json({ detail: 'Lead not found' });
  const upd = Object.fromEntries(Object.entries(req.body || {}).filter(([, v]) => v != null));
  upd.updated_at = now();
  await ref.update(upd);
  const updated = await ref.get();
  res.json(updated.data());
}));

app.delete('/api/leads/:lead_id', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const id = req.params.lead_id;
  const ref = db.collection('leads').doc(id);
  const existing = await ref.get();
  if (!existing.exists) return res.status(404).json({ detail: 'Lead not found' });
  const [tr, br, cr] = await Promise.all([
    deleteWhere('tasks', 'lead_id', id),
    deleteWhere('bookings', 'lead_id', id),
    deleteWhere('calls', 'lead_id', id),
  ]);
  await ref.delete();
  res.json({ message: 'Lead deleted', cascaded: { tasks: tr, bookings: br, calls: cr } });
}));

app.post('/api/leads/:lead_id/notes', asyncHandler(async (req, res) => {
  const db = getDb();
  const user = await getCurrentUser(req);
  const ref = db.collection('leads').doc(req.params.lead_id);
  const existing = await ref.get();
  if (!existing.exists) return res.status(404).json({ detail: 'Lead not found' });
  const note = { id: uuid(), content: req.body.content, created_by: user.name, created_at: now() };
  await ref.update({ notes_history: FV.arrayUnion(note), notes: req.body.content, updated_at: now() });
  res.json(note);
}));

// ==================== TASKS ====================
app.get('/api/tasks', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const { task_type, completed, skip = 0, limit = 50 } = req.query;
  const snap = await db.collection('tasks').get();
  let tasks = snap.docs.map(d => d.data());
  if (task_type) tasks = tasks.filter(t => t.task_type === task_type);
  if (completed !== undefined) tasks = tasks.filter(t => t.completed === (completed === 'true'));
  tasks.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
  const total = tasks.length;
  tasks = tasks.slice(Number(skip), Number(skip) + Number(limit));
  res.json({ tasks, total });
}));

app.post('/api/tasks', asyncHandler(async (req, res) => {
  const db = getDb();
  const user = await getCurrentUser(req);
  const ts = now();
  const id = uuid();
  const doc = { ...req.body, id, completed: false, created_by: user.name, created_at: ts, updated_at: ts };
  await db.collection('tasks').doc(id).set(doc);
  res.json(doc);
}));

app.put('/api/tasks/:task_id', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const ref = db.collection('tasks').doc(req.params.task_id);
  const existing = await ref.get();
  if (!existing.exists) return res.status(404).json({ detail: 'Task not found' });
  const upd = Object.fromEntries(Object.entries(req.body || {}).filter(([, v]) => v != null));
  upd.updated_at = now();
  await ref.update(upd);
  const updated = await ref.get();
  res.json(updated.data());
}));

app.delete('/api/tasks/:task_id', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const ref = db.collection('tasks').doc(req.params.task_id);
  const existing = await ref.get();
  if (!existing.exists) return res.status(404).json({ detail: 'Task not found' });
  await ref.delete();
  res.json({ message: 'Task deleted' });
}));

// ==================== BOOKINGS ====================
app.get('/api/bookings', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const { meeting_status, skip = 0, limit = 50 } = req.query;
  const snap = await db.collection('bookings').get();
  let bookings = snap.docs.map(d => d.data());
  if (meeting_status) bookings = bookings.filter(b => b.meeting_status === meeting_status);
  bookings.sort((a, b) => (b.booking_date || '').localeCompare(a.booking_date || ''));
  const total = bookings.length;
  bookings = bookings.slice(Number(skip), Number(skip) + Number(limit));
  res.json({ bookings, total });
}));

app.post('/api/bookings', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const ts = now();
  const id = uuid();
  const doc = { ...req.body, id, created_at: ts, updated_at: ts };
  await db.collection('bookings').doc(id).set(doc);
  res.json(doc);
}));

app.put('/api/bookings/:booking_id', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const ref = db.collection('bookings').doc(req.params.booking_id);
  const existing = await ref.get();
  if (!existing.exists) return res.status(404).json({ detail: 'Booking not found' });
  const upd = Object.fromEntries(Object.entries(req.body || {}).filter(([, v]) => v != null));
  upd.updated_at = now();
  await ref.update(upd);
  const updated = await ref.get();
  res.json(updated.data());
}));

app.delete('/api/bookings/:booking_id', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const ref = db.collection('bookings').doc(req.params.booking_id);
  const existing = await ref.get();
  if (!existing.exists) return res.status(404).json({ detail: 'Booking not found' });
  await ref.delete();
  res.json({ message: 'Booking deleted' });
}));

// ==================== CALLS ====================
app.get('/api/calls', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const { outcome, score, skip = 0, limit = 50 } = req.query;
  const snap = await db.collection('calls').get();
  let calls = snap.docs.map(d => d.data());
  if (outcome) calls = calls.filter(c => c.outcome === outcome);
  if (score) calls = calls.filter(c => c.score === score);
  calls.sort((a, b) => (b.call_date || '').localeCompare(a.call_date || ''));
  const total = calls.length;
  calls = calls.slice(Number(skip), Number(skip) + Number(limit));
  res.json({ calls, total });
}));

app.post('/api/calls', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const ts = now();
  const id = uuid();
  const doc = { ...req.body, id, call_date: ts, created_at: ts };
  await db.collection('calls').doc(id).set(doc);
  res.json(doc);
}));

app.put('/api/calls/:call_id', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const ref = db.collection('calls').doc(req.params.call_id);
  const existing = await ref.get();
  if (!existing.exists) return res.status(404).json({ detail: 'Call not found' });
  await ref.update(req.body);
  const updated = await ref.get();
  res.json(updated.data());
}));

app.delete('/api/calls/:call_id', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const ref = db.collection('calls').doc(req.params.call_id);
  const existing = await ref.get();
  if (!existing.exists) return res.status(404).json({ detail: 'Call not found' });
  await ref.delete();
  res.json({ message: 'Call deleted' });
}));

// ==================== OUTREACH ====================
app.get('/api/outreach/instagram', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const { skip = 0, limit = 50 } = req.query;
  const snap = await db.collection('outreach_instagram').get();
  let records = snap.docs.map(d => d.data());
  records.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const total = records.length;
  records = records.slice(Number(skip), Number(skip) + Number(limit));
  res.json({ records, total });
}));

app.post('/api/outreach/instagram', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const ts = now();
  const id = uuid();
  const doc = { ...req.body, id, date_contacted: ts, created_at: ts, updated_at: ts, timeline: [{ action: 'created', date: ts, details: 'Outreach record created' }] };
  await db.collection('outreach_instagram').doc(id).set(doc);
  res.json(doc);
}));

app.get('/api/outreach/facebook-groups', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const { skip = 0, limit = 50 } = req.query;
  const snap = await db.collection('outreach_facebook_groups').get();
  let records = snap.docs.map(d => d.data());
  records.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const total = records.length;
  records = records.slice(Number(skip), Number(skip) + Number(limit));
  res.json({ records, total });
}));

app.post('/api/outreach/facebook-groups', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const ts = now();
  const id = uuid();
  const doc = { ...req.body, id, created_at: ts, updated_at: ts, timeline: [{ action: 'created', date: ts, details: 'Facebook group outreach record created' }] };
  await db.collection('outreach_facebook_groups').doc(id).set(doc);
  res.json(doc);
}));

// ==================== TEMPLATES ====================
app.get('/api/templates', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const { category, platform } = req.query;
  const snap = await db.collection('message_templates').get();
  let templates = snap.docs.map(d => d.data());
  if (category) templates = templates.filter(t => t.category === category);
  if (platform) templates = templates.filter(t => t.platform === platform);
  templates.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  res.json({ templates });
}));

app.post('/api/templates', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const ts = now();
  const id = uuid();
  const doc = { ...req.body, id, created_at: ts, updated_at: ts };
  await db.collection('message_templates').doc(id).set(doc);
  res.json(doc);
}));

app.put('/api/templates/:template_id', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const ref = db.collection('message_templates').doc(req.params.template_id);
  const existing = await ref.get();
  if (!existing.exists) return res.status(404).json({ detail: 'Template not found' });
  const upd = { ...req.body, updated_at: now() };
  await ref.update(upd);
  const updated = await ref.get();
  res.json(updated.data());
}));

app.delete('/api/templates/:template_id', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const ref = db.collection('message_templates').doc(req.params.template_id);
  const existing = await ref.get();
  if (!existing.exists) return res.status(404).json({ detail: 'Template not found' });
  await ref.delete();
  res.json({ message: 'Template deleted' });
}));

// ==================== AUTOMATIONS ====================
app.get('/api/automations', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const snap = await db.collection('automations').get();
  const automations = snap.docs.map(d => d.data());
  res.json({ automations });
}));

app.put('/api/automations/:automation_id', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const ref = db.collection('automations').doc(req.params.automation_id);
  const existing = await ref.get();
  if (!existing.exists) return res.status(404).json({ detail: 'Automation not found' });
  await ref.update(req.body);
  const updated = await ref.get();
  res.json(updated.data());
}));

// ==================== DAY ACTIVITY ====================
app.get('/api/activity/day', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const date = req.query.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ detail: 'Invalid date: use YYYY-MM-DD' });
  const start = `${date}T00:00:00.000Z`;
  const nextStart = new Date(new Date(start).getTime() + 86400000).toISOString();
  const items = [];

  const leadsSnap = await db.collection('leads').get();
  const allLeads = leadsSnap.docs.map(d => d.data());
  for (const l of allLeads) {
    if (l.created_at >= start && l.created_at < nextStart) {
      items.push({ id: `lead-created-${l.id}`, kind: 'lead', activity_subtype: 'created', at: l.created_at, entity_id: l.id, lead_id: l.id, contact_label: [l.company_name, l.contact_name].filter(Boolean).join(' · ') || 'Lead', platform: l.source_platform || '—', status: l.status || '—', summary: (l.notes != null ? String(l.notes) : '').slice(0, 160), detail_route: `/leads/${l.id}` });
    }
    if (l.updated_at && l.updated_at >= start && l.updated_at < nextStart && l.updated_at !== l.created_at) {
      items.push({ id: `lead-updated-${l.id}-${l.updated_at}`, kind: 'lead', activity_subtype: 'updated', at: l.updated_at, entity_id: l.id, lead_id: l.id, contact_label: [l.company_name, l.contact_name].filter(Boolean).join(' · ') || 'Lead', platform: l.source_platform || '—', status: l.status || '—', summary: (l.notes != null ? String(l.notes) : '').slice(0, 160), detail_route: `/leads/${l.id}` });
    }
  }

  const callsSnap = await db.collection('calls').get();
  for (const d of callsSnap.docs) {
    const c = d.data();
    if (c.call_date >= start && c.call_date < nextStart) {
      items.push({ id: `call-${c.id}`, kind: 'call', activity_subtype: c.outcome || 'call', at: c.call_date, entity_id: c.id, lead_id: c.lead_id || null, contact_label: c.company_name || c.caller_phone || 'Call', platform: c.caller_phone ? 'Phone' : '—', status: c.outcome ? String(c.outcome).replace(/_/g, ' ') : '—', summary: (c.transcript_summary || c.notes || '').toString().slice(0, 160), detail_route: '/calls' });
    }
  }

  const bookingsSnap = await db.collection('bookings').get();
  for (const d of bookingsSnap.docs) {
    const b = d.data();
    if (b.booking_date >= start && b.booking_date < nextStart) {
      items.push({ id: `booking-${b.id}`, kind: 'booking', activity_subtype: b.meeting_status || 'scheduled', at: b.booking_date, entity_id: b.id, lead_id: b.lead_id || null, contact_label: b.lead_id ? `Lead ${String(b.lead_id).slice(0, 8)}…` : 'Booking', platform: b.source || b.booking_source || '—', status: b.meeting_status || '—', summary: (b.notes || '').toString().slice(0, 160), detail_route: '/bookings' });
    }
  }

  const tasksSnap = await db.collection('tasks').get();
  for (const d of tasksSnap.docs) {
    const t = d.data();
    if (t.due_date >= start && t.due_date < nextStart) {
      const title = (t.title || 'Task').toString();
      const desc = (t.description || '').toString();
      items.push({ id: `task-${t.id}`, kind: 'task', activity_subtype: t.task_type || 'task', at: t.due_date, entity_id: t.id, lead_id: t.lead_id || null, contact_label: title, platform: t.channel || '—', status: t.completed ? 'Completed' : 'Open', summary: (desc || title).slice(0, 160), detail_route: t.lead_id ? `/leads/${t.lead_id}` : '/tasks' });
    }
  }

  const leadMap = {};
  allLeads.forEach(l => { leadMap[l.id] = l; });
  for (const it of items) {
    if (it.lead_id && leadMap[it.lead_id] && ['booking', 'call', 'task'].includes(it.kind)) {
      const L = leadMap[it.lead_id];
      const cl = [L.company_name, L.contact_name].filter(Boolean).join(' · ');
      if (cl) {
        if (it.kind === 'task') it.summary = [it.contact_label, it.summary].filter(Boolean).join(' — ').slice(0, 160);
        it.contact_label = cl;
      }
    }
  }
  items.sort((a, b) => new Date(a.at) - new Date(b.at));
  res.json({ date, items });
}));

// ==================== DASHBOARD ====================
app.get('/api/dashboard/metrics', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString();
  const tomorrowIso = new Date(today.getTime() + 86400000).toISOString();

  const leadsSnap = await db.collection('leads').get();
  const allLeads = leadsSnap.docs.map(d => d.data());
  const totalLeads = allLeads.length;
  const newLeadsToday = allLeads.filter(l => l.created_at >= todayIso).length;
  const statusCounts = {};
  ['New Lead', 'Contacted', 'Replied', 'Interested', 'Qualified', 'Booked', 'No Response', 'Not Interested', 'Closed Won', 'Closed Lost'].forEach(s => statusCounts[s] = 0);
  allLeads.forEach(l => { if (l.status in statusCounts) statusCounts[l.status]++; });
  const platformCounts = {};
  allLeads.forEach(l => { if (l.source_platform) platformCounts[l.source_platform] = (platformCounts[l.source_platform] || 0) + 1; });

  const callsSnap = await db.collection('calls').get();
  const allCalls = callsSnap.docs.map(d => d.data());
  const totalCalls = allCalls.length;
  const qualifiedCalls = allCalls.filter(c => c.qualified).length;
  const bookedCalls = allCalls.filter(c => c.booked).length;

  const tasksSnap = await db.collection('tasks').get();
  const allTasks = tasksSnap.docs.map(d => d.data());
  const overdueTasks = allTasks.filter(t => t.due_date < todayIso && !t.completed).length;
  const tasksDueToday = allTasks.filter(t => t.due_date >= todayIso && t.due_date < tomorrowIso && !t.completed).length;

  const bookingsSnap = await db.collection('bookings').get();
  const allBookings = bookingsSnap.docs.map(d => d.data());
  const scheduledBookings = allBookings.filter(b => b.meeting_status === 'scheduled').length;
  const completedBookings = allBookings.filter(b => b.meeting_status === 'completed').length;

  const contacted = statusCounts['Contacted'] + statusCounts['Replied'] + statusCounts['Interested'] + statusCounts['Qualified'] + statusCounts['Booked'] + statusCounts['Closed Won'];
  const replied = statusCounts['Replied'] + statusCounts['Interested'] + statusCounts['Qualified'] + statusCounts['Booked'] + statusCounts['Closed Won'];
  const interested = statusCounts['Interested'] + statusCounts['Qualified'] + statusCounts['Booked'] + statusCounts['Closed Won'];
  const booked = statusCounts['Booked'] + statusCounts['Closed Won'];
  const closedWon = statusCounts['Closed Won'];
  res.json({ leads: { total: totalLeads, new_today: newLeadsToday, contacted, replied, interested, qualified: statusCounts['Qualified'], booked, closed_won: closedWon, closed_lost: statusCounts['Closed Lost'], no_response: statusCounts['No Response'] }, status_counts: statusCounts, platform_breakdown: { instagram: platformCounts['Instagram'] || 0, facebook_groups: platformCounts['Facebook Groups'] || 0 }, calls: { total: totalCalls, qualified: qualifiedCalls, booked: bookedCalls }, tasks: { overdue: overdueTasks, due_today: tasksDueToday }, bookings: { scheduled: scheduledBookings, completed: completedBookings }, conversion_rates: { contacted_to_replied: contacted > 0 ? Math.round(replied / contacted * 1000) / 10 : 0, replied_to_interested: replied > 0 ? Math.round(interested / replied * 1000) / 10 : 0, interested_to_booked: interested > 0 ? Math.round(booked / interested * 1000) / 10 : 0, booked_to_closed: booked > 0 ? Math.round(closedWon / booked * 1000) / 10 : 0 } });
}));

// ==================== SETTINGS ====================
app.get('/api/settings/statuses', asyncHandler(async (req, res) => {
  const db = getDb();
  await getCurrentUser(req);
  const doc = await db.collection('settings').doc('lead_statuses').get();
  if (!doc.exists) return res.json({ statuses: ['New Lead', 'Contacted', 'Replied', 'Interested', 'Qualified', 'Booked', 'No Response', 'Not Interested', 'Closed Won', 'Closed Lost'] });
  res.json(doc.data());
}));

app.put('/api/settings/statuses', asyncHandler(async (req, res) => {
  const db = getDb();
  const user = await getCurrentUser(req);
  if (user.role !== 'admin') return res.status(403).json({ detail: 'Admin access required' });
  await db.collection('settings').doc('lead_statuses').set({ type: 'lead_statuses', statuses: req.body.statuses || [], updated_at: now() }, { merge: true });
  res.json({ message: 'Statuses updated', statuses: req.body.statuses || [] });
}));

// ==================== USERS ====================
app.get('/api/users', asyncHandler(async (req, res) => {
  const db = getDb();
  const user = await getCurrentUser(req);
  if (user.role !== 'admin') return res.status(403).json({ detail: 'Admin access required' });
  const snap = await db.collection('users').get();
  const users = snap.docs.map(d => { const u = d.data(); delete u.password_hash; if (!u.id) u.id = d.id; return u; });
  res.json({ users });
}));

// ==================== API KEYS ====================
app.post('/api/api-keys', asyncHandler(async (req, res) => {
  const db = getDb();
  const user = await getCurrentUser(req);
  if (user.role !== 'admin') return res.status(403).json({ detail: 'Admin access required' });
  const apiKey = `vp_${crypto.randomBytes(32).toString('base64url')}`;
  const id = uuid();
  const doc = { id, key: apiKey, name: req.body.name, created_by: user.id, is_active: true, permissions: req.body.permissions || ['leads:write', 'tasks:write', 'bookings:write', 'calls:write'], created_at: now(), last_used_at: null };
  await db.collection('api_keys').doc(id).set(doc);
  res.json({ id, name: doc.name, key: apiKey, permissions: doc.permissions, message: "Save this key securely - it won't be shown again!" });
}));

app.get('/api/api-keys', asyncHandler(async (req, res) => {
  const db = getDb();
  const user = await getCurrentUser(req);
  if (user.role !== 'admin') return res.status(403).json({ detail: 'Admin access required' });
  const snap = await db.collection('api_keys').get();
  const keys = snap.docs.map(d => { const k = d.data(); if (k.key) { k.key_preview = k.key.slice(0, 7) + '...' + k.key.slice(-4); delete k.key; } return k; });
  res.json({ api_keys: keys });
}));

app.delete('/api/api-keys/:key_id', asyncHandler(async (req, res) => {
  const db = getDb();
  const user = await getCurrentUser(req);
  if (user.role !== 'admin') return res.status(403).json({ detail: 'Admin access required' });
  const ref = db.collection('api_keys').doc(req.params.key_id);
  const existing = await ref.get();
  if (!existing.exists) return res.status(404).json({ detail: 'API key not found' });
  await ref.update({ is_active: false, revoked_at: now() });
  res.json({ message: 'API key revoked', id: req.params.key_id });
}));

// ==================== INTEGRATION LOGS ====================
app.get('/api/integration-logs', asyncHandler(async (req, res) => {
  const db = getDb();
  const user = await getCurrentUser(req);
  if (user.role !== 'admin') return res.status(403).json({ detail: 'Admin access required' });
  const limit = Number(req.query.limit) || 100;
  const snap = await db.collection('integration_logs').orderBy('created_at', 'desc').limit(limit).get();
  const logs = snap.docs.map(d => d.data());
  res.json({ logs });
}));

// ==================== EXTERNAL ROUTES ====================
app.patch('/api/external/leads/update', asyncHandler(async (req, res) => {
  const db = getDb();
  const apiKey = await validateApiKey(req, 'leads:write').catch(() => null);
  if (!apiKey) return res.status(401).json({ detail: 'Invalid API key' });
  const data = req.body || {};
  let lead = null;
  if (data.lead_id) { const d = await db.collection('leads').doc(data.lead_id).get(); if (d.exists) lead = d.data(); }
  if (!lead && data.phone) {
    const norm = normalizePhone(data.phone);
    const snap = await db.collection('leads').get();
    lead = snap.docs.map(d => d.data()).find(l => l.phone && normalizePhone(l.phone) === norm) || null;
  }
  if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
  const updates = data.updates || {};
  const upd = { updated_at: now() };
  const updatedFields = [];
  const STATUS_MAP = { New: 'New Lead', Won: 'Closed Won', Lost: 'Closed Lost' };
  if (updates.status) { upd.status = STATUS_MAP[updates.status] || updates.status; updatedFields.push('status'); }
  if (updates.notes) { upd.notes = `${lead.notes || ''}\n[${nowStamp()}] ${updates.notes}`.trim(); updatedFields.push('notes'); }
  for (const f of ['contact_name', 'email', 'phone', 'website', 'last_contact_date', 'next_action_date', 'qualification_notes']) {
    if (updates[f]) { upd[f] = updates[f]; updatedFields.push(f); }
  }
  if (updates.tags?.length) { upd.tags = [...new Set([...(lead.tags || []), ...updates.tags])]; updatedFields.push('tags'); }
  await db.collection('leads').doc(lead.id).update(upd);
  await logIntegrationCall('/api/external/leads/update', apiKey.name, true, 200, `Lead updated: ${lead.company_name}`, data);
  res.json({ success: true, lead_id: lead.id, updated_fields: updatedFields });
}));

app.post('/api/external/leads/intake', asyncHandler(async (req, res) => {
  const apiKey = await validateApiKey(req, 'leads:write').catch(() => null);
  if (!apiKey) return res.status(401).json({ detail: 'Invalid API key' });
  const db = getDb();
  const data = req.body || {};
  const companyName = cleanStr(data.company_name);
  if (!companyName) return res.status(400).json({ success: false, error: 'company_name is required' });
  const phone = cleanStr(data.phone); const instagram = cleanStr(data.instagram_handle); const facebook = cleanStr(data.facebook_page);
  const { existingLead, matchedOn } = await findLeadByIdentifiers(phone, instagram, facebook);
  const ts = now();
  if (existingLead) {
    await db.collection('leads').doc(existingLead.id).update({ updated_at: ts, last_contact_date: ts });
    await logIntegrationCall('/api/external/leads/intake', apiKey.name, true, 200, `Lead updated: ${existingLead.company_name}`, data);
    return res.json({ success: true, action: 'updated', lead_id: existingLead.id, matched_on: matchedOn });
  } else {
    const leadId = uuid();
    const PLATFORM_MAP = { instagram: 'Instagram', facebook_group: 'Facebook Groups', facebook_dm: 'Facebook Groups', phone: 'Phone', website: 'Website', referral: 'Referral' };
    const channel = cleanStr(data.channel) || 'instagram'; const source = cleanStr(data.source) || 'clawbot';
    const doc = { id: leadId, company_name: companyName, contact_name: cleanStr(data.contact_name), phone, email: cleanStr(data.email), city: cleanStr(data.location_city), state: cleanStr(data.location_state), website: cleanStr(data.website), instagram_handle: instagram, facebook_page: facebook, source_platform: PLATFORM_MAP[channel] || 'Other', source_detail: `via ${source}`, status: 'New Lead', priority: 'medium', notes: null, notes_history: [], tags: data.tags || [], first_contact_date: data.detected_at || ts, last_contact_date: ts, next_action_date: null, assigned_to: 'Admin', created_at: ts, updated_at: ts };
    await db.collection('leads').doc(leadId).set(doc);
    await logIntegrationCall('/api/external/leads/intake', apiKey.name, true, 201, `Lead created: ${companyName}`, data);
    return res.status(201).json({ success: true, action: 'created', lead_id: leadId });
  }
}));

app.post('/api/external/tasks/create', asyncHandler(async (req, res) => {
  const db = getDb();
  const apiKey = await validateApiKey(req, 'tasks:write').catch(() => null);
  if (!apiKey) return res.status(401).json({ detail: 'Invalid API key' });
  const data = req.body || {};
  const leadDoc = await db.collection('leads').doc(data.lead_id || '').get();
  if (!leadDoc.exists) { await logIntegrationCall('/api/external/tasks/create', apiKey.name, false, 400, `Lead not found: ${data.lead_id}`, data); return res.status(400).json({ success: false, error: `Lead not found: ${data.lead_id}` }); }
  const ts = now();
  const taskId = uuid();
  const taskDoc = { id: taskId, lead_id: data.lead_id, task_type: data.task_type, title: data.title, description: data.description, due_date: data.due_date || new Date(Date.now() + 86400000).toISOString(), assigned_to: data.assigned_to || 'Admin', priority: data.priority || 'medium', channel: data.channel, auto_generated: data.auto_generated !== false, completed: false, created_by: `API: ${apiKey.name}`, created_at: ts, updated_at: ts };
  await db.collection('tasks').doc(taskId).set(taskDoc);
  await logIntegrationCall('/api/external/tasks/create', apiKey.name, true, 201, `Task created: ${data.title}`, data);
  res.status(201).json({ success: true, task_id: taskId, lead_id: data.lead_id });
}));

app.post('/api/external/bookings/create-or-update', asyncHandler(async (req, res) => {
  const db = getDb();
  const apiKey = await validateApiKey(req, 'bookings:write').catch(() => null);
  if (!apiKey) return res.status(401).json({ detail: 'Invalid API key' });
  const data = req.body || {};
  const leadDoc = await db.collection('leads').doc(data.lead_id || '').get();
  if (!leadDoc.exists) return res.status(400).json({ success: false, error: `Lead not found: ${data.lead_id}` });
  const ts = now();
  const existingSnap = await db.collection('bookings').where('lead_id', '==', data.lead_id).where('booking_date', '==', data.booking_date).limit(1).get();
  let bookingId, action;
  if (!existingSnap.empty) {
    const existing = existingSnap.docs[0].data();
    await db.collection('bookings').doc(existing.id).update({ meeting_status: data.status, updated_at: ts });
    bookingId = existing.id; action = 'updated';
  } else {
    bookingId = uuid();
    await db.collection('bookings').doc(bookingId).set({ id: bookingId, lead_id: data.lead_id, booking_date: data.booking_date, booking_source: data.booking_source, source: data.booking_source, booking_type: data.booking_type || 'demo', meeting_status: data.status || 'scheduled', calcom_event_id: data.calcom_event_id, meeting_url: data.meeting_url, notes: data.notes, outcome: null, created_at: ts, updated_at: ts });
    action = 'created';
  }
  if (data.status !== 'cancelled') await db.collection('leads').doc(data.lead_id).update({ status: 'Booked', updated_at: ts });
  await logIntegrationCall('/api/external/bookings/create-or-update', apiKey.name, true, 201, `Booking ${action}`, data);
  res.status(201).json({ success: true, action, booking_id: bookingId, lead_id: data.lead_id });
}));

app.post('/api/external/calls/log', asyncHandler(async (req, res) => {
  const db = getDb();
  const apiKey = await validateApiKey(req, 'calls:write').catch(() => null);
  if (!apiKey) return res.status(401).json({ detail: 'Invalid API key' });
  const data = req.body || {};
  const ts = now();
  const normPhone = normalizePhone(data.phone);
  const leadsSnap = await db.collection('leads').get();
  const matchedLead = leadsSnap.docs.map(d => d.data()).find(l => l.phone && normalizePhone(l.phone) === normPhone) || null;
  const callId = uuid();
  const callDoc = { id: callId, lead_id: matchedLead?.id || null, caller_phone: data.phone, company_name: matchedLead?.company_name || null, direction: data.direction, call_date: data.call_date, duration_seconds: data.duration_seconds || 0, outcome: data.booked ? 'booked' : data.qualified ? 'qualified' : 'answered', qualified: data.qualified || false, booked: data.booked || false, transcript_summary: data.transcript_summary, recording_url: data.recording_url, retell_call_id: data.retell_call_id, notes: data.notes, score: data.booked ? 'good' : 'average', created_at: ts };
  await db.collection('calls').doc(callId).set(callDoc);
  if (matchedLead) {
    const leadUpd = { last_contact_date: ts, updated_at: ts };
    if (data.booked) leadUpd.status = 'Booked';
    else if (data.qualified && !['Booked', 'Closed Won'].includes(matchedLead.status)) leadUpd.status = 'Qualified';
    await db.collection('leads').doc(matchedLead.id).update(leadUpd);
  }
  await logIntegrationCall('/api/external/calls/log', apiKey.name, true, 201, `Call logged: ${data.phone}`, data);
  res.status(201).json({ success: true, call_id: callId, matched_lead_id: matchedLead?.id || null });
}));

// ==================== ERROR HANDLER ====================
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({ detail: err.message || 'Internal server error' });
});

module.exports.handler = serverless(app);
