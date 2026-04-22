"use client";

import { useEffect, useState, use } from "react";
import { api } from "@/lib/api-client";
import Link from "next/link";

interface Checkpoint {
  id: string;
  timestamp: string;
  phase: string;
  activeTask: string;
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  agent?: string;
}

interface Session {
  id: string;
  name: string;
  status: string;
  config: Record<string, unknown>;
  checkpoints: Checkpoint[];
  agents: Record<string, unknown>;
  logs: LogEntry[];
  createdAt: string;
  updatedAt: string;
}

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"logs" | "checkpoints" | "config">("logs");

  useEffect(() => {
    async function load() {
      try {
        const data = (await api.sessions.get(id)) as Session;
        setSession(data);
      } catch (err) {
        console.error("Failed to load session:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading session...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-semibold mb-2">Session not found</h1>
          <Link href="/" className="text-primary hover:underline">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    idle: "bg-gray-100 text-gray-700",
    running: "bg-green-100 text-green-700",
    completed: "bg-blue-100 text-blue-700",
    failed: "bg-red-100 text-red-700",
    paused: "bg-yellow-100 text-yellow-700",
  };

  const logLevelColors: Record<string, string> = {
    info: "text-blue-600",
    warn: "text-yellow-600",
    error: "text-red-600",
    debug: "text-gray-400",
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4 mb-3">
            <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
              ← Back
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium">{session.name}</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">{session.name}</h1>
              <p className="text-xs text-muted-foreground mt-1">
                Created {new Date(session.createdAt).toLocaleDateString()} · Updated {new Date(session.updatedAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className={`text-sm px-3 py-1 rounded-full font-medium ${statusColors[session.status] ?? "bg-gray-100 text-gray-700"}`}>
                {session.status}
              </span>
              <span className="text-sm text-muted-foreground">
                {session.checkpoints.length} checkpoints
              </span>
              <span className="text-sm text-muted-foreground">
                {session.logs.length} logs
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Config Summary */}
        {Object.keys(session.config).length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">Session Configuration</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(session.config).map(([key, value]) => (
                <div key={key} className="border rounded-md p-3 bg-card">
                  <p className="text-xs text-muted-foreground capitalize">{key}</p>
                  <p className="text-sm font-medium mt-1">{String(value ?? "—")}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b mb-6">
          {(["logs", "checkpoints", "config"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
                activeTab === tab
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
              {tab === "logs" && ` (${session.logs.length})`}
              {tab === "checkpoints" && ` (${session.checkpoints.length})`}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "logs" && (
          <section>
            {session.logs.length === 0 ? (
              <p className="text-muted-foreground text-sm">No log entries yet.</p>
            ) : (
              <div className="space-y-1">
                {session.logs.slice().reverse().map((log, i) => (
                  <div key={i} className="flex gap-3 py-2 border-b text-sm">
                    <span className={`font-mono text-xs ${logLevelColors[log.level] ?? "text-gray-400"}`}>
                      {log.level.toUpperCase()}
                    </span>
                    <span className="text-muted-foreground text-xs font-mono">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    {log.agent && (
                      <span className="text-xs bg-accent px-1.5 py-0.5 rounded">
                        {log.agent}
                      </span>
                    )}
                    <span className="text-foreground">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "checkpoints" && (
          <section>
            {session.checkpoints.length === 0 ? (
              <p className="text-muted-foreground text-sm">No checkpoints saved yet.</p>
            ) : (
              <div className="space-y-4">
                {session.checkpoints.map((cp) => (
                  <div key={cp.id} className="border rounded-lg p-4 bg-card">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-sm">Phase: {cp.phase}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(cp.timestamp).toLocaleString()}
                        </p>
                        {cp.activeTask && (
                          <p className="text-sm mt-2 bg-accent px-2 py-1 rounded inline-block">
                            {cp.activeTask}
                          </p>
                        )}
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">
                        {cp.id.slice(0, 8)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "config" && (
          <section>
            <pre className="bg-card border rounded-lg p-4 text-sm overflow-auto">
              {JSON.stringify(session.config, null, 2)}
            </pre>
          </section>
        )}

        {/* Quick Actions */}
        <section className="mt-8 pt-6 border-t">
          <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
          <div className="flex gap-3">
            <button
              onClick={async () => {
                const phase = prompt("Phase:");
                const task = prompt("Active task:");
                if (phase && task) {
                  await api.sessions.checkpoint(session.id, phase, task);
                  const updated = (await api.sessions.get(session.id)) as Session;
                  setSession(updated);
                }
              }}
              className="px-4 py-2 border rounded-md hover:bg-accent text-sm"
            >
              Create Checkpoint
            </button>
            <Link
              href="/agents"
              className="px-4 py-2 border rounded-md hover:bg-accent text-sm"
            >
              Spawn Agent
            </Link>
            <Link
              href="/skills"
              className="px-4 py-2 border rounded-md hover:bg-accent text-sm"
            >
              Invoke Skill
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}