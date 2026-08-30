class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Keine Verbindung zum Server.');
  }

  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(res.status, 'Unerwartete Antwort vom Server.');
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Fehler ${res.status}`);
  return data;
}

const qs = (params) => {
  const usable = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return usable.length ? `?${new URLSearchParams(usable)}` : '';
};

export const api = {
  users: () => request('GET', '/api/users'),
  createUser: (body) => request('POST', '/api/users', body),
  updateUser: (id, body) => request('PATCH', `/api/users/${id}`, body),

  weights: (userId) => request('GET', `/api/users/${userId}/weights`),
  addWeight: (userId, body) => request('POST', `/api/users/${userId}/weights`, body),
  deleteWeight: (userId, date) => request('DELETE', `/api/users/${userId}/weights/${date}`),

  products: (params = {}) => request('GET', `/api/products${qs(params)}`),
  createProduct: (body) => request('POST', '/api/products', body),
  updateProduct: (id, body) => request('PATCH', `/api/products/${id}`, body),
  deleteProduct: (id) => request('DELETE', `/api/products/${id}`),

  lookupBarcode: (barcode) => request('GET', `/api/off/${barcode}`),

  templates: () => request('GET', '/api/templates'),
  createTemplate: (body) => request('POST', '/api/templates', body),
  updateTemplate: (id, body) => request('PATCH', `/api/templates/${id}`, body),
  deleteTemplate: (id) => request('DELETE', `/api/templates/${id}`),
  logTemplate: (id, body) => request('POST', `/api/templates/${id}/log`, body),

  workouts: (params) => request('GET', `/api/workouts${qs(params)}`),
  toggleWorkout: (body) => request('PUT', '/api/workouts/toggle', body),
  saveWorkout: (body) => request('POST', '/api/workouts', body),

  addEntry: (body) => request('POST', '/api/log', body),
  updateEntry: (id, body) => request('PATCH', `/api/log/${id}`, body),
  deleteEntry: (id) => request('DELETE', `/api/log/${id}`),

  day: (params) => request('GET', `/api/day${qs(params)}`),
  history: (params) => request('GET', `/api/history${qs(params)}`),
};

export { ApiError };
