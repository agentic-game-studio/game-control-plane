"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

interface Gate {
  gateId: string;
  verdict: string | undefined;
  sessionId: string;
  mode: string;
}

const GATE_INFO: Record<string, { label: string; description: string; category: string }> = {
  "CD-PILLARS": { label: "CD Pillars", description: "Validates core pillars against player fantasy", category: "Creative Director" },
  "CD-GDD-ALIGN": { label: "CD GDD Align", description: "GDD sections aligned with design intent", category: "Creative Director" },
  "CD-SYSTEMS": { label: "CD Systems", description: "Systems design matches pillar promises", category: "Creative Director" },
  "CD-PHASE-GATE": { label: "CD Phase Gate", description: "Phase transition approval from CD", category: "Creative Director" },
  "TD-FEASIBILITY": { label: "TD Feasibility", description: "Technical feasibility of proposed systems", category: "Technical Director" },
  "TD-ARCHITECTURE": { label: "TD Architecture", description: "Architecture review for scalability", category: "Technical Director" },
  "TD-SYSTEM-BOUNDARY": { label: "TD System Boundary", description: "Clear module boundaries and interfaces", category: "Technical Director" },
  "TD-PHASE-GATE": { label: "TD Phase Gate", description: "Phase transition approval from TD", category: "Technical Director" },
  "PR-SCOPE": { label: "PR Scope", description: "Sprint scope fits within timebox", category: "Producer" },
  "PR-SPRINT": { label: "PR Sprint", description: "Sprint planning completeness", category: "Producer" },
  "PR-MILESTONE": { label: "PR Milestone", description: "Milestone deliverables achievable", category: "Producer" },
  "PR-PHASE-GATE": { label: "PR Phase Gate", description: "Phase transition approval from Producer", category: "Producer" },
  "LP-CODE-REVIEW": { label: "LP Code Review", description: "Code quality and review completion", category: "Lead Programmer" },
  "LP-FEASIBILITY": { label: "LP Feasibility", description: "Implementation feasibility validated", category: "Lead Programmer" },
  "QL-STORY-READY": { label: "QL Story Ready", description: "Stories have acceptance criteria", category: "QA Lead" },
  "QL-TEST-COVERAGE": { label: "QL Test Coverage", description: "Adequate test coverage for scope", category: "QA Lead" },
  "AD-PHASE-GATE": { label: "AD Phase Gate", description: "Art asset delivery phase approval", category: "Art Director" },
  "AD-ART-BIBLE": { label: "AD Art Bible", description: "Art bible standards met", category: "Art Director" },
};

export default function GatesPage() {
  const [sessionId, setSessionId] = useState("");
  const [gates, setGates] = useState<Gate[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  async function loadGates() {
    if (!sessionId.trim()) return;
    setLoading(true);
    try {
      const data = (await api.gates.list(sessionId)) as Gate[];
      setGates(data);
    } catch (err) {
      console.error("Failed to load gates:", err);
    } finally {
      setLoading(false);
    }
  }

  async function runGate(gateId: string) {
    if (!sessionId.trim()) return;
    setRunning(gateId);
    try {
      const result = (await api.gates.run(sessionId, gateId)) as { verdict: string; timestamp: string; mode: string };
      setGates((prev) =>
        prev.map((g) =>
          g.gateId === gateId ? { ...g, verdict: result.verdict } : g
        )
      );
    } catch (err) {
      console.error(`Failed to run gate ${gateId}:`, err);
    } finally {
      setRunning(null);
    }
  }

  const categories = [...new Set(Object.values(GATE_INFO).map((g) => g.category))];
  const filteredGates = filterCategory
    ? gates.filter((g) => GATE_INFO[g.gateId]?.category === filterCategory)
    : gates;

  const verdictColors: Record<string, string> = {
    PASS: "bg-green-100 text-green-700",
    CONCERNS: "bg-yellow-100 text-yellow-700",
    FAIL: "bg-red-100 text-red-700",
    READY: "bg-blue-100 text-blue-700",
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-xl font-bold">Director Gates</h1>
          <p className="text-sm text-muted-foreground mt-1">18 gates across Creative, Technical, Producer, QA, and Art review layers</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Session Selector */}
        <section className="mb-8">
          <div className="flex gap-3 max-w-lg">
            <input
              type="text"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              placeholder="Enter session ID to load gate status..."
              className="flex-1 px-3 py-2 border rounded-md bg-background"
            />
            <button
              onClick={loadGates}
              disabled={loading || !sessionId.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 text-sm disabled:opacity-50"
            >
              {loading ? "Loading..." : "Load Gates"}
            </button>
          </div>
        </section>

        {/* Category Filter */}
        {gates.length > 0 && (
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setFilterCategory(null)}
              className={`px-3 py-1.5 text-sm rounded-md ${filterCategory === null ? "bg-primary text-primary-foreground" : "border"}`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`px-3 py-1.5 text-sm rounded-md ${filterCategory === cat ? "bg-primary text-primary-foreground" : "border"}`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Gate Matrix */}
        {gates.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground">Enter a session ID above to view gate statuses</p>
          </div>
        ) : (
          <div className="space-y-6">
            {categories.map((category) => {
              const categoryGates = filteredGates.filter((g) => GATE_INFO[g.gateId]?.category === category);
              if (categoryGates.length === 0) return null;
              return (
                <div key={category}>
                  <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">{category} Gates</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {categoryGates.map((gate) => {
                      const info = GATE_INFO[gate.gateId];
                      if (!info) return null;
                      return (
                        <div key={gate.gateId} className="border rounded-lg p-4 bg-card">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <h3 className="font-medium text-sm">{info.label}</h3>
                              <p className="text-xs text-muted-foreground mt-0.5">{info.description}</p>
                            </div>
                            {gate.verdict && (
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${verdictColors[gate.verdict] ?? "bg-gray-100 text-gray-700"}`}>
                                {gate.verdict}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between mt-4">
                            <span className="text-xs text-muted-foreground">Mode: {gate.mode}</span>
                            <button
                              onClick={() => runGate(gate.gateId)}
                              disabled={running === gate.gateId}
                              className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs hover:opacity-90 disabled:opacity-50"
                            >
                              {running === gate.gateId ? "Running..." : "Run Gate"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}