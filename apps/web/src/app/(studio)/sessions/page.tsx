"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { WSEvent } from "@game-studio/types";

interface Session {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  checkpoints?: number;
  agents?: number;
  logs?: number;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [logs, setLogs] = useState<{ level: string; message: string; timestamp: string }[]>([]);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const data = await apiFetch<Session[]>("/api/sessions");
      setSessions(data);
    } catch (error) {
      console.error("Failed to load sessions:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleWSEvent = (event: WSEvent) => {
    if (event.type === "session:status" || event.type === "checkpoint:saved") {
      loadSessions();
    }
    if (event.type === "log:entry" && selectedSession && event.sessionId === selectedSession.id) {
      setLogs((prev) => [
        ...prev,
        { level: event.level, message: event.message, timestamp: event.timestamp },
      ]);
    }
  };

  useWebSocket(handleWSEvent);

  const handleCreate = async () => {
    if (!newSessionName.trim()) return;
    setCreating(true);
    try {
      await apiFetch<{ session: Session }>("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSessionName }),
      });
      setNewSessionName("");
      loadSessions();
    } catch (error) {
      console.error("Failed to create session:", error);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this session?")) return;
    try {
      await apiFetch(`/api/sessions/${id}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (selectedSession?.id === id) {
        setSelectedSession(null);
        setLogs([]);
      }
    } catch (error) {
      console.error("Failed to delete session:", error);
    }
  };

  const handleCheckpoint = async (id: string) => {
    try {
      await apiFetch(`/api/sessions/${id}/checkpoint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "manual", activeTask: "User-initiated checkpoint" }),
      });
      loadSessions();
    } catch (error) {
      console.error("Failed to create checkpoint:", error);
    }
  };

  const loadLogs = async (session: Session) => {
    setSelectedSession(session);
    setLogs([]);
    // Fetch session details including logs
    try {
      const data = await apiFetch<Session & { logs?: { level: string; message: string; timestamp: string }[] }>(
        `/api/sessions/${session.id}`
      );
      if (data.logs) {
        setLogs(data.logs);
      }
    } catch (error) {
      console.error("Failed to load logs:", error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
      case "running":
        return "bg-green-100 border-green-400 text-green-900";
      case "completed":
      case "done":
        return "bg-blue-100 border-blue-400 text-blue-900";
      case "idle":
        return "bg-gray-100 border-gray-400 text-gray-900";
      case "error":
        return "bg-red-100 border-red-400 text-red-900";
      default:
        return "bg-gray-100 border-gray-400 text-gray-900";
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-black border-t-primary animate-spin mx-auto mb-4" />
          <span className="font-[var(--font-terminal)] text-sm uppercase text-outline">
            Loading sessions...
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
            Sessions
          </h1>
          <div className="text-sm font-[var(--font-terminal)] text-outline">
            {sessions.length} sessions
          </div>
        </div>

        {/* Create Form */}
        <div className="flex gap-4">
          <input
            type="text"
            placeholder="New session name..."
            value={newSessionName}
            onChange={(e) => setNewSessionName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            className="flex-1 px-4 py-2 border-2 border-black font-[var(--font-terminal)] text-sm focus:outline-none focus:border-primary"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newSessionName.trim()}
            className={`px-6 py-2 border-2 border-black font-[var(--font-terminal)] font-bold uppercase text-sm transition-all ${
              creating
                ? "bg-gray-100 cursor-wait"
                : "bg-primary text-white hover:bg-primary/90"
            }`}
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {sessions.length === 0 ? (
          <div className="text-center py-12">
            <div className="material-symbols-outlined text-6xl text-outline mb-4">folder_open</div>
            <p className="font-[var(--font-terminal)] text-outline">No sessions yet</p>
            <p className="font-[var(--font-label)] text-sm text-outline mt-2">
              Create a session to start tracking your game development work
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`border-2 border-black p-4 bg-white cursor-pointer transition-all hover:shadow-[4px_4px_0_0_rgba(0,0,0,1)] ${
                  selectedSession?.id === session.id ? "ring-2 ring-primary" : ""
                }`}
                onClick={() => loadLogs(session)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-[var(--font-terminal)] font-bold text-lg">
                      {session.name}
                    </h3>
                    <p className="font-[var(--font-terminal)] text-xs text-outline">
                      ID: {session.id.slice(0, 8)}...
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-3 py-1 border font-[var(--font-terminal)] uppercase ${getStatusColor(
                        session.status
                      )}`}
                    >
                      {session.status}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-3 text-sm">
                  <div>
                    <span className="font-[var(--font-terminal)] text-outline uppercase text-xs">
                      Created
                    </span>
                    <p className="font-[var(--font-label)]">{formatDate(session.createdAt)}</p>
                  </div>
                  <div>
                    <span className="font-[var(--font-terminal)] text-outline uppercase text-xs">
                      Updated
                    </span>
                    <p className="font-[var(--font-label)]">{formatDate(session.updatedAt)}</p>
                  </div>
                  <div>
                    <span className="font-[var(--font-terminal)] text-outline uppercase text-xs">
                      Checkpoints
                    </span>
                    <p className="font-[var(--font-label)]">{session.checkpoints ?? 0}</p>
                  </div>
                </div>

                <div className="flex gap-2 pt-3 border-t border-gray-200">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCheckpoint(session.id);
                    }}
                    className="px-4 py-1 border border-gray-400 font-[var(--font-terminal)] text-xs hover:bg-gray-100"
                  >
                    Create Checkpoint
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(session.id);
                    }}
                    className="px-4 py-1 border border-red-400 text-red-600 font-[var(--font-terminal)] text-xs hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Log Panel */}
      {selectedSession && (
        <div className="border-t-2 border-black bg-gray-50 h-64 flex flex-col">
          <div className="px-4 py-2 border-b border-gray-300 bg-white flex items-center justify-between">
            <h3 className="font-[var(--font-terminal)] text-sm font-bold uppercase">
              Activity Log: {selectedSession.name}
            </h3>
            <button
              onClick={() => {
                setSelectedSession(null);
                setLogs([]);
              }}
              className="text-outline hover:text-black"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 font-[var(--font-terminal)] text-xs">
            {logs.length === 0 ? (
              <p className="text-outline">No logs yet</p>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="mb-1">
                  <span className="text-outline">[{formatDate(log.timestamp)}]</span>{" "}
                  <span
                    className={
                      log.level === "error"
                        ? "text-red-600"
                        : log.level === "warn"
                        ? "text-orange-600"
                        : ""
                    }
                  >
                    [{log.level.toUpperCase()}]
                  </span>{" "}
                  {log.message}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
