const express = require('express');
const serverless = require('serverless-http');
const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

// ==================== DB CONNECTION ====================
let _db = null;

async function getDb() {
  if (_db) return _db;
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error('MONGO_URL environment variable is not set');
  const client = new MongoClient(mongoUrl);
  await client.connect();
  _db = client.db(process.env.DB_NAME || 'villapel_os');
  try {
    await _db.collection('users').createIndex({ email: 1 }, { unique: true });
    await _db.collection('leads').createIndex({ id: 1 }, { unique: true });
    await _db.collection('leads').createIndex({ phone: 1 });
    await _db.collection('leads').createIndex({ instagram_handle: 1 });
    await _db.collection('leads').createIndex({ status: 1 });
    await _db.collection('api_keys').createIndex({ key: 1 }, { unique: true, sparse: true });
    await _db.collection('integration_logs').createIndex({ created_at: -1 });
  } catch (e) { /* indexes may already exist */ }
  await seedAdmin(_db);
  return _db;
}

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
  const db = await getDb();
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
  const user = await db.collection('users').findOne({ _id: new ObjectId(payload.sub) });
  if (!user) { const e = new Error('User not found'); e.status = 401; throw e; }
  user._id = user._id.toString();
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
  const db = await getDb();
  const key = req.headers['x-api-key'];
  if (!key) { const e = new Error('Missing x-api-key header'); e.status = 401; throw e; }
  const keyDoc = await db.collection('api_keys').findOne({ key, is_active: true });
  if (!keyDoc) { const e = new Error('Invalid or revoked API key'); e.status = 401; throw e; }
  if (requiredPermission && !(keyDoc.permissions || []).includes(requiredPermission)) {
    const e = new Error(`API key lacks required permission: ${requiredPermission}`); e.status = 403; throw e;
  }
  await db.collection('api_keys').updateOne({ _id: keyDoc._id }, { $set: { last_used_at: now() } });
  return keyDoc;
}

// ==================== SEED ====================
async function seedAdmin(db) {
  const email = process.env.ADMIN_EMAIL || 'admin@villapel.com';
  const password = process.env.ADMIN_PASSWORD || 'VillapelAdmin2024!';
  const existing = await db.collection('users').findOne({ email });
  if (!existing) {
    const hash = await bcrypt.hash(password, 10);
    await db.collection('users').insertOne({ email, password_hash: hash, name: 'Admin', role: 'admin', created_at: new Date() });
  }
}

// ==================== LOG HELPER ====================
async function logIntegrationCall(db, endpoint, apiKeyName, success, responseCode, summary, requestBody) {
  const entry = { id: uuid(), timestamp: now(), endpoint, source: apiKeyName, success, response_code: responseCode, summary, request_preview: requestBody ? JSON.stringify(requestBody).slice(0, 500) : null, created_at: now() };
  await db.collection('integration_logs').insertOne(entry);
  const count = await db.collection('integration_logs').countDocuments();
  if (count > 500) {
    const oldest = await db.collection('integration_logs').find({}).sort({ created_at: 1 }).limit(count - 500).toArray();
    if (oldest.length) await db.collection('integration_logs').deleteMany({ _id: { $in: oldest.map(d => d._id) } });
  }
}

// ==================== DEDUP HELPER ====================
async function findLeadByIdentifiers(db, phone, instagram, facebook) {
  let existingLead = null, matchedOn = null;
  if (phone) {
    const normPhone = normalizePhone(phone);
    const leads = await db.collection('leads').find({ phone: { $exists: true, $ne: null } }).toArray();
    existingLead = leads.find(l => normalizePhone(l.phone || '') === normPhone) || null;
    if (existingLead) matchedOn = 'phone';
  }
  if (!existingLead && instagram) {
    const normIg = normalizeInstagram(instagram);
    const leads = await db.collection('leads').find({ instagram_handle: { $exists: true, $ne: null } }).toArray();
    existingLead = leads.find(l => normalizeInstagram(l.instagram_handle || '') === normIg) || null;
    if (existingLead) matchedOn = 'instagram_handle';
  }
  if (!existingLead && facebook) {
    const normFb = normalizeFacebook(facebook);
    const leads = await db.collection('leads').find({ facebook_page: { $exists: true, $ne: null } }).toArray();
    existingLead = leads.find(l => normalizeFacebook(l.facebook_page || '') === normFb) || null;
    if (existingLead) matchedOn = 'facebook_page';
  }
  return { existingLead, matchedOn };
}

// ==================== EXPRESS APP ====================
const app = express();
app.use(express.json());
app.use(cookieParser());

// CORS for development and Make.com
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

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// ==================== HEALTH ====================
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'villapel-os-api' }));
app.get('/', (req, res) => res.json({ status: 'ok' }));

