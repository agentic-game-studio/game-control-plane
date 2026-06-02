"use client";
import { createLogger } from "../../../lib/logger";
import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import type { AgentRole } from "@game-studio/types";
const logger = createLogger("page");

interface AgentPrompt {
  name: string;
  description: string;
  model: string;
  maxTurns: number;
  memory: string;
  tools: string[];
  disallowedTools?: string[];
  skills?: string[];
}

const MODEL_COLORS: Record<string, string> = {
  opus: "bg-purple-100 border-purple-400 text-purple-900",
  sonnet: "bg-blue-100 border-blue-400 text-blue-900",
  haiku: "bg-green-100 border-green-400 text-green-900",
};

const TOOL_ICONS: Record<string, string> = {
  Read: "description",
  Write: "edit_note",
  Edit: "edit",
  Glob: "folder_open",
  Grep: "search",
  Bash: "terminal",
  Task: "group",
  WebSearch: "language",
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [selectedAgent, setSelectedAgent] = useState<AgentPrompt | null>(null);
  const [spawning, setSpawning] = useState<string | null>(null);
  const [spawnSuccess, setSpawnSuccess] = useState<string | null>(null);

  useEffect(() => {
    const loadAgents = async () => {
      try {
        const data = await apiFetch<AgentPrompt[]>("/api/prompts/agents");
        setAgents(data);
      } catch (error) {
        logger.error("Failed to load agents", { err: error });
      } finally {
        setLoading(false);
      }
    };
    loadAgents();
  }, []);

  const filteredAgents = agents.filter((agent) => {
    const matchesSearch =
      agent.name.toLowerCase().includes(search.toLowerCase()) ||
      agent.description.toLowerCase().includes(search.toLowerCase());
    const matchesTier = tierFilter === "all" || agent.model === tierFilter;
    return matchesSearch && matchesTier;
  });

  const handleSpawn = async (agent: AgentPrompt) => {
    setSpawning(agent.name);
    setSpawnSuccess(null);
    try {
      await apiFetch<{ invocationId: string; role: string; sessionId: string }>("/api/chat/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: agent.name,
          task: `You are now online as ${agent.name}. ${agent.description.slice(0, 200)}. What can you help me with today?`,
        }),
      });
      setSpawnSuccess(agent.name);
      setTimeout(() => setSpawnSuccess(null), 3000);
    } catch (error) {
      logger.error("Failed to spawn agent", { err: error });
    } finally {
      setSpawning(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-black border-t-primary animate-spin mx-auto mb-4" />
          <span className="font-[var(--font-terminal)] text-sm uppercase text-outline">
            Loading agents...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden flex flex-col">
      {/* Header */}
      <div className="border-b-2 border-black bg-white px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-[var(--font-terminal)] text-2xl font-bold uppercase tracking-wider">
            Agent Registry
          </h1>
          <div className="text-sm font-[var(--font-terminal)] text-outline">
            {filteredAgents.length} / {agents.length} agents
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-4 py-2 border-2 border-black font-[var(--font-terminal)] text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <div className="flex gap-2">
            {["all", "opus", "sonnet", "haiku"].map((tier) => (
              <button
                key={tier}
                onClick={() => setTierFilter(tier)}
                className={`px-4 py-2 border-2 border-black font-[var(--font-terminal)] text-sm uppercase ${
                  tierFilter === tier
                    ? "bg-black text-white"
                    : "bg-white text-black hover:bg-gray-100"
                }`}
              >
                {tier === "all" ? "All" : tier.charAt(0).toUpperCase() + tier.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAgents.map((agent) => (
            <div
              key={agent.name}
              onClick={() => setSelectedAgent(agent)}
              className={`border-2 border-black p-4 cursor-pointer transition-all hover:shadow-[4px_4px_0_0_rgba(0,0,0,1)] ${
                selectedAgent?.name === agent.name ? "bg-gray-50" : "bg-white"
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-[var(--font-terminal)] font-bold text-sm uppercase">
                  {agent.name.replace(/-/g, " ")}
                </h3>
                <span
                  className={`text-xs px-2 py-0.5 border font-[var(--font-terminal)] uppercase ${
                    MODEL_COLORS[agent.model] || "bg-gray-100 border-gray-400 text-gray-900"
                  }`}
                >
                  {agent.model}
                </span>
              </div>
              <p className="text-xs text-outline font-[var(--font-label)] line-clamp-2 mb-3">
                {agent.description.replace(/"/g, "").slice(0, 120)}...
              </p>
              <div className="flex flex-wrap gap-1">
                {agent.tools.slice(0, 4).map((tool) => (
                  <span
                    key={tool}
                    className="text-xs px-2 py-0.5 bg-gray-100 border border-gray-300 font-[var(--font-terminal)]"
                  >
                    {tool}
                  </span>
                ))}
                {agent.tools.length > 4 && (
                  <span className="text-xs px-2 py-0.5 bg-gray-100 border border-gray-300 font-[var(--font-terminal)]">
                    +{agent.tools.length - 4}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail Panel */}
      {selectedAgent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedAgent(null)}>
          <div
            className="bg-white border-2 border-black w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-[8px_8px_0_0_rgba(0,0,0,1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b-2 border-black bg-gray-50 p-4 flex items-center justify-between">
              <h2 className="font-[var(--font-terminal)] text-xl font-bold uppercase">
                {selectedAgent.name.replace(/-/g, " ")}
              </h2>
              <div className="flex items-center gap-4">
                <span
                  className={`text-xs px-3 py-1 border font-[var(--font-terminal)] uppercase ${
                    MODEL_COLORS[selectedAgent.model] || "bg-gray-100 border-gray-400 text-gray-900"
                  }`}
                >
                  {selectedAgent.model}
                </span>
                <button
                  onClick={() => setSelectedAgent(null)}
                  className="w-8 h-8 flex items-center justify-center border-2 border-black hover:bg-black hover:text-white transition-colors"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Description */}
              <div>
                <h3 className="font-[var(--font-terminal)] text-xs uppercase text-outline mb-2">
                  Description
                </h3>
                <p className="font-[var(--font-label)] text-sm">
                  {selectedAgent.description.replace(/"/g, "")}
                </p>
              </div>

              {/* Config */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="font-[var(--font-terminal)] text-xs uppercase text-outline mb-2">
                    Max Turns
                  </h3>
                  <p className="font-[var(--font-terminal)] text-sm">{selectedAgent.maxTurns}</p>
                </div>
                <div>
                  <h3 className="font-[var(--font-terminal)] text-xs uppercase text-outline mb-2">
                    Memory
                  </h3>
                  <p className="font-[var(--font-terminal)] text-sm capitalize">{selectedAgent.memory}</p>
                </div>
              </div>

              {/* Tools */}
              <div>
                <h3 className="font-[var(--font-terminal)] text-xs uppercase text-outline mb-2">
                  Available Tools
                </h3>
                <div className="flex flex-wrap gap-2">
                  {selectedAgent.tools.map((tool) => (
                    <span
                      key={tool}
                      className="flex items-center gap-1 text-xs px-3 py-1 bg-gray-100 border border-gray-300 font-[var(--font-terminal)]"
                    >
                      <span className="material-symbols-outlined text-sm">
                        {TOOL_ICONS[tool] || "build"}
                      </span>
                      {tool}
                    </span>
                  ))}
                </div>
              </div>

              {/* Disallowed Tools */}
              {selectedAgent.disallowedTools && selectedAgent.disallowedTools.length > 0 && (
                <div>
                  <h3 className="font-[var(--font-terminal)] text-xs uppercase text-outline mb-2">
                    Disallowed Tools
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedAgent.disallowedTools.map((tool) => (
                      <span
                        key={tool}
                        className="text-xs px-3 py-1 bg-red-50 border border-red-300 text-red-700 font-[var(--font-terminal)] line-through"
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Skills */}
              {selectedAgent.skills && selectedAgent.skills.length > 0 && (
                <div>
                  <h3 className="font-[var(--font-terminal)] text-xs uppercase text-outline mb-2">
                    Skills
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedAgent.skills.map((skill) => (
                      <span
                        key={skill}
                        className="text-xs px-3 py-1 bg-blue-50 border border-blue-300 text-blue-700 font-[var(--font-terminal)]"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Spawn Button */}
              <div className="pt-4 border-t-2 border-black">
                <button
                  onClick={() => handleSpawn(selectedAgent)}
                  disabled={spawning === selectedAgent.name}
                  className={`w-full py-3 border-2 border-black font-[var(--font-terminal)] font-bold uppercase text-sm transition-all ${
                    spawnSuccess === selectedAgent.name
                      ? "bg-green-500 text-white border-green-500"
                      : spawning === selectedAgent.name
                      ? "bg-gray-100 cursor-wait"
                      : "bg-primary text-white hover:bg-primary/90"
                  }`}
                >
                  {spawnSuccess === selectedAgent.name
                    ? "✓ Agent Spawned"
                    : spawning === selectedAgent.name
                    ? "Spawning..."
                    : "Spawn Agent"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
