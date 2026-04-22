"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import Link from "next/link";

interface Session {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  config: Record<string, unknown>;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const data = (await api.sessions.list()) as Session[];
      setSessions(data);
    } catch (err) {
      console.error("Failed to load sessions:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    try {
      const session = (await api.sessions.create(newName)) as Session;
      setSessions((prev) => [session, ...prev]);
      setNewName("");
    } catch (err) {
      console.error("Failed to create session:", err);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this session?")) return;
    try {
      await api.sessions.delete(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  }

  const statusColors: Record<string, string> = {
    idle: "bg-gray-100 text-gray-700",
    running: "bg-green-100 text-green-700",
    completed: "bg-blue-100 text-blue-700",
    failed: "bg-red-100 text-red-700",
    paused: "bg-yellow-100 text-yellow-700",
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-xl font-bold">Sessions</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage game development sessions</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Create */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">New Session</h2>
          <div className="flex gap-2 max-w-lg">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Game project name..."
              className="flex-1 px-3 py-2 border rounded-md bg-background"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 text-sm"
            >
              Create
            </button>
          </div>
        </section>

        {/* List */}
        <section>
          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : sessions.length === 0 ? (
            <p className="text-muted-foreground text-sm">No sessions yet.</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Name</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">Created</th>
                    <th className="text-left px-4 py-3 font-medium">Config</th>
                    <th className="text-right px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={session.id} className="border-t hover:bg-accent/50">
                      <td className="px-4 py-3">
                        <Link href={`/sessions/${session.id}`} className="font-medium hover:underline">
                          {session.name}
                        </Link>
                        <p className="text-xs text-muted-foreground font-mono">{session.id.slice(0, 8)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[session.status] ?? "bg-gray-100 text-gray-700"}`}>
                          {session.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {new Date(session.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {Object.keys(session.config).length > 0 ? Object.keys(session.config).join(", ") : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          <Link
                            href={`/sessions/${session.id}`}
                            className="px-3 py-1 border rounded-md text-xs hover:bg-accent"
                          >
                            View
                          </Link>
                          <button
                            onClick={() => handleDelete(session.id)}
                            className="px-3 py-1 border border-red-200 text-red-600 rounded-md text-xs hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}