// ==================== AUTH ROUTES ====================
app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const db = await getDb();
  const { email: rawEmail, password } = req.body || {};
  if (!rawEmail || !password) return res.status(400).json({ detail: 'Email and password required' });
  const email = rawEmail.toLowerCase();
  const ip = (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const identifier = `${ip}:${email}`;
  const attempt = await db.collection('login_attempts').findOne({ identifier });
  if (attempt?.locked_until && new Date(attempt.locked_until) > new Date()) {
    return res.status(429).json({ detail: 'Too many failed attempts. Try again later.' });
  }
  const user = await db.collection('users').findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    await db.collection('login_attempts').updateOne({ identifier }, { $inc: { attempts: 1 }, $set: { last_attempt: now() } }, { upsert: true });
    return res.status(401).json({ detail: 'Invalid email or password' });
  }
  await db.collection('login_attempts').deleteOne({ identifier });
  const userId = user._id.toString();
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
  const db = await getDb();
  const token = req.cookies?.refresh_token;
  if (!token) return res.status(401).json({ detail: 'No refresh token' });
  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret(), { algorithms: [JWT_ALG] });
  } catch (e) {
    return res.status(401).json({ detail: e.name === 'TokenExpiredError' ? 'Refresh token expired' : 'Invalid refresh token' });
  }
  if (payload.type !== 'refresh') return res.status(401).json({ detail: 'Invalid token type' });
  const user = await db.collection('users').findOne({ _id: new ObjectId(payload.sub) });
  if (!user) return res.status(401).json({ detail: 'User not found' });
  const accessToken = createAccessToken(user._id.toString(), user.email);
  res.cookie('access_token', accessToken, { ...cookieOpts(), maxAge: 900000 });
  res.json({ message: 'Token refreshed' });
}));

// ==================== MAKE.COM ENDPOINTS (simple api key) ====================
app.post('/api/leads/intake', asyncHandler(async (req, res) => {
  const db = await getDb();
  try { validateApiKeySimple(req); } catch (e) { return res.status(401).json({ success: false, error: e.message }); }
  const data = req.body || {};
  const companyName = cleanStr(data.company_name);
  if (!companyName) return res.status(400).json({ success: false, error: 'company_name is required' });
  const phone = cleanStr(data.phone);
  const instagram = cleanStr(data.instagram_handle);
  const facebook = cleanStr(data.facebook_page);
  const { existingLead, matchedOn } = await findLeadByIdentifiers(db, phone, instagram, facebook);
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
    await db.collection('leads').updateOne({ id: existingLead.id }, { $set: upd });
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
    await db.collection('leads').insertOne(leadDoc);
    return res.json({ success: true, action: 'created', lead_id: leadId });
  }
}));

app.patch('/api/leads/:lead_id', asyncHandler(async (req, res) => {
  const db = await getDb();
  try { validateApiKeySimple(req); } catch (e) { return res.status(401).json({ success: false, error: e.message }); }
  const { lead_id } = req.params;
  const data = req.body || {};
  const lead = await db.collection('leads').findOne({ id: lead_id });
  if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
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
  await db.collection('leads').updateOne({ id: lead_id }, { $set: upd });
  res.json({ success: true, lead_id, updated_fields: updatedFields });
}));

app.get('/api/leads/search', asyncHandler(async (req, res) => {
  const db = await getDb();
  try { validateApiKeySimple(req); } catch (e) { return res.status(401).json({ success: false, error: e.message }); }
  const { phone, instagram_handle, facebook_page } = req.query;
  if (!phone && !instagram_handle && !facebook_page) return res.status(400).json({ success: false, error: 'Provide phone, instagram_handle, or facebook_page' });
  const { existingLead: lead, matchedOn } = await findLeadByIdentifiers(db, phone, instagram_handle, facebook_page);
  if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
  delete lead._id;
  res.json({ success: true, id: lead.id, matched_on: matchedOn, lead });
}));

app.post('/api/tasks/create', asyncHandler(async (req, res) => {
  const db = await getDb();
  try { validateApiKeySimple(req); } catch (e) { return res.status(401).json({ success: false, error: e.message }); }
  const data = req.body || {};
  const leadId = cleanStr(data.lead_id);
  if (!leadId) return res.status(400).json({ success: false, error: 'lead_id is required' });
  const lead = await db.collection('leads').findOne({ id: leadId });
  if (!lead) return res.status(400).json({ success: false, error: `Lead not found: ${leadId}` });
  const title = cleanStr(data.title) || {send_follow_up:'Follow Up Task',follow_up:'Follow Up Task',reactivation:'Reactivation Task',booking_followup:'Booking Follow Up'}[cleanStr(data.task_type)||''] || (cleanStr(data.task_type) ? cleanStr(data.task_type).replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()) : 'General Task');

  const ts = now();
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const taskId = uuid();
  const taskDoc = {
    id: taskId, lead_id: leadId, task_type: cleanStr(data.task_type) || 'send_follow_up', title,
    description: cleanStr(data.description), due_date: data.due_date || tomorrow,
    assigned_to: cleanStr(data.assigned_to) || 'Admin', priority: cleanStr(data.priority) || 'medium',
    channel: cleanStr(data.channel), auto_generated: data.auto_generated !== false,
    completed: false, created_by: 'API', created_at: ts, updated_at: ts
  };
  await db.collection('tasks').insertOne(taskDoc);
  const activity = lead.activity || [];
  activity.push(addActivity(leadId, 'task_created', `Task: ${title}`));
  await db.collection('leads').updateOne({ id: leadId }, { $set: { activity, updated_at: ts } });
  res.json({ success: true, task_id: taskId, lead_id: leadId, task_type: taskDoc.task_type });
}));

