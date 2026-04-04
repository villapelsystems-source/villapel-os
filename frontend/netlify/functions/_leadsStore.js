const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/** Writable on Netlify; survives warm invocations, not guaranteed across cold starts. */
const DATA_FILE = path.join(os.tmpdir(), 'villapel-os-json-leads.json');
const SEED_FILE = path.join(__dirname, '..', '..', 'data', 'leads.json');

async function readLeads() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    try {
      const seedRaw = await fs.readFile(SEED_FILE, 'utf8');
      const initial = JSON.parse(seedRaw);
      if (Array.isArray(initial) && initial.length > 0) {
        await writeLeads(initial);
        return initial;
      }
    } catch (_) {
      /* seed file missing in serverless bundle is normal */
    }
    return [];
  }
}

async function writeLeads(leads) {
  await fs.writeFile(DATA_FILE, JSON.stringify(leads, null, 2), 'utf8');
}

async function appendLead(lead) {
  const leads = await readLeads();
  leads.push(lead);
  await writeLeads(leads);
  return lead;
}

module.exports = { readLeads, writeLeads, appendLead, DATA_FILE };
