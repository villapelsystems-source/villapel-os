/** DB stores English status strings; map to i18n keys for display */
export const LEAD_STATUS_I18N_KEY = {
  'New Lead': 'crm.status.newLead',
  Contacted: 'crm.status.contacted',
  Replied: 'crm.status.replied',
  Interested: 'crm.status.interested',
  Qualified: 'crm.status.qualified',
  Booked: 'crm.status.booked',
  'No Response': 'crm.status.noResponse',
  'Not Interested': 'crm.status.notInterested',
  'Closed Won': 'crm.status.closedWon',
  'Closed Lost': 'crm.status.closedLost',
};

export function leadStatusLabel(t, status) {
  const k = LEAD_STATUS_I18N_KEY[status];
  return k ? t(k) : status || '—';
}