app.post('/api/bookings/create-or-update', asyncHandler(async (req, res) => {
  const db = await getDb();
  try { validateApiKeySimple(req); } catch (e) { return res.status(401).json({ success: false, error: e.message }); }
  const data = req.body || {};
  const leadId = cleanStr(data.lead_id);
  if (!leadId) return res.status(400).json({ success: false, error: 'lead_id is required' });
  const lead = await db.collection('leads').findOne({ id: leadId });
  if (!lead) return res.status(400).json({ success: false, error: `Lead not found: ${leadId}` });
  if (!data.booking_date) return res.status(400).json({ success: false, error: 'booking_date is required' });
  const ts = now();
  const bookingSource = cleanStr(data.booking_source || data.source) || 'manual';
  const status = cleanStr(data.status) || 'scheduled';
  const existing = await db.collection('bookings').findOne({ lead_id: leadId, booking_date: data.booking_date });
  let bookingId, action;
  if (existing) {
    const upd = { booking_source: bookingSource, meeting_status: status, updated_at: ts };
    if (data.meeting_url) upd.meeting_url = data.meeting_url;
    if (data.notes) upd.notes = data.notes;
    if (data.calcom_event_id) upd.calcom_event_id = data.calcom_event_id;
    await db.collection('bookings').updateOne({ id: existing.id }, { $set: upd });
    bookingId = existing.id; action = 'updated';
  } else {
    bookingId = uuid();
    await db.collection('bookings').insertOne({ id: bookingId, lead_id: leadId, booking_date: data.booking_date, booking_source: bookingSource, source: bookingSource, booking_type: cleanStr(data.booking_type) || 'demo', meeting_status: status, calcom_event_id: cleanStr(data.calcom_event_id), meeting_url: cleanStr(data.meeting_url), notes: cleanStr(data.notes), outcome: null, created_at: ts, updated_at: ts });
    action = 'created';
  }
  if (status !== 'cancelled' && !['Closed Won', 'Closed Lost'].includes(lead.status)) {
    const activity = lead.activity || [];
    activity.push(addActivity(leadId, 'booking_created', `Booking for ${data.booking_date.slice(0, 10)}`));
    await db.collection('leads').updateOne({ id: leadId }, { $set: { status: 'Booked', activity, updated_at: ts } });
  }
  res.json({ success: true, booking_id: bookingId, lead_id: leadId, action });
}));

// ==================== LEADS ROUTES (JWT) ====================
app.get('/api/leads', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const { status, source_platform, priority, search, skip = 0, limit = 50 } = req.query;
  const query = {};
  if (status) query.status = status;
  if (source_platform) query.source_platform = source_platform;
  if (priority) query.priority = priority;
  if (search) query.$or = [
    { company_name: { $regex: search, $options: 'i' } },
    { contact_name: { $regex: search, $options: 'i' } },
    { phone: { $regex: search, $options: 'i' } },
    { email: { $regex: search, $options: 'i' } },
    { city: { $regex: search, $options: 'i' } }
  ];
  const leads = await db.collection('leads').find(query, { projection: { _id: 0 } }).sort({ created_at: -1 }).skip(Number(skip)).limit(Number(limit)).toArray();
  const total = await db.collection('leads').countDocuments(query);
  res.json({ leads, total });
}));

app.get('/api/leads/:lead_id', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const lead = await db.collection('leads').findOne({ id: req.params.lead_id }, { projection: { _id: 0 } });
  if (!lead) return res.status(404).json({ detail: 'Lead not found' });
  res.json(lead);
}));

app.post('/api/leads', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const data = req.body || {};
  if (data.phone) {
    const ex = await db.collection('leads').findOne({ phone: data.phone });
    if (ex) return res.status(400).json({ detail: 'Lead with this phone number already exists' });
  }
  const ts = now();
  const doc = { ...data, id: uuid(), first_contact_date: null, last_contact_date: null, next_action_date: null, created_at: ts, updated_at: ts };
  await db.collection('leads').insertOne(doc);
  delete doc._id;
  res.json(doc);
}));

app.put('/api/leads/:lead_id', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const upd = Object.fromEntries(Object.entries(req.body || {}).filter(([, v]) => v != null));
  upd.updated_at = now();
  const result = await db.collection('leads').updateOne({ id: req.params.lead_id }, { $set: upd });
  if (result.matchedCount === 0) return res.status(404).json({ detail: 'Lead not found' });
  const lead = await db.collection('leads').findOne({ id: req.params.lead_id }, { projection: { _id: 0 } });
  res.json(lead);
}));

