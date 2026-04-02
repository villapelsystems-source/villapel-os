const API = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (res.status === 401 && !path.includes('/auth/')) {
    // Try refresh
    const refresh = await fetch(`${API}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (refresh.ok) {
      const retry = await fetch(`${API}${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
      });
      if (!retry.ok) throw new Error((await retry.json().catch(() => ({}))).detail || retry.statusText);
      return retry.json().catch(() => ({}));
    }
    window.location.href = '/login';
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || res.statusText);
  }
  return res.json().catch(() => ({}));
}

export const api = {
  // Auth
  login: (data) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),
  // Dashboard
  metrics: () => request('/api/dashboard/metrics'),
  // Leads
  getLeads: (params = '') => request(`/api/leads${params ? '?' + params : ''}`),
  getLead: (id) => request(`/api/leads/${id}`),
  createLead: (data) => request('/api/leads', { method: 'POST', body: JSON.stringify(data) }),
  updateLead: (id, data) => request(`/api/leads/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLead: (id) => request(`/api/leads/${id}`, { method: 'DELETE' }),
  addNote: (id, data) => request(`/api/leads/${id}/notes`, { method: 'POST', body: JSON.stringify(data) }),
  // Tasks
  getTasks: (params = '') => request(`/api/tasks${params ? '?' + params : ''}`),
  createTask: (data) => request('/api/tasks', { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (id, data) => request(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTask: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),
  // Bookings
  getBookings: (params = '') => request(`/api/bookings${params ? '?' + params : ''}`),
  createBooking: (data) => request('/api/bookings', { method: 'POST', body: JSON.stringify(data) }),
  updateBooking: (id, data) => request(`/api/bookings/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  // Calls
  getCalls: (params = '') => request(`/api/calls${params ? '?' + params : ''}`),
  createCall: (data) => request('/api/calls', { method: 'POST', body: JSON.stringify(data) }),
  // Outreach
  getInstagram: (params = '') => request(`/api/outreach/instagram${params ? '?' + params : ''}`),
  createInstagram: (data) => request('/api/outreach/instagram', { method: 'POST', body: JSON.stringify(data) }),
  getFacebookGroups: (params = '') => request(`/api/outreach/facebook-groups${params ? '?' + params : ''}`),
  createFacebookGroup: (data) => request('/api/outreach/facebook-groups', { method: 'POST', body: JSON.stringify(data) }),
  // Templates
  getTemplates: (params = '') => request(`/api/templates${params ? '?' + params : ''}`),
  createTemplate: (data) => request('/api/templates', { method: 'POST', body: JSON.stringify(data) }),
  deleteTemplate: (id) => request(`/api/templates/${id}`, { method: 'DELETE' }),
  // Automations
  getAutomations: () => request('/api/automations'),
  // API Keys
  getApiKeys: () => request('/api/api-keys'),
  createApiKey: (data) => request('/api/api-keys', { method: 'POST', body: JSON.stringify(data) }),
  revokeApiKey: (id) => request(`/api/api-keys/${id}`, { method: 'DELETE' }),
  // Integration Logs
  getIntegrationLogs: (limit = 100) => request(`/api/integration-logs?limit=${limit}`),
  // Settings
  getStatuses: () => request('/api/settings/statuses'),
  updateStatuses: (data) => request('/api/settings/statuses', { method: 'PUT', body: JSON.stringify(data) }),
  // Users
  getUsers: () => request('/api/users'),
};
