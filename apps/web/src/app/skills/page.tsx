"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

interface SkillArg {
  name: string;
  description: string;
  required?: boolean;
  default?: string;
}

interface SkillPhase {
  order: number;
  name: string;
  description: string;
  agents: string[];
  parallel?: boolean;
  gates?: string[];
}

interface Skill {
  name: string;
  description: string;
  phases: SkillPhase[];
  userInvocable: boolean;
  args?: SkillArg[];
  gates?: string[];
  teamMembers?: string[];
}

const phaseColors = ["bg-blue-100 text-blue-800", "bg-green-100 text-green-800", "bg-amber-100 text-amber-800", "bg-purple-100 text-purple-800"];

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "team" | "solo">("all");
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [args, setArgs] = useState<Record<string, string>>({});
  const [reviewMode, setReviewMode] = useState("lean");
  const [invoking, setInvoking] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = (await api.skills.list()) as Skill[];
        setSkills(data);
      } catch (err) {
        console.error("Failed to load skills:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = skills.filter((s) => {
    if (filter === "team") return s.name.startsWith("team-");
    if (filter === "solo") return !s.name.startsWith("team-");
    return true;
  });

  function handleSelectSkill(skill: Skill) {
    setSelectedSkill(skill);
    setArgs({});
    setResult(null);
  }

  async function handleInvoke() {
    if (!selectedSkill || !sessionId) return;
    setInvoking(true);
    setResult(null);
    try {
      const res = (await api.skills.invoke(sessionId, selectedSkill.name, args, reviewMode)) as { phases: number; reviewMode: string };
      setResult(`Queued "${selectedSkill.name}" — ${res.phases} phases, ${res.reviewMode} mode`);
    } catch (err) {
      setResult(`Error: ${err}`);
    } finally {
      setInvoking(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-xl font-bold">Skill Registry</h1>
          <p className="text-sm text-muted-foreground mt-1">{skills.length} skills — invoke team workflows or solo tasks</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Filter */}
        <div className="flex gap-2 mb-6">
          {(["all", "team", "solo"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 text-sm rounded-md ${filter === f ? "bg-primary text-primary-foreground" : "border"}`}
            >
              {f === "all" ? "All Skills" : f === "team" ? "Team Skills" : "Solo Skills"} ({skills.filter((s) => f === "all" ? true : f === "team" ? s.name.startsWith("team-") : !s.name.startsWith("team-")).length})
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading skills...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((skill) => (
              <div
                key={skill.name}
                onClick={() => handleSelectSkill(skill)}
                className="border rounded-lg p-4 cursor-pointer hover:bg-accent transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium text-sm">{skill.name}</h3>
                  {skill.name.startsWith("team-") && (
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Team</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{skill.description}</p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{skill.phases.length} phases</span>
                  {skill.teamMembers && <span>{skill.teamMembers.length} members</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Invoke Dialog */}
        {selectedSkill && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-card border rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-semibold mb-1">{selectedSkill.name}</h2>
              <p className="text-sm text-muted-foreground mb-4">{selectedSkill.description}</p>

              {/* Phase Steps */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold mb-3">Phases</h3>
                <div className="space-y-3">
                  {selectedSkill.phases.map((phase, i) => (
                    <div key={phase.order} className="flex gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold bg-primary/10 text-primary">
                        {phase.order}
                      </div>
                      <div className={`flex-1 border rounded-md p-3 ${phaseColors[i % phaseColors.length]}`}>
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-medium text-sm">{phase.name}</p>
                          {phase.parallel && (
                            <span className="text-xs bg-white/50 px-1.5 py-0.5 rounded">parallel</span>
                          )}
                        </div>
                        <p className="text-xs opacity-80">{phase.description}</p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {phase.agents.map((agent) => (
                            <span key={agent} className="text-xs bg-white/50 px-1.5 py-0.5 rounded">
                              {agent}
                            </span>
                          ))}
                        </div>
                        {phase.gates && phase.gates.length > 0 && (
                          <div className="flex gap-1 mt-2">
                            {phase.gates.map((gate) => (
                              <span key={gate} className="text-xs bg-white/30 px-1 py-0.5 rounded">
                                {gate}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Inputs */}
              <div className="space-y-3 mb-4">
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
                {selectedSkill.args?.map((arg) => (
                  <div key={arg.name}>
                    <label className="text-sm font-medium mb-1 block">
                      {arg.name} {arg.required && <span className="text-red-500">*</span>}
                    </label>
                    <input
                      type="text"
                      value={args[arg.name] ?? ""}
                      onChange={(e) => setArgs({ ...args, [arg.name]: e.target.value })}
                      placeholder={arg.default ?? arg.description}
                      className="w-full px-3 py-2 border rounded-md bg-background"
                    />
                  </div>
                ))}
                <div>
                  <label className="text-sm font-medium mb-1 block">Review Mode</label>
                  <select
                    value={reviewMode}
                    onChange={(e) => setReviewMode(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md bg-background"
                  >
                    <option value="solo">Solo — AI-only review</option>
                    <option value="lean">Lean — Key checkpoints</option>
                    <option value="full">Full — All gates enforced</option>
                  </select>
                </div>
              </div>

              {result && (
                <p className={`text-sm mb-4 ${result.startsWith("Error") ? "text-red-600" : "text-green-600"}`}>
                  {result}
                </p>
              )}

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setSelectedSkill(null)}
                  className="px-4 py-2 border rounded-md text-sm"
                >
                  Close
                </button>
                <button
                  onClick={handleInvoke}
                  disabled={invoking || !sessionId}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50"
                >
                  {invoking ? "Invoking..." : "Invoke Skill"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}