app.delete('/api/leads/:lead_id', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const result = await db.collection('leads').deleteOne({ id: req.params.lead_id });
  if (result.deletedCount === 0) return res.status(404).json({ detail: 'Lead not found' });
  res.json({ message: 'Lead deleted' });
}));

app.post('/api/leads/:lead_id/notes', asyncHandler(async (req, res) => {
  const db = await getDb();
  const user = await getCurrentUser(req);
  const note = { id: uuid(), content: req.body.content, created_by: user.name, created_at: now() };
  const result = await db.collection('leads').updateOne(
    { id: req.params.lead_id },
    { $push: { notes_history: note }, $set: { notes: req.body.content, updated_at: now() } }
  );
  if (result.matchedCount === 0) return res.status(404).json({ detail: 'Lead not found' });
  res.json(note);
}));

// ==================== TASKS ====================
app.get('/api/tasks', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const { task_type, completed, skip = 0, limit = 50 } = req.query;
  const query = {};
  if (task_type) query.task_type = task_type;
  if (completed !== undefined) query.completed = completed === 'true';
  const tasks = await db.collection('tasks').find(query, { projection: { _id: 0 } }).sort({ due_date: 1 }).skip(Number(skip)).limit(Number(limit)).toArray();
  const total = await db.collection('tasks').countDocuments(query);
  res.json({ tasks, total });
}));

app.post('/api/tasks', asyncHandler(async (req, res) => {
  const db = await getDb();
  const user = await getCurrentUser(req);
  const ts = now();
  const doc = { ...req.body, id: uuid(), completed: false, created_by: user.name, created_at: ts, updated_at: ts };
  await db.collection('tasks').insertOne(doc);
  delete doc._id;
  res.json(doc);
}));

app.put('/api/tasks/:task_id', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const upd = Object.fromEntries(Object.entries(req.body || {}).filter(([, v]) => v != null));
  upd.updated_at = now();
  const result = await db.collection('tasks').updateOne({ id: req.params.task_id }, { $set: upd });
  if (result.matchedCount === 0) return res.status(404).json({ detail: 'Task not found' });
  const task = await db.collection('tasks').findOne({ id: req.params.task_id }, { projection: { _id: 0 } });
  res.json(task);
}));

app.delete('/api/tasks/:task_id', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const result = await db.collection('tasks').deleteOne({ id: req.params.task_id });
  if (result.deletedCount === 0) return res.status(404).json({ detail: 'Task not found' });
  res.json({ message: 'Task deleted' });
}));

// ==================== BOOKINGS ====================
app.get('/api/bookings', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const { meeting_status, skip = 0, limit = 50 } = req.query;
  const query = {};
  if (meeting_status) query.meeting_status = meeting_status;
  const bookings = await db.collection('bookings').find(query, { projection: { _id: 0 } }).sort({ booking_date: -1 }).skip(Number(skip)).limit(Number(limit)).toArray();
  const total = await db.collection('bookings').countDocuments(query);
  res.json({ bookings, total });
}));

app.post('/api/bookings', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const ts = now();
  const doc = { ...req.body, id: uuid(), created_at: ts, updated_at: ts };
  await db.collection('bookings').insertOne(doc);
  delete doc._id;
  res.json(doc);
}));

app.put('/api/bookings/:booking_id', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const upd = Object.fromEntries(Object.entries(req.body || {}).filter(([, v]) => v != null));
  upd.updated_at = now();
  const result = await db.collection('bookings').updateOne({ id: req.params.booking_id }, { $set: upd });
  if (result.matchedCount === 0) return res.status(404).json({ detail: 'Booking not found' });
  const booking = await db.collection('bookings').findOne({ id: req.params.booking_id }, { projection: { _id: 0 } });
  res.json(booking);
}));

// ==================== CALLS ====================
app.get('/api/calls', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const { outcome, score, skip = 0, limit = 50 } = req.query;
  const query = {};
  if (outcome) query.outcome = outcome;
  if (score) query.score = score;
  const calls = await db.collection('calls').find(query, { projection: { _id: 0 } }).sort({ call_date: -1 }).skip(Number(skip)).limit(Number(limit)).toArray();
  const total = await db.collection('calls').countDocuments(query);
  res.json({ calls, total });
}));

app.post('/api/calls', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const ts = now();
  const doc = { ...req.body, id: uuid(), call_date: ts, created_at: ts };
  await db.collection('calls').insertOne(doc);
  delete doc._id;
  res.json(doc);
}));

app.put('/api/calls/:call_id', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const result = await db.collection('calls').updateOne({ id: req.params.call_id }, { $set: req.body });
  if (result.matchedCount === 0) return res.status(404).json({ detail: 'Call not found' });
  const call = await db.collection('calls').findOne({ id: req.params.call_id }, { projection: { _id: 0 } });
  res.json(call);
}));

