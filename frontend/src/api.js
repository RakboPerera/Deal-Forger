import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

// Inject API key from localStorage if available
api.interceptors.request.use(config => {
  const key = localStorage.getItem('anthropic_api_key');
  if (key) config.headers['x-api-key'] = key;
  return config;
});

// 429 retry — if we get rate-limited, wait briefly and retry once.
// This keeps the UI from going blank when the user clicks through pages
// faster than the per-minute limit allows.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config || {};
    if (error.response?.status === 429 && !config.__retryCount) {
      config.__retryCount = 1;
      await new Promise((r) => setTimeout(r, 1200));
      return api.request(config);
    }
    return Promise.reject(error);
  }
);

// === Deals ===
export const getDeals = (params) => api.get('/deals', { params }).then(r => r.data);
export const getDeal = (id) => api.get(`/deals/${id}`).then(r => r.data);
export const getDealFull = (id) => api.get(`/deals/${id}/full`).then(r => r.data);
export const getDealTimeline = (id) => api.get(`/deals/${id}/timeline`).then(r => r.data);
export const createDeal = (data) => api.post('/deals', data).then(r => r.data);
export const updateDeal = (id, data) => api.put(`/deals/${id}`, data).then(r => r.data);
export const deleteDeal = (id) => api.delete(`/deals/${id}`).then(r => r.data);

// === Financials ===
export const getFinancials = (params) => api.get('/financials', { params }).then(r => r.data);
export const updateFinancial = (id, data) => api.put(`/financials/${id}`, data).then(r => r.data);
export const createFinancial = (data) => api.post('/financials', data).then(r => r.data);
export const deleteFinancial = (id) => api.delete(`/financials/${id}`).then(r => r.data);

// === Comparables ===
export const getComparables = (params) => api.get('/comparables', { params }).then(r => r.data);
export const getComparableSectors = () => api.get('/comparables/sectors').then(r => r.data);
export const createComparable = (data) => api.post('/comparables', data).then(r => r.data);
export const updateComparable = (id, data) => api.put(`/comparables/${id}`, data).then(r => r.data);
export const deleteComparable = (id) => api.delete(`/comparables/${id}`).then(r => r.data);
export const importComparables = (data) => api.post('/comparables/import', data).then(r => r.data);

// === Transactions ===
export const getTransactions = (params) => api.get('/transactions', { params }).then(r => r.data);
export const createTransaction = (data) => api.post('/transactions', data).then(r => r.data);
export const updateTransaction = (id, data) => api.put(`/transactions/${id}`, data).then(r => r.data);
export const deleteTransaction = (id) => api.delete(`/transactions/${id}`).then(r => r.data);

// === Assumptions ===
export const getAssumptions = (params) => api.get('/assumptions', { params }).then(r => r.data);
export const updateAssumption = (id, data) => api.put(`/assumptions/${id}`, data).then(r => r.data);
export const createAssumption = (data) => api.post('/assumptions', data).then(r => r.data);

// === Outputs ===
export const getOutputs = (params) => api.get('/outputs', { params }).then(r => r.data);

// === Documents ===
export const getDocuments = (params) => api.get('/documents', { params }).then(r => r.data);
export const uploadDocuments = (dealId, formData) =>
  api.post(`/documents/upload/${dealId}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
export const deleteDocument = (id) => api.delete(`/documents/${id}`).then(r => r.data);

// === Extraction ===
export const startExtraction = (dealId) => api.post(`/extraction/start/${dealId}`).then(r => r.data);
export const getExtractionJob = (id) => api.get(`/extraction/${id}`).then(r => r.data);
export const getExtractionJobsForDeal = (dealId) =>
  api.get('/extraction', { params: { deal_id: dealId } }).then(r => r.data);
export const resumeExtraction = (id) => api.post(`/extraction/${id}/resume`).then(r => r.data);

// === Models ===
export const buildModel = (dealId) => api.post(`/models/build/${dealId}`).then(r => r.data);
export const recalculateModel = (dealId, assumptions) => api.post(`/models/recalculate/${dealId}`, { assumptions }).then(r => r.data);
export const getModelRuns = (params) => api.get('/models/runs', { params }).then(r => r.data);
export const getModelRun = (id) => api.get(`/models/runs/${id}`).then(r => r.data);
export const getModelJob = (jobId) => api.get(`/models/jobs/${jobId}`).then(r => r.data);

// === HITL ===
export const getReviews = (params) => api.get('/hitl', { params }).then(r => r.data);
export const getReview = (id) => api.get(`/hitl/${id}`).then(r => r.data);
export const createReview = (data) => api.post('/hitl', data).then(r => r.data);
export const updateReview = (id, data) => api.put(`/hitl/${id}`, data).then(r => r.data);

// === Chat ===
export const getConversations = () => api.get('/chat/conversations').then(r => r.data);
export const getConversation = (id) => api.get(`/chat/conversations/${id}`).then(r => r.data);
export const createConversation = (title) => api.post('/chat/conversations', { title }).then(r => r.data);
export const sendMessage = (convId, content) => api.post(`/chat/conversations/${convId}/messages`, { content }).then(r => r.data);
export const deleteConversation = (id) => api.delete(`/chat/conversations/${id}`).then(r => r.data);

// === Dashboard ===
export const getPipelineSummary = () => api.get('/dashboard/pipeline-summary').then(r => r.data);
export const getSectorDistribution = () => api.get('/dashboard/sector-distribution').then(r => r.data);
export const getValuationRanges = () => api.get('/dashboard/valuation-ranges').then(r => r.data);
export const getRecentActivity = (limit) => api.get('/dashboard/recent-activity', { params: { limit } }).then(r => r.data);
export const getValuationGap = () => api.get('/dashboard/valuation-gap').then(r => r.data);
export const getIrrRanking = () => api.get('/dashboard/irr-ranking').then(r => r.data);
export const getSectorMultiples = () => api.get('/dashboard/sector-multiples').then(r => r.data);
export const getGrowthMargin = () => api.get('/dashboard/growth-margin').then(r => r.data);
export const getInsights = () => api.get('/dashboard/insights').then(r => r.data);

// === Meta ===
export const getHealth = () => api.get('/meta/health').then(r => r.data);
export const getCounts = () => api.get('/meta/counts').then(r => r.data);
export const getSchemas = () => api.get('/meta/schemas').then(r => r.data);
export const resetDemo = () => api.post('/meta/reset-demo').then(r => r.data);

// === Settings ===
export const getSettings = () => api.get('/settings').then(r => r.data);
export const updateSettings = (data) => api.put('/settings', data).then(r => r.data);
export const validateApiKey = (provider, apiKey) => api.post('/settings/validate-key', { provider, apiKey }).then(r => r.data);

// === Investment Recommendations ===
export const getRecommendation = (dealId) =>
  api.get(`/deals/${dealId}/recommendation`).then(r => r.data);
export const getRecommendationHistory = (dealId) =>
  api.get(`/deals/${dealId}/recommendation/history`).then(r => r.data);
export const saveRecommendation = (dealId, data) =>
  api.put(`/deals/${dealId}/recommendation`, data).then(r => r.data);
export const draftRecommendationAI = (dealId) =>
  api.post(`/deals/${dealId}/recommendation/draft`).then(r => r.data);

// === Data Import ===
export const importData = (table, formData) =>
  api.post(`/import/${table}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
export const importDataJson = (table, rows) => api.post(`/import/${table}`, { rows }).then(r => r.data);
export const clearSampleData = (table) => api.delete(`/import/${table}/sample`).then(r => r.data);
export const downloadTemplate = (table) => `/api/import/${table}/template`;

export default api;
