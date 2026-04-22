"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api-client";
import { useWebSocket } from "@/hooks/use-websocket";
import Link from "next/link";

interface Session {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface Agent {
  role: string;
  description: string;
  tier: number;
  model: string;
}

interface Skill {
  name: string;
  description: string;
  userInvocable: boolean;
  phases: unknown[];
  teamMembers?: string[];
}

export default function Dashboard() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSessionName, setNewSessionName] = useState("");
  const { events } = useWebSocket();

  useEffect(() => {
    async function load() {
      try {
        const [s, a, sk] = await Promise.all([
          api.sessions.list() as Promise<Session[]>,
          api.agents.list() as Promise<Agent[]>,
          api.skills.list() as Promise<Skill[]>,
        ]);
        setSessions(s);
        setAgents(a);
        setSkills(sk);
      } catch (err) {
        console.error("Failed to load data:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleCreateSession() {
    if (!newSessionName.trim()) return;
    try {
      const session = (await api.sessions.create(newSessionName)) as Session;
      setSessions((prev) => [session, ...prev]);
      setNewSessionName("");
    } catch (err) {
      console.error("Failed to create session:", err);
    }
  }

  const tier1Agents = agents.filter((a) => a.tier === 1);
  const tier2Agents = agents.filter((a) => a.tier === 2);
  const tier3Agents = agents.filter((a) => a.tier === 3);
  const teamSkills = skills.filter((s) => s.name.startsWith("team-"));

  return (
    <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading control plane...</p>
        </div>
      ) : (
        <>
          {/* Header */}
          <header className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Dashboard</h1>
              <p className="text-sm text-muted-foreground">
                Multi-agent game development orchestration
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Sessions:</span>
                <span className="font-medium">{sessions.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Agents:</span>
                <span className="font-medium">{agents.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Skills:</span>
                <span className="font-medium">{skills.length}</span>
              </div>
            </div>
          </header>

          {/* New Session */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Start New Session</h2>
            <div className="flex gap-2 max-w-lg">
              <input
                type="text"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                placeholder="Enter game project name..."
                className="flex-1 px-3 py-2 border rounded-md bg-background"
                onKeyDown={(e) => e.key === "Enter" && handleCreateSession()}
              />
              <button
                onClick={handleCreateSession}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90"
              >
                Create Session
              </button>
            </div>
          </section>

          {/* Sessions */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Active Sessions</h2>
            {sessions.length === 0 ? (
              <p className="text-muted-foreground text-sm">No sessions yet. Create one above.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sessions.map((session) => (
                  <Link
                    key={session.id}
                    href={`/sessions/${session.id}`}
                    className="block border rounded-lg p-4 hover:bg-accent transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-medium">{session.name}</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(session.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${
                          session.status === "running"
                            ? "bg-green-100 text-green-700"
                            : session.status === "idle"
                            ? "bg-gray-100 text-gray-700"
                            : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {session.status}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Agent Hierarchy */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Agent Registry</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Tier 1 */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Tier 1 — Leadership ({tier1Agents.length})
                </h3>
                <div className="space-y-2">
                  {tier1Agents.map((agent) => (
                    <div key={agent.role} className="border rounded-md p-3 bg-card">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                          OPUS
                        </span>
                        <span className="font-medium text-sm">{agent.role}</span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {agent.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tier 2 */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Tier 2 — Leads ({tier2Agents.length})
                </h3>
                <div className="space-y-2">
                  {tier2Agents.map((agent) => (
                    <div key={agent.role} className="border rounded-md p-3 bg-card">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">
                          SONNET
                        </span>
                        <span className="font-medium text-sm">{agent.role}</span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {agent.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tier 3 */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Tier 3 — Specialists ({tier3Agents.length})
                </h3>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {tier3Agents.map((agent) => (
                    <div key={agent.role} className="border rounded-md p-2 bg-card">
                      <span className="font-medium text-xs">{agent.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Team Skills */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Team Orchestration</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {teamSkills.map((skill) => (
                <div key={skill.name} className="border rounded-lg p-4 bg-card">
                  <h3 className="font-medium mb-1">{skill.name}</h3>
                  <p className="text-xs text-muted-foreground mb-3">{skill.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {skill.teamMembers?.map((member) => (
                      <span
                        key={member}
                        className="text-xs bg-accent text-accent-foreground px-2 py-0.5 rounded-full"
                      >
                        {member}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Live Events Feed */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Live Event Feed</h2>
            <div className="border rounded-lg p-4 bg-card max-h-64 overflow-y-auto">
              {events.length === 0 ? (
                <p className="text-xs text-muted-foreground">No events yet. Start a session to see live activity.</p>
              ) : (
                events.slice(-20).reverse().map((event, i) => (
                  <div key={i} className="text-xs font-mono py-1 border-b last:border-0">
                    <span className="text-muted-foreground">
                      {new Date().toLocaleTimeString()}
                    </span>{" "}
                    <span className="text-foreground">{JSON.stringify(event).slice(0, 120)}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}