// ==================== OUTREACH ====================
app.get('/api/outreach/instagram', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const { skip = 0, limit = 50 } = req.query;
  const records = await db.collection('outreach_instagram').find({}, { projection: { _id: 0 } }).sort({ created_at: -1 }).skip(Number(skip)).limit(Number(limit)).toArray();
  const total = await db.collection('outreach_instagram').countDocuments();
  res.json({ records, total });
}));

app.post('/api/outreach/instagram', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const ts = now();
  const doc = { ...req.body, id: uuid(), date_contacted: ts, created_at: ts, updated_at: ts, timeline: [{ action: 'created', date: ts, details: 'Outreach record created' }] };
  await db.collection('outreach_instagram').insertOne(doc);
  delete doc._id;
  res.json(doc);
}));

app.get('/api/outreach/facebook-groups', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const { skip = 0, limit = 50 } = req.query;
  const records = await db.collection('outreach_facebook_groups').find({}, { projection: { _id: 0 } }).sort({ created_at: -1 }).skip(Number(skip)).limit(Number(limit)).toArray();
  const total = await db.collection('outreach_facebook_groups').countDocuments();
  res.json({ records, total });
}));

app.post('/api/outreach/facebook-groups', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const ts = now();
  const doc = { ...req.body, id: uuid(), created_at: ts, updated_at: ts, timeline: [{ action: 'created', date: ts, details: 'Facebook group outreach record created' }] };
  await db.collection('outreach_facebook_groups').insertOne(doc);
  delete doc._id;
  res.json(doc);
}));

// ==================== TEMPLATES ====================
app.get('/api/templates', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const { category, platform } = req.query;
  const query = {};
  if (category) query.category = category;
  if (platform) query.platform = platform;
  const templates = await db.collection('message_templates').find(query, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
  res.json({ templates });
}));

app.post('/api/templates', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const ts = now();
  const doc = { ...req.body, id: uuid(), created_at: ts, updated_at: ts };
  await db.collection('message_templates').insertOne(doc);
  delete doc._id;
  res.json(doc);
}));

app.put('/api/templates/:template_id', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const upd = { ...req.body, updated_at: now() };
  const result = await db.collection('message_templates').updateOne({ id: req.params.template_id }, { $set: upd });
  if (result.matchedCount === 0) return res.status(404).json({ detail: 'Template not found' });
  const t = await db.collection('message_templates').findOne({ id: req.params.template_id }, { projection: { _id: 0 } });
  res.json(t);
}));

app.delete('/api/templates/:template_id', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const result = await db.collection('message_templates').deleteOne({ id: req.params.template_id });
  if (result.deletedCount === 0) return res.status(404).json({ detail: 'Template not found' });
  res.json({ message: 'Template deleted' });
}));

// ==================== AUTOMATIONS ====================
app.get('/api/automations', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const automations = await db.collection('automations').find({}, { projection: { _id: 0 } }).toArray();
  res.json({ automations });
}));

app.put('/api/automations/:automation_id', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const result = await db.collection('automations').updateOne({ id: req.params.automation_id }, { $set: req.body });
  if (result.matchedCount === 0) return res.status(404).json({ detail: 'Automation not found' });
  const a = await db.collection('automations').findOne({ id: req.params.automation_id }, { projection: { _id: 0 } });
  res.json(a);
}));

