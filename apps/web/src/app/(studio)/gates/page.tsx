"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useDialog } from "@/hooks/useDialog";
import type { WSEvent } from "@game-studio/types";

interface GateStatus {
  gateId: string;
  verdict?: string;
  sessionId: string;
  mode: string;
}

const GATE_CATEGORIES = [
  {
    name: "Creative Director",
    prefix: "CD",
    gates: [
      { id: "CD-PILLARS", description: "Validate game pillars and core vision" },
      { id: "CD-GDD-ALIGN", description: "Verify GDD alignment with pillars" },
      { id: "CD-SYSTEMS", description: "Review systems design decisions" },
      { id: "CD-PHASE-GATE", description: "Phase transition approval" },
    ],
    color: "border-purple-400 bg-purple-50",
  },
  {
    name: "Technical Director",
    prefix: "TD",
    gates: [
      { id: "TD-FEASIBILITY", description: "Technical feasibility review" },
      { id: "TD-ARCHITECTURE", description: "Architecture approval" },
      { id: "TD-SYSTEM-BOUNDARY", description: "System boundary validation" },
      { id: "TD-PHASE-GATE", description: "Phase transition approval" },
    ],
    color: "border-blue-400 bg-blue-50",
  },
  {
    name: "Producer",
    prefix: "PR",
    gates: [
      { id: "PR-SCOPE", description: "Scope definition review" },
      { id: "PR-SPRINT", description: "Sprint planning approval" },
      { id: "PR-MILESTONE", description: "Milestone review" },
      { id: "PR-PHASE-GATE", description: "Phase transition approval" },
    ],
    color: "border-green-400 bg-green-50",
  },
  {
    name: "QA Lead",
    prefix: "QL",
    gates: [
      { id: "QL-STORY-READY", description: "Story readiness check" },
      { id: "QL-TEST-COVERAGE", description: "Test coverage validation" },
    ],
    color: "border-orange-400 bg-orange-50",
  },
  {
    name: "Art Director",
    prefix: "AD",
    gates: [
      { id: "AD-PHASE-GATE", description: "Phase transition approval" },
      { id: "AD-ART-BIBLE", description: "Art bible consistency check" },
    ],
    color: "border-pink-400 bg-pink-50",
  },
];

