import axios from 'axios';

const api = axios.create({ baseURL: '/api', timeout: 30000 });

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
  register: (data: object) => api.post('/auth/register', data),
  login: (data: object) => api.post('/auth/login', data),
  verifyEmail: (token: string) => api.get(`/auth/verify/${token}`),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),
  resetPassword: (data: object) => api.post('/auth/reset-password', data),
  getProfile: () => api.get('/auth/me'),
  listUsers: () => api.get('/auth/users'),
  updateUserRole: (userId: string, role: string) => api.put(`/auth/users/${userId}/role`, { role }),
};

export const readingsApi = {
  getLatest: (params?: object) => api.get('/readings/latest', { params }),
  getEnergyHistory: (params?: object) => api.get('/readings/energy/history', { params }),
  getDieselHistory: (params?: object) => api.get('/readings/diesel/history', { params }),
  getGeneratorEvents: (params?: object) => api.get('/readings/generator/events', { params }),
  getDailySummary: (params?: object) => api.get('/readings/summary/daily', { params }),
  getMonthlySummary: (params?: object) => api.get('/readings/summary/monthly', { params }),
  getYearlySummary: (params?: object) => api.get('/readings/summary/yearly', { params }),
  getPowerInterruptions: (params?: object) => api.get('/readings/power-interruptions', { params }),
  getDashboardStats: (params?: object) => api.get('/readings/dashboard-stats', { params }),
};

export const alertsApi = {
  getAll: (params?: object) => api.get('/alerts', { params }),
  getActive: (params?: object) => api.get('/alerts/active', { params }),
  getStats: (params?: object) => api.get('/alerts/stats', { params }),
  acknowledge: (id: number) => api.put(`/alerts/${id}/acknowledge`),
  acknowledgeAll: () => api.put('/alerts/acknowledge-all'),
  getSetpoints: () => api.get('/alerts/setpoints'),
  updateSetpoint: (type: string, data: object) => api.put(`/alerts/setpoints/${type}`, data),
};

export const reportsApi = {
  generate: (data: object) => api.post('/reports/generate', data, { responseType: 'blob' }),
  getHistory: () => api.get('/reports/history'),
};

export const settingsApi = {
  getPlants: () => api.get('/settings/plants'),
  createPlant: (data: object) => api.post('/settings/plants', data),
  updatePlant: (id: string, data: object) => api.put(`/settings/plants/${id}`, data),
  deletePlant: (id: string) => api.delete(`/settings/plants/${id}`),
  getEnergyMeters: () => api.get('/settings/energy-meters'),
  createEnergyMeter: (data: object) => api.post('/settings/energy-meters', data),
  updateEnergyMeter: (id: string, data: object) => api.put(`/settings/energy-meters/${id}`, data),
  getFlowMeters: () => api.get('/settings/flow-meters'),
  createFlowMeter: (data: object) => api.post('/settings/flow-meters', data),
  updateFlowMeter: (id: string, data: object) => api.put(`/settings/flow-meters/${id}`, data),
  getGenerators: () => api.get('/settings/generators'),
  createGenerator: (data: object) => api.post('/settings/generators', data),
  updateGenerator: (id: string, data: object) => api.put(`/settings/generators/${id}`, data),
};

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default api;