// ==================== DASHBOARD ====================
app.get('/api/dashboard/metrics', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString();
  const tomorrowIso = new Date(today.getTime() + 86400000).toISOString();
  const [leadData] = await db.collection('leads').aggregate([{ $facet: { total: [{ $count: 'count' }], new_today: [{ $match: { created_at: { $gte: todayIso } } }, { $count: 'count' }], by_status: [{ $group: { _id: '$status', count: { $sum: 1 } } }], by_platform: [{ $group: { _id: '$source_platform', count: { $sum: 1 } } }] } }]).toArray();
  const totalLeads = leadData?.total?.[0]?.count || 0;
  const newLeadsToday = leadData?.new_today?.[0]?.count || 0;
  const statusCounts = {};
  ['New Lead', 'Contacted', 'Replied', 'Interested', 'Qualified', 'Booked', 'No Response', 'Not Interested', 'Closed Won', 'Closed Lost'].forEach(s => statusCounts[s] = 0);
  (leadData?.by_status || []).forEach(({ _id, count }) => { if (_id in statusCounts) statusCounts[_id] = count; });
  const platformCounts = {};
  (leadData?.by_platform || []).forEach(({ _id, count }) => platformCounts[_id] = count);
  const [callData] = await db.collection('calls').aggregate([{ $facet: { total: [{ $count: 'count' }], qualified: [{ $match: { qualified: true } }, { $count: 'count' }], booked: [{ $match: { booked: true } }, { $count: 'count' }] } }]).toArray();
  const totalCalls = callData?.total?.[0]?.count || 0;
  const qualifiedCalls = callData?.qualified?.[0]?.count || 0;
  const bookedCalls = callData?.booked?.[0]?.count || 0;
  const overdueTasks = await db.collection('tasks').countDocuments({ due_date: { $lt: todayIso }, completed: false });
  const tasksDueToday = await db.collection('tasks').countDocuments({ due_date: { $gte: todayIso, $lt: tomorrowIso }, completed: false });
  const [bookingData] = await db.collection('bookings').aggregate([{ $facet: { scheduled: [{ $match: { meeting_status: 'scheduled' } }, { $count: 'count' }], completed: [{ $match: { meeting_status: 'completed' } }, { $count: 'count' }] } }]).toArray();
  const scheduledBookings = bookingData?.scheduled?.[0]?.count || 0;
  const completedBookings = bookingData?.completed?.[0]?.count || 0;
  const contacted = statusCounts['Contacted'] + statusCounts['Replied'] + statusCounts['Interested'] + statusCounts['Qualified'] + statusCounts['Booked'] + statusCounts['Closed Won'];
  const replied = statusCounts['Replied'] + statusCounts['Interested'] + statusCounts['Qualified'] + statusCounts['Booked'] + statusCounts['Closed Won'];
  const interested = statusCounts['Interested'] + statusCounts['Qualified'] + statusCounts['Booked'] + statusCounts['Closed Won'];
  const booked = statusCounts['Booked'] + statusCounts['Closed Won'];
  const closedWon = statusCounts['Closed Won'];
  res.json({ leads: { total: totalLeads, new_today: newLeadsToday, contacted, replied, interested, qualified: statusCounts['Qualified'], booked, closed_won: closedWon, closed_lost: statusCounts['Closed Lost'], no_response: statusCounts['No Response'] }, status_counts: statusCounts, platform_breakdown: { instagram: platformCounts['Instagram'] || 0, facebook_groups: platformCounts['Facebook Groups'] || 0 }, calls: { total: totalCalls, qualified: qualifiedCalls, booked: bookedCalls }, tasks: { overdue: overdueTasks, due_today: tasksDueToday }, bookings: { scheduled: scheduledBookings, completed: completedBookings }, conversion_rates: { contacted_to_replied: contacted > 0 ? Math.round(replied / contacted * 1000) / 10 : 0, replied_to_interested: replied > 0 ? Math.round(interested / replied * 1000) / 10 : 0, interested_to_booked: interested > 0 ? Math.round(booked / interested * 1000) / 10 : 0, booked_to_closed: booked > 0 ? Math.round(closedWon / booked * 1000) / 10 : 0 } });
}));

// ==================== SETTINGS ====================
app.get('/api/settings/statuses', asyncHandler(async (req, res) => {
  const db = await getDb();
  await getCurrentUser(req);
  const settings = await db.collection('settings').findOne({ type: 'lead_statuses' }, { projection: { _id: 0 } });
  if (!settings) return res.json({ statuses: ['New Lead', 'Contacted', 'Replied', 'Interested', 'Qualified', 'Booked', 'No Response', 'Not Interested', 'Closed Won', 'Closed Lost'] });
  res.json(settings);
}));

app.put('/api/settings/statuses', asyncHandler(async (req, res) => {
  const db = await getDb();
  const user = await getCurrentUser(req);
  if (user.role !== 'admin') return res.status(403).json({ detail: 'Admin access required' });
  await db.collection('settings').updateOne({ type: 'lead_statuses' }, { $set: { statuses: req.body.statuses || [], updated_at: now() } }, { upsert: true });
  res.json({ message: 'Statuses updated', statuses: req.body.statuses || [] });
}));

// ==================== USERS ====================
app.get('/api/users', asyncHandler(async (req, res) => {
  const db = await getDb();
  const user = await getCurrentUser(req);
  if (user.role !== 'admin') return res.status(403).json({ detail: 'Admin access required' });
  const users = await db.collection('users').find({}, { projection: { _id: 0, password_hash: 0 } }).toArray();
  users.forEach(u => { if (!u.id) u.id = u.email; });
  res.json({ users });
}));

// ==================== API KEYS ====================
app.post('/api/api-keys', asyncHandler(async (req, res) => {
  const db = await getDb();
  const user = await getCurrentUser(req);
  if (user.role !== 'admin') return res.status(403).json({ detail: 'Admin access required' });
  const apiKey = `vp_${crypto.randomBytes(32).toString('base64url')}`;
  const doc = { id: uuid(), key: apiKey, name: req.body.name, created_by: user._id, is_active: true, permissions: req.body.permissions || ['leads:write', 'tasks:write', 'bookings:write', 'calls:write'], created_at: now(), last_used_at: null };
  await db.collection('api_keys').insertOne(doc);
  res.json({ id: doc.id, name: doc.name, key: apiKey, permissions: doc.permissions, message: "Save this key securely - it won't be shown again!" });
}));