export default function GatesPage() {
  const [gates, setGates] = useState<GateStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sessionId, setSessionId] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [selectedGate, setSelectedGate] = useState<{ id: string; description: string } | null>(null);
  const [verdict, setVerdict] = useState<{ gateId: string; verdict: string; details: string } | null>(null);

  useEffect(() => {
    loadGates();
    // Get current session
    const initSession = async () => {
      try {
        const sessions = await apiFetch<{ currentSessionId: string }>("/api/chat/sessions");
        setSessionId(sessions.currentSessionId);
      } catch (error) {
        console.error("Failed to get session:", error);
      }
    };
    initSession();
  }, []);

  const loadGates = async () => {
    try {
      // Use default session if none exists
      const sessionToUse = sessionId || "default";
      const data = await apiFetch<GateStatus[]>(`/api/gates?sessionId=${sessionToUse}`);
      setGates(data);
    } catch (error) {
      console.error("Failed to load gates:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleWSEvent = (event: WSEvent) => {
    if (event.type === "gate:verdict") {
      loadGates();
    }
  };

  useWebSocket(handleWSEvent);
  const { alert: showAlert } = useDialog();

  const handleRunGate = async (gateId: string) => {
    if (!sessionId) {
      await showAlert("No session available. Please select a session first.");
      return;
    }
    setRunning(gateId);
    try {
      const result = await apiFetch<{ gateId: string; verdict: string; details: string }>(
        `/api/gates/${gateId}/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, reviewMode: "lean" }),
        }
      );
      setVerdict(result);
      loadGates();
    } catch (error) {
      console.error("Failed to run gate:", error);
      await showAlert(`Failed to run gate: ${error}`);
    } finally {
      setRunning(null);
    }
  };

  const getVerdictColor = (verdict?: string) => {
    switch (verdict?.toUpperCase()) {
      case "APPROVE":
      case "READY":
        return "bg-green-100 border-green-400 text-green-900";
      case "CONCERNS":
        return "bg-yellow-100 border-yellow-400 text-yellow-900";
      case "REJECT":
        return "bg-red-100 border-red-400 text-red-900";
      default:
        return "bg-gray-100 border-gray-400 text-gray-900";
    }
  };

  const filteredCategories =
    categoryFilter === "all"
      ? GATE_CATEGORIES
      : GATE_CATEGORIES.filter((cat) => cat.prefix === categoryFilter);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-black border-t-primary animate-spin mx-auto mb-4" />
          <span className="font-[var(--font-terminal)] text-sm uppercase text-outline">
            Loading gates...
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
            Director Gates
          </h1>
          <div className="text-sm font-[var(--font-terminal)] text-outline">
            {gates.filter((g) => g.verdict).length} / {gates.length} gates passed
          </div>
        </div>
        <p className="font-[var(--font-label)] text-sm text-outline mb-4">
          Quality gates that enforce review checkpoints across development phases.
        </p>

        {/* Category Filter */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCategoryFilter("all")}
            className={`px-3 py-1 border-2 border-black font-[var(--font-terminal)] text-xs ${
              categoryFilter === "all" ? "bg-black text-white" : "bg-white text-black"
            }`}
          >
            All
          </button>
          {GATE_CATEGORIES.map((cat) => (
            <button
              key={cat.prefix}
              onClick={() => setCategoryFilter(cat.prefix)}
              className={`px-3 py-1 border-2 border-black font-[var(--font-terminal)] text-xs ${
                categoryFilter === cat.prefix ? "bg-black text-white" : "bg-white text-black"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {filteredCategories.map((category) => {
          const categoryGates = gates.filter((g) =>
            category.gates.some((cg) => cg.id === g.gateId)
          );

          return (
            <div key={category.prefix} className={`border-2 border-black ${category.color}`}>
              <div className="border-b-2 border-black bg-white px-4 py-3">
                <h2 className="font-[var(--font-terminal)] font-bold text-lg uppercase">
                  {category.name}
                </h2>
              </div>
              <div className="divide-y divide-gray-300">
                {category.gates.map((gate) => {
                  const gateStatus = categoryGates.find((g) => g.gateId === gate.id);
                  const isRunning = running === gate.id;

                  return (
                    <div key={gate.id} className="p-4 bg-white/50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-1">
                            <h3 className="font-[var(--font-terminal)] font-bold">
                              {gate.id}
                            </h3>
                            {gateStatus?.verdict && (
                              <span
                                className={`text-xs px-2 py-0.5 border font-[var(--font-terminal)] uppercase ${getVerdictColor(
                                  gateStatus.verdict
                                )}`}
                              >
                                {gateStatus.verdict}
                              </span>
                            )}
                          </div>
                          <p className="font-[var(--font-label)] text-sm text-outline">
                            {gate.description}
                          </p>
                        </div>
                        <div className="flex gap-2 ml-4">
                          <button
                            onClick={() => setSelectedGate(gate)}
                            className="px-3 py-1 border border-gray-400 font-[var(--font-terminal)] text-xs hover:bg-gray-100"
                          >
                            Details
                          </button>
                          <button
                            onClick={() => handleRunGate(gate.id)}
                            disabled={isRunning || !sessionId}
                            className={`px-3 py-1 border-2 border-black font-[var(--font-terminal)] text-xs font-bold uppercase transition-all ${
                              isRunning
                                ? "bg-gray-100 cursor-wait"
                                : !sessionId
                                ? "bg-gray-100 cursor-not-allowed opacity-50"
                                : "bg-primary text-white hover:bg-primary/90"
                            }`}
                          >
                            {isRunning ? "Running..." : "Run"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Gate Detail Modal */}
      {selectedGate && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => {
            setSelectedGate(null);
            setVerdict(null);
          }}
        >
          <div
            className="bg-white border-2 border-black w-full max-w-lg shadow-[8px_8px_0_0_rgba(0,0,0,1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b-2 border-black px-4 py-3 flex items-center justify-between bg-gray-50">
              <h2 className="font-[var(--font-terminal)] font-bold uppercase">{selectedGate.id}</h2>
              <button
                onClick={() => {
                  setSelectedGate(null);
                  setVerdict(null);
                }}
                className="w-8 h-8 flex items-center justify-center border-2 border-black hover:bg-black hover:text-white transition-colors"
              >
                ×
              </button>
            </div>
            <div className="p-6">
              <p className="font-[var(--font-label)] text-sm mb-6">{selectedGate.description}</p>

              {verdict ? (
                <div className="space-y-4">
                  <div className={`p-4 border-2 ${getVerdictColor(verdict.verdict)}`}>
                    <h3 className="font-[var(--font-terminal)] font-bold uppercase mb-2">
                      Verdict: {verdict.verdict}
                    </h3>
                    <p className="font-[var(--font-label)] text-sm">{verdict.details}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-gray-50 border border-gray-300">
                    <h3 className="font-[var(--font-terminal)] text-xs uppercase text-outline mb-2">
                      How It Works
                    </h3>
                    <ul className="font-[var(--font-label)] text-sm space-y-2">
                      <li>1. Agent reviews the relevant artifacts</li>
                      <li>2. Agent checks against criteria</li>
                      <li>3. Agent outputs verdict: APPROVE, CONCERNS, or REJECT</li>
                    </ul>
                  </div>
                  <button
                    onClick={() => handleRunGate(selectedGate.id)}
                    disabled={running === selectedGate.id || !sessionId}
                    className={`w-full py-3 border-2 border-black font-[var(--font-terminal)] font-bold uppercase transition-all ${
                      running === selectedGate.id || !sessionId
                        ? "bg-gray-100 cursor-not-allowed"
                        : "bg-primary text-white hover:bg-primary/90"
                    }`}
                  >
                    {running === selectedGate.id ? "Running..." : "Run Gate Review"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
