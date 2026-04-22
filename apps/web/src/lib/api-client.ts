const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function getHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-api-key": process.env.API_SECRET ?? "dev-secret",
  };
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...getHeaders(), ...options?.headers },
  });

  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error ?? "Request failed");
  }
  return json.data;
}

// Sessions
export const api = {
  sessions: {
    list: () => request<unknown[]>(`/api/sessions`),
    create: (name: string, config?: Record<string, unknown>) =>
      request<unknown>(`/api/sessions`, { method: "POST", body: JSON.stringify({ name, config }) }),
    get: (id: string) => request<unknown>(`/api/sessions/${id}`),
    delete: (id: string) => request<void>(`/api/sessions/${id}`, { method: "DELETE" }),
    checkpoint: (id: string, phase: string, activeTask: string) =>
      request<unknown>(`/api/sessions/${id}/checkpoint`, {
        method: "POST",
        body: JSON.stringify({ phase, activeTask }),
      }),
  },
  agents: {
    list: () => request<unknown[]>(`/api/agents`),
    get: (id: string) => request<unknown>(`/api/agents/${id}`),
    spawn: (sessionId: string, agent: string, context?: string) =>
      request<unknown>(`/api/agents/spawn`, {
        method: "POST",
        body: JSON.stringify({ sessionId, agent, context }),
      }),
  },
  skills: {
    list: () => request<unknown[]>(`/api/skills`),
    get: (id: string) => request<unknown>(`/api/skills/${id}`),
    invoke: (sessionId: string, skillId: string, args?: Record<string, string>, reviewMode?: string) =>
      request<{ status: string; phases: number; teamMembers: string[]; reviewMode: string }>(
        `/api/skills/${skillId}/invoke`,
        { method: "POST", body: JSON.stringify({ sessionId, args, reviewMode }) },
      ),
  },
  teams: {
    list: () => request<unknown[]>(`/api/teams`),
    run: (sessionId: string, team: string, input?: string, reviewMode?: string) =>
      request<{ status: string; members: string[]; workflow: unknown[]; reviewMode: string }>(
        `/api/teams/${team}/run`,
        { method: "POST", body: JSON.stringify({ sessionId, input, reviewMode }) },
      ),
  },
  gates: {
    list: (sessionId: string) => request<unknown[]>(`/api/gates?sessionId=${sessionId}`),
    run: (sessionId: string, gateId: string, targetPhase?: string, reviewMode?: string) =>
      request<unknown>(`/api/gates/${gateId}/run`, {
        method: "POST",
        body: JSON.stringify({ sessionId, targetPhase, reviewMode }),
      }),
  },
  design: {
    gdds: {
      list: () => request<unknown[]>(`/api/design/gdds`),
      create: (name: string, category?: string) =>
        request<unknown>(`/api/design/gdds`, { method: "POST", body: JSON.stringify({ name, category }) }),
    },
    adrs: {
      list: () => request<unknown[]>(`/api/design/adrs`),
      create: (title: string) =>
        request<unknown>(`/api/design/adrs`, { method: "POST", body: JSON.stringify({ title }) }),
    },
  },
};
