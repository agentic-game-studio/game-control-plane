"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

interface SkillPhase {
  order: number;
  name: string;
  description: string;
  agents: string[];
  parallel?: boolean;
}

interface Skill {
  name: string;
  description: string;
  phases: SkillPhase[];
  teamMembers: string[];
}

export default function TeamsPage() {
  const [teams, setTeams] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTeam, setSelectedTeam] = useState<Skill | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [input, setInput] = useState("");
  const [reviewMode, setReviewMode] = useState("lean");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = (await api.teams.list()) as Skill[];
        setTeams(data);
      } catch (err) {
        console.error("Failed to load teams:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleRun() {
    if (!selectedTeam || !sessionId) return;
    setRunning(true);
    setResult(null);
    try {
      const teamName = selectedTeam.name.replace("team-", "");
      const res = (await api.teams.run(sessionId, teamName, input, reviewMode)) as { members: string[]; reviewMode: string };
      setResult(`Team "${selectedTeam.name}" running — ${res.members.length} members, ${res.reviewMode} mode`);
    } catch (err) {
      setResult(`Error: ${err}`);
    } finally {
      setRunning(false);
    }
  }

  const teamIcons: Record<string, string> = {
    "team-combat": "⚔️",
    "team-narrative": "📖",
    "team-ui": "🎨",
    "team-progression": "📈",
    "team-world": "🌍",
    "team-audio": "🎵",
    "team-performance": "⚡",
    "team-release": "🚀",
    "team-multiplayer": "🌐",
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-xl font-bold">Team Orchestration</h1>
          <p className="text-sm text-muted-foreground mt-1">9 teams · Multi-agent workflows</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {loading ? (
          <p className="text-muted-foreground">Loading teams...</p>
        ) : (
          <div className="space-y-4">
            {teams.map((team) => (
              <div
                key={team.name}
                className="border rounded-lg p-5 bg-card"
              >
                <div className="flex items-start gap-4">
                  <div className="text-3xl">{teamIcons[team.name] ?? "👥"}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold">{team.name}</h3>
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                        {team.phases.length} phases
                      </span>
                      <span className="text-xs bg-accent px-2 py-0.5 rounded-full">
                        {team.teamMembers.length} members
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">{team.description}</p>

                    {/* Phase Timeline */}
                    <div className="flex items-center gap-2 mb-4">
                      {team.phases.map((phase, i) => (
                        <div key={phase.order} className="flex items-center">
                          <div className="flex flex-col items-center">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                              phase.parallel ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                            }`}>
                              {phase.order}
                            </div>
                            <p className="text-xs text-center mt-1 max-w-[80px] truncate">{phase.name}</p>
                          </div>
                          {i < team.phases.length - 1 && (
                            <div className={`w-12 h-0.5 ${phase.parallel ? "bg-purple-300" : "bg-blue-300"}`} />
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Members */}
                    <div className="flex flex-wrap gap-1 mb-4">
                      {team.teamMembers.map((member) => (
                        <span key={member} className="text-xs bg-accent px-2 py-0.5 rounded-full">
                          {member}
                        </span>
                      ))}
                    </div>

                    {/* Run Button */}
                    <button
                      onClick={() => { setSelectedTeam(team); setResult(null); }}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90"
                    >
                      Run Team
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Run Dialog */}
        {selectedTeam && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-card border rounded-lg p-6 max-w-md w-full">
              <h2 className="text-lg font-semibold mb-1">Run {selectedTeam.name}</h2>
              <p className="text-sm text-muted-foreground mb-4">{selectedTeam.description}</p>

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
                <div>
                  <label className="text-sm font-medium mb-1 block">Input / Task Description</label>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="What should this team work on?"
                    rows={4}
                    className="w-full px-3 py-2 border rounded-md bg-background resize-none"
                  />
                </div>
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
                  onClick={() => setSelectedTeam(null)}
                  className="px-4 py-2 border rounded-md text-sm"
                >
                  Close
                </button>
                <button
                  onClick={handleRun}
                  disabled={running || !sessionId}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50"
                >
                  {running ? "Running..." : "Run Team"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}