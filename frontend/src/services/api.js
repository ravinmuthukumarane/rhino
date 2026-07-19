import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const authApi = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  verifyEmail: (token) => api.get(`/auth/verify/${token}`),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword: (data) => api.post('/auth/reset-password', data),
  getProfile: () => api.get('/auth/me'),
  listUsers: () => api.get('/auth/users'),
  updateUserRole: (userId, role) => api.put(`/auth/users/${userId}/role`, { role }),
};

export const readingsApi = {
  getLatest: () => api.get('/readings/latest'),
  getEnergyHistory: (params) => api.get('/readings/energy/history', { params }),
  getDieselHistory: (params) => api.get('/readings/diesel/history', { params }),
  getGeneratorEvents: (params) => api.get('/readings/generator/events', { params }),
  getDailySummary: (params) => api.get('/readings/summary/daily', { params }),
  getMonthlySummary: (params) => api.get('/readings/summary/monthly', { params }),
  getYearlySummary: () => api.get('/readings/summary/yearly'),
  getPowerInterruptions: (params) => api.get('/readings/power-interruptions', { params }),
};

export const alertsApi = {
  getAll: (params) => api.get('/alerts', { params }),
  getActive: () => api.get('/alerts/active'),
  getStats: () => api.get('/alerts/stats'),
  acknowledge: (id) => api.put(`/alerts/${id}/acknowledge`),
  acknowledgeAll: () => api.put('/alerts/acknowledge-all'),
  getSetpoints: () => api.get('/alerts/setpoints'),
  updateSetpoint: (type, data) => api.put(`/alerts/setpoints/${type}`, data),
};

export const reportsApi = {
  getDashboardStats: () => api.get('/reports/dashboard-stats'),
  generate: (data) => api.post('/reports/generate', data, { responseType: 'blob' }),
  getHistory: () => api.get('/reports/history'),
};

export default api;
