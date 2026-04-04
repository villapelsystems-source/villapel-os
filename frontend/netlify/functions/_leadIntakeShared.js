/**
 * Shared lead intake logic: same collection (`leads`), schema, and dedup as POST /api/leads/intake.
 */
const crypto = require('crypto');
const { getDb } = require('./_firestore');

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const nowStamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

function cleanStr(val) {
  if (val == null) return null;
  val = String(val).trim();
  return val || null;
}

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

function addActivity(leadId, action, details = null) {
  return { id: uuid(), action, details, timestamp: now() };
}

async function findLeadByIdentifiers(phone, instagram, facebook) {
  const db = getDb();
  const snap = await db.collection('leads').get();
  const leads = snap.docs.map((d) => d.data());
  let existingLead = null;
  let matchedOn = null;
  if (phone) {
    const normPhone = normalizePhone(phone);
    existingLead = leads.find((l) => l.phone && normalizePhone(l.phone) === normPhone) || null;
    if (existingLead) matchedOn = 'phone';
  }
  if (!existingLead && instagram) {
    const normIg = normalizeInstagram(instagram);
    existingLead = leads.find((l) => l.instagram_handle && normalizeInstagram(l.instagram_handle) === normIg) || null;
    if (existingLead) matchedOn = 'instagram_handle';
  }
  if (!existingLead && facebook) {
    const normFb = normalizeFacebook(facebook);
    existingLead = leads.find((l) => l.facebook_page && normalizeFacebook(l.facebook_page) === normFb) || null;
    if (existingLead) matchedOn = 'facebook_page';
  }
  return { existingLead, matchedOn };
}

/**
 * @param {object} data - raw body (same fields as /api/leads/intake)
 * @returns {{ statusCode: number, json: object }}
 */
async function intakeLeadFromBody(data) {
  const db = getDb();
  const companyName = cleanStr(data.company_name);
  if (!companyName) {
    return { statusCode: 400, json: { success: false, error: 'company_name is required' } };
  }

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
    if (data.notes) {
      const ex = existingLead.notes || '';
      upd.notes = `${ex}\n[${nowStamp()}] ${data.notes}`.trim();
    }
    if (data.tags?.length) upd.tags = [...new Set([...(existingLead.tags || []), ...data.tags])];
    const activity = existingLead.activity || [];
    activity.push(addActivity(existingLead.id, 'updated_via_api', `Matched on ${matchedOn}`));
    upd.activity = activity;

    await db.collection('leads').doc(existingLead.id).update(upd);
    const refreshed = await db.collection('leads').doc(existingLead.id).get();
    return {
      statusCode: 200,
      json: {
        success: true,
        action: 'updated',
        lead_id: existingLead.id,
        matched_on: matchedOn,
        lead: refreshed.data(),
      },
    };
  }

  const PLATFORM_MAP = {
    instagram: 'Instagram',
    facebook_group: 'Facebook Groups',
    facebook_dm: 'Facebook Groups',
    phone: 'Phone',
    website: 'Website',
    referral: 'Referral',
  };
  const leadId = uuid();
  const notes = cleanStr(data.notes);
  const leadDoc = {
    id: leadId,
    company_name: companyName,
    contact_name: cleanStr(data.contact_name),
    phone,
    email: cleanStr(data.email),
    city: cleanStr(data.city || data.location_city),
    state: cleanStr(data.state || data.location_state),
    website: cleanStr(data.website),
    instagram_handle: instagram,
    facebook_page: facebook,
    source_platform: PLATFORM_MAP[channel] || 'Other',
    source_detail: `via ${source}`,
    status: 'New Lead',
    priority: 'medium',
    notes: notes ? `[${nowStamp()}] ${notes}` : null,
    notes_history: [],
    tags: data.tags || [],
    first_contact_date: ts,
    last_contact_date: ts,
    next_action_date: null,
    assigned_to: 'Admin',
    activity: [addActivity(leadId, 'created_via_api', `Source: ${source}, Channel: ${channel}`)],
    created_at: ts,
    updated_at: ts,
  };

  await db.collection('leads').doc(leadId).set(leadDoc);
  return {
    statusCode: 200,
    json: {
      success: true,
      action: 'created',
      lead_id: leadId,
      lead: leadDoc,
    },
  };
}

module.exports = { intakeLeadFromBody };
