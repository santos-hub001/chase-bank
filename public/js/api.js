// CHASE BANK — API helper (handles JSON + cookies)
async function api(path, options = {}, method) {
  const opts = {
    method: method || options.method || 'GET',
    headers: { 'Content-Type': 'application/json' }
  };
  if (opts.method !== 'GET' && options.body) opts.body = JSON.stringify(options.body);
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) throw new Error(data?.error || 'Something went wrong');
  return data;
}

const API = {
  me: () => api('/api/auth/me'),
  sendOtp: (body) => api('/api/auth/send-otp', { method: 'POST', body }),
  verifyOtp: (body) => api('/api/auth/verify-otp', { method: 'POST', body }),
  register: (body) => api('/api/auth/register', { method: 'POST', body }),
  login: (body) => api('/api/auth/login', { method: 'POST', body }),
  logout: () => api('/api/auth/logout', { method: 'POST' }),
  account: () => api('/api/account'),
  transactions: () => api('/api/transactions'),
  transfer: (body) => api('/api/transfer', { method: 'POST', body }),
  withdraw: (body) => api('/api/withdraw', { method: 'POST', body }),
  accounts: () => api('/api/accounts'),
  openAccount: (body) => api('/api/accounts', { method: 'POST', body }),
  moveMoney: (body) => api('/api/accounts/move', { method: 'POST', body }),
  setAvatar: (body) => api('/api/profile/avatar', { method: 'POST', body }),
  notifications: () => api('/api/notifications'),
  readAllNotifications: () => api('/api/notifications/readall', { method: 'PUT' }),
  customerCare: (body) => api('/api/customer-care', { method: 'POST', body }),
  recipient: (account) => api('/api/pay/recipient?account=' + encodeURIComponent(account))
};