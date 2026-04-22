"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

interface Agent {
  role: string;
  name: string;
  description: string;
  tier: number;
  model: string;
  tools: string[];
  skills?: string[];
  delegates?: string[];
  reportsTo?: string[];
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTier, setFilterTier] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [spawning, setSpawning] = useState(false);
  const [spawnResult, setSpawnResult] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = (await api.agents.list()) as Agent[];
        setAgents(data);
      } catch (err) {
        console.error("Failed to load agents:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSpawn() {
    if (!selectedAgent || !sessionId) return;
    setSpawning(true);
    setSpawnResult(null);
    try {
      const result = (await api.agents.spawn(sessionId, selectedAgent.role)) as { invocationId: string; status: string };
      setSpawnResult(`Spawned ${selectedAgent.role} (${result.invocationId.slice(0, 8)}) — ${result.status}`);
    } catch (err) {
      setSpawnResult(`Error: ${err}`);
    } finally {
      setSpawning(false);
    }
  }

  const filtered = agents.filter((a) => {
    const matchTier = filterTier === null || a.tier === filterTier;
    const matchSearch = !search || a.role.toLowerCase().includes(search.toLowerCase()) || a.description.toLowerCase().includes(search.toLowerCase());
    return matchTier && matchSearch;
  });

  const tierColors: Record<number, string> = {
    1: "bg-amber-100 text-amber-800",
    2: "bg-blue-100 text-blue-800",
    3: "bg-gray-100 text-gray-800",
  };
  const modelBadge: Record<string, string> = {
    opus: "bg-purple-100 text-purple-700",
    sonnet: "bg-orange-100 text-orange-700",
    haiku: "bg-green-100 text-green-700",
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-xl font-bold">Agent Registry</h1>
          <p className="text-sm text-muted-foreground mt-1">{agents.length} agents across 3 tiers</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Filters */}
        <div className="flex gap-4 mb-6">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="flex-1 px-3 py-2 border rounded-md bg-background"
          />
          <div className="flex gap-1">
            <button
              onClick={() => setFilterTier(null)}
              className={`px-3 py-2 text-sm rounded-md ${filterTier === null ? "bg-primary text-primary-foreground" : "border"}`}
            >
              All
            </button>
            {[1, 2, 3].map((tier) => (
              <button
                key={tier}
                onClick={() => setFilterTier(tier)}
                className={`px-3 py-2 text-sm rounded-md ${filterTier === tier ? "bg-primary text-primary-foreground" : "border"}`}
              >
                Tier {tier}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading agents...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((agent) => (
              <div
                key={agent.role}
                onClick={() => setSelectedAgent(agent)}
                className={`border rounded-lg p-4 cursor-pointer hover:bg-accent transition-colors ${selectedAgent?.role === agent.role ? "ring-2 ring-primary" : ""}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tierColors[agent.tier]}`}>
                    Tier {agent.tier}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${modelBadge[agent.model]}`}>
                    {agent.model.toUpperCase()}
                  </span>
                </div>
                <h3 className="font-medium text-sm mb-1">{agent.role}</h3>
                <p className="text-xs text-muted-foreground line-clamp-2">{agent.description}</p>
                <div className="flex flex-wrap gap-1 mt-3">
                  {agent.tools.slice(0, 5).map((tool) => (
                    <span key={tool} className="text-xs bg-accent px-1.5 py-0.5 rounded">
                      {tool}
                    </span>
                  ))}
                  {agent.tools.length > 5 && (
                    <span className="text-xs text-muted-foreground">+{agent.tools.length - 5}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Spawn Dialog */}
        {selectedAgent && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-card border rounded-lg p-6 max-w-md w-full">
              <h2 className="text-lg font-semibold mb-4">Spawn {selectedAgent.role}</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Session ID</label>
                  <input
                    type="text"
                    value={sessionId}
                    onChange={(e) => setSessionId(e.target.value)}
                    placeholder="Enter session ID..."
                    className="w-full px-3 py-2 border rounded-md bg-background"
                  />
                </div>
                <div className="border rounded-md p-3 bg-accent/50">
                  <p className="text-xs text-muted-foreground mb-1">Agent Preview</p>
                  <p className="text-sm font-medium">{selectedAgent.role}</p>
                  <p className="text-xs text-muted-foreground mt-1">{selectedAgent.description}</p>
                </div>
                {spawnResult && (
                  <p className={`text-sm ${spawnResult.startsWith("Error") ? "text-red-600" : "text-green-600"}`}>
                    {spawnResult}
                  </p>
                )}
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setSelectedAgent(null)}
                    className="px-4 py-2 border rounded-md text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSpawn}
                    disabled={spawning || !sessionId}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50"
                  >
                    {spawning ? "Spawning..." : "Spawn Agent"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}