app.get('/api/api-keys', asyncHandler(async (req, res) => {
  const db = await getDb();
  const user = await getCurrentUser(req);
  if (user.role !== 'admin') return res.status(403).json({ detail: 'Admin access required' });
  const keys = await db.collection('api_keys').find({}, { projection: { _id: 0 } }).toArray();
  keys.forEach(k => { if (k.key) { k.key_preview = k.key.slice(0, 7) + '...' + k.key.slice(-4); delete k.key; } });
  res.json({ api_keys: keys });
}));

app.delete('/api/api-keys/:key_id', asyncHandler(async (req, res) => {
  const db = await getDb();
  const user = await getCurrentUser(req);
  if (user.role !== 'admin') return res.status(403).json({ detail: 'Admin access required' });
  const result = await db.collection('api_keys').updateOne({ id: req.params.key_id }, { $set: { is_active: false, revoked_at: now() } });
  if (result.matchedCount === 0) return res.status(404).json({ detail: 'API key not found' });
  res.json({ message: 'API key revoked', id: req.params.key_id });
}));

// ==================== INTEGRATION LOGS ====================
app.get('/api/integration-logs', asyncHandler(async (req, res) => {
  const db = await getDb();
  const user = await getCurrentUser(req);
  if (user.role !== 'admin') return res.status(403).json({ detail: 'Admin access required' });
  const limit = Number(req.query.limit) || 100;
  const logs = await db.collection('integration_logs').find({}, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(limit).toArray();
  res.json({ logs });
}));

// ==================== EXTERNAL ROUTES (legacy API key system) ====================
app.patch('/api/external/leads/update', asyncHandler(async (req, res) => {
  const db = await getDb();
  const apiKey = await validateApiKey(req, 'leads:write').catch(e => null);
  if (!apiKey) return res.status(401).json({ detail: 'Invalid API key' });
  const data = req.body || {};
  let lead = null;
  if (data.lead_id) lead = await db.collection('leads').findOne({ id: data.lead_id });
  if (!lead && data.phone) {
    const norm = normalizePhone(data.phone);
    const leads = await db.collection('leads').find({ phone: { $exists: true, $ne: null } }).toArray();
    lead = leads.find(l => normalizePhone(l.phone || '') === norm) || null;
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
  await db.collection('leads').updateOne({ id: lead.id }, { $set: upd });
  await logIntegrationCall(db, '/api/external/leads/update', apiKey.name, true, 200, `Lead updated: ${lead.company_name}`, data);
  res.json({ success: true, lead_id: lead.id, updated_fields: updatedFields });
}));

app.post('/api/external/leads/intake', asyncHandler(async (req, res) => {
  const db = await getDb();
  const apiKey = await validateApiKey(req, 'leads:write').catch(e => null);
  if (!apiKey) return res.status(401).json({ detail: 'Invalid API key' });
  // Delegate to same logic as simple endpoint
  req.headers['x-api-key'] = process.env.VILLAPEL_API_KEY;
  // Re-use intake logic
  const data = req.body || {};
  const companyName = cleanStr(data.company_name);
  if (!companyName) return res.status(400).json({ success: false, error: 'company_name is required' });
  const phone = cleanStr(data.phone); const instagram = cleanStr(data.instagram_handle); const facebook = cleanStr(data.facebook_page);
  const { existingLead, matchedOn } = await findLeadByIdentifiers(db, phone, instagram, facebook);
  const ts = now();
  if (existingLead) {
    await db.collection('leads').updateOne({ id: existingLead.id }, { $set: { updated_at: ts, last_contact_date: ts } });
    await logIntegrationCall(db, '/api/external/leads/intake', apiKey.name, true, 200, `Lead updated: ${existingLead.company_name}`, data);
    return res.json({ success: true, action: 'updated', lead_id: existingLead.id, matched_on: matchedOn });
  } else {
    const leadId = uuid();
    const PLATFORM_MAP = { instagram: 'Instagram', facebook_group: 'Facebook Groups', facebook_dm: 'Facebook Groups', phone: 'Phone', website: 'Website', referral: 'Referral' };
    const channel = cleanStr(data.channel) || 'instagram'; const source = cleanStr(data.source) || 'clawbot';
    const doc = { id: leadId, company_name: companyName, contact_name: cleanStr(data.contact_name), phone, email: cleanStr(data.email), city: cleanStr(data.location_city), state: cleanStr(data.location_state), website: cleanStr(data.website), instagram_handle: instagram, facebook_page: facebook, source_platform: PLATFORM_MAP[channel] || 'Other', source_detail: `via ${source}`, status: 'New Lead', priority: 'medium', notes: null, notes_history: [], tags: data.tags || [], first_contact_date: data.detected_at || ts, last_contact_date: ts, next_action_date: null, assigned_to: 'Admin', created_at: ts, updated_at: ts };
    await db.collection('leads').insertOne(doc);
    await logIntegrationCall(db, '/api/external/leads/intake', apiKey.name, true, 201, `Lead created: ${companyName}`, data);
    return res.status(201).json({ success: true, action: 'created', lead_id: leadId });
  }
}));

app.post('/api/external/tasks/create', asyncHandler(async (req, res) => {
  const db = await getDb();
  const apiKey = await validateApiKey(req, 'tasks:write').catch(e => null);
  if (!apiKey) return res.status(401).json({ detail: 'Invalid API key' });
  const data = req.body || {};
  const lead = await db.collection('leads').findOne({ id: data.lead_id });
  if (!lead) { await logIntegrationCall(db, '/api/external/tasks/create', apiKey.name, false, 400, `Lead not found: ${data.lead_id}`, data); return res.status(400).json({ success: false, error: `Lead not found: ${data.lead_id}` }); }
  const ts = now();
  const taskDoc = { id: uuid(), lead_id: data.lead_id, task_type: data.task_type, title: data.title, description: data.description, due_date: data.due_date || new Date(Date.now() + 86400000).toISOString(), assigned_to: data.assigned_to || 'Admin', priority: data.priority || 'medium', channel: data.channel, auto_generated: data.auto_generated !== false, completed: false, created_by: `API: ${apiKey.name}`, created_at: ts, updated_at: ts };
  await db.collection('tasks').insertOne(taskDoc);
  await logIntegrationCall(db, '/api/external/tasks/create', apiKey.name, true, 201, `Task created: ${data.title}`, data);
  res.status(201).json({ success: true, task_id: taskDoc.id, lead_id: data.lead_id });
}));

app.post('/api/external/bookings/create-or-update', asyncHandler(async (req, res) => {
  const db = await getDb();
  const apiKey = await validateApiKey(req, 'bookings:write').catch(e => null);
  if (!apiKey) return res.status(401).json({ detail: 'Invalid API key' });
  const data = req.body || {};
  const lead = await db.collection('leads').findOne({ id: data.lead_id });
  if (!lead) return res.status(400).json({ success: false, error: `Lead not found: ${data.lead_id}` });
  const ts = now();
  const existing = await db.collection('bookings').findOne({ lead_id: data.lead_id, booking_date: data.booking_date });
  let bookingId, action;
  if (existing) {
    await db.collection('bookings').updateOne({ id: existing.id }, { $set: { meeting_status: data.status, updated_at: ts } });
    bookingId = existing.id; action = 'updated';
  } else {
    bookingId = uuid();
    await db.collection('bookings').insertOne({ id: bookingId, lead_id: data.lead_id, booking_date: data.booking_date, booking_source: data.booking_source, source: data.booking_source, booking_type: data.booking_type || 'demo', meeting_status: data.status || 'scheduled', calcom_event_id: data.calcom_event_id, meeting_url: data.meeting_url, notes: data.notes, outcome: null, created_at: ts, updated_at: ts });
    action = 'created';
  }
  if (data.status !== 'cancelled') await db.collection('leads').updateOne({ id: data.lead_id }, { $set: { status: 'Booked', updated_at: ts } });
  await logIntegrationCall(db, '/api/external/bookings/create-or-update', apiKey.name, true, 201, `Booking ${action}`, data);
  res.status(201).json({ success: true, action, booking_id: bookingId, lead_id: data.lead_id });
}));

app.post('/api/external/calls/log', asyncHandler(async (req, res) => {
  const db = await getDb();
  const apiKey = await validateApiKey(req, 'calls:write').catch(e => null);
  if (!apiKey) return res.status(401).json({ detail: 'Invalid API key' });
  const data = req.body || {};
  const ts = now();
  const normPhone = normalizePhone(data.phone);
  const allLeads = await db.collection('leads').find({ phone: { $exists: true, $ne: null } }).toArray();
  const matchedLead = allLeads.find(l => normalizePhone(l.phone || '') === normPhone) || null;
  const callDoc = { id: uuid(), lead_id: matchedLead?.id || null, caller_phone: data.phone, company_name: matchedLead?.company_name || null, direction: data.direction, call_date: data.call_date, duration_seconds: data.duration_seconds || 0, outcome: data.booked ? 'booked' : data.qualified ? 'qualified' : 'answered', qualified: data.qualified || false, booked: data.booked || false, transcript_summary: data.transcript_summary, recording_url: data.recording_url, retell_call_id: data.retell_call_id, notes: data.notes, score: data.booked ? 'good' : 'average', created_at: ts };
  await db.collection('calls').insertOne(callDoc);
  if (matchedLead) {
    const leadUpd = { last_contact_date: ts, updated_at: ts };
    if (data.booked) leadUpd.status = 'Booked';
    else if (data.qualified && !['Booked', 'Closed Won'].includes(matchedLead.status)) leadUpd.status = 'Qualified';
    await db.collection('leads').updateOne({ id: matchedLead.id }, { $set: leadUpd });
  }
  await logIntegrationCall(db, '/api/external/calls/log', apiKey.name, true, 201, `Call logged: ${data.phone}`, data);
  res.status(201).json({ success: true, call_id: callDoc.id, matched_lead_id: matchedLead?.id || null });
}));

// ==================== ERROR HANDLER ====================
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({ detail: err.message || 'Internal server error' });
});

module.exports.handler = serverless(app);
