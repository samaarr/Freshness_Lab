const BASE = import.meta.env.VITE_API_URL || '';

async function j(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || res.statusText);
  return res.json();
}

export const api = {
  services: () => j('GET', '/api/services'),
  mode: () => j('GET', '/api/mode'),
  setMode: (mode) => j('POST', '/api/mode', { mode }),
  patchService: (name, patch) => j('PATCH', `/api/services/${name}`, patch),
  rebuild: () => j('POST', '/api/rebuild'),
  ask: (question) => j('POST', '/api/ask', { question }),
  benchResults: () => j('GET', '/api/benchmark/results'),
  benchRun: (scenario) => j('POST', '/api/benchmark/run', { scenario }),
  events: () => new EventSource(`${BASE}/api/events`),
};
