"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";

interface SkillPhase {
  order: number;
  name: string;
  description: string;
  agents: string[];
  parallel?: boolean;
  gates?: string[];
}

interface TeamSkill {
  name: string;
  description: string;
  phases: SkillPhase[];
  teamMembers: string[];
  model?: string;
  gates?: string[];
}

const TEAM_COLORS: Record<string, string> = {
  team_combat: "border-red-400 bg-red-50",
  team_narrative: "border-purple-400 bg-purple-50",
  team_ui: "border-blue-400 bg-blue-50",
  team_progression: "border-green-400 bg-green-50",
  team_world: "border-amber-400 bg-amber-50",
  team_audio: "border-pink-400 bg-pink-50",
  team_performance: "border-orange-400 bg-orange-50",
  team_release: "border-cyan-400 bg-cyan-50",
  team_multiplayer: "border-indigo-400 bg-indigo-50",
  team_qa: "border-teal-400 bg-teal-50",
};

const TEAM_ICONS: Record<string, string> = {
  team_combat: "sports_martial_arts",
  team_narrative: "auto_stories",
  team_ui: "ui_elements",
  team_progression: "trending_up",
  team_world: "public",
  team_audio: "music_note",
  team_performance: "speed",
  team_release: "rocket_launch",
  team_multiplayer: "groups",
  team_qa: "bug_report",
};

export default function TeamsPage() {
  const [teams, setTeams] = useState<TeamSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTeam, setSelectedTeam] = useState<TeamSkill | null>(null);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    const loadTeams = async () => {
      try {
        const data = await apiFetch<TeamSkill[]>("/api/teams");
        setTeams(data);
      } catch (error) {
        console.error("Failed to load teams:", error);
      } finally {
        setLoading(false);
      }
    };
    loadTeams();

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

  const handleRunTeam = async (team: TeamSkill) => {
    if (!sessionId) {
      alert("No session available. Please refresh the page.");
      return;
    }
    setRunning(true);
    const teamName = team.name.replace("team-", "");
    try {
      await apiFetch(`/api/teams/${teamName}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, reviewMode: "lean" }),
      });
      alert(`${team.name} workflow started!`);
    } catch (error) {
      console.error("Failed to run team:", error);
      alert(`Failed to run team: ${error}`);
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-black border-t-primary animate-spin mx-auto mb-4" />
          <span className="font-[var(--font-terminal)] text-sm uppercase text-outline">
            Loading teams...
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
            Team Workflows
          </h1>
          <div className="text-sm font-[var(--font-terminal)] text-outline">
            {teams.length} teams
          </div>
        </div>
        <p className="font-[var(--font-label)] text-sm text-outline">
          Multi-agent workflows that coordinate specialized team members to complete complex tasks.
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {teams.map((team) => (
            <div
              key={team.name}
              className={`border-2 border-black p-6 cursor-pointer transition-all hover:shadow-[6px_6px_0_0_rgba(0,0,0,1)] ${
                TEAM_COLORS[team.name] || "bg-white"
              } ${selectedTeam?.name === team.name ? "ring-2 ring-black" : ""}`}
              onClick={() => setSelectedTeam(team)}
            >
              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 bg-black flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-white">
                    {TEAM_ICONS[team.name] || "groups"}
                  </span>
                </div>
                <div className="flex-1">
                  <h3 className="font-[var(--font-terminal)] font-bold text-lg uppercase mb-1">
                    {team.name.replace(/-/g, " ")}
                  </h3>
                  <p className="font-[var(--font-label)] text-sm text-outline">
                    {team.description}
                  </p>
                </div>
              </div>

              <div className="mb-4">
                <h4 className="font-[var(--font-terminal)] text-xs uppercase text-outline mb-2">
                  Team Members
                </h4>
                <div className="flex flex-wrap gap-2">
                  {team.teamMembers.map((member) => (
                    <span
                      key={member}
                      className="text-xs px-2 py-1 bg-white border border-gray-400 font-[var(--font-terminal)]"
                    >
                      {member.replace(/-/g, " ")}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-[var(--font-terminal)] text-outline">
                  {team.phases.length} phases
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRunTeam(team);
                  }}
                  disabled={running || !sessionId}
                  className="px-4 py-2 bg-black text-white font-[var(--font-terminal)] text-xs font-bold uppercase hover:bg-gray-800 disabled:opacity-50"
                >
                  {running ? "Running..." : "Run Team"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail Panel */}
      {selectedTeam && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedTeam(null)}
        >
          <div
            className="bg-white border-2 border-black w-full max-w-3xl max-h-[85vh] overflow-y-auto shadow-[8px_8px_0_0_rgba(0,0,0,1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b-2 border-black bg-gray-50 p-4 flex items-center justify-between sticky top-0">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-black flex items-center justify-center">
                  <span className="material-symbols-outlined text-white">
                    {TEAM_ICONS[selectedTeam.name] || "groups"}
                  </span>
                </div>
                <h2 className="font-[var(--font-terminal)] text-xl font-bold uppercase">
                  {selectedTeam.name.replace(/-/g, " ")}
                </h2>
              </div>
              <button
                onClick={() => setSelectedTeam(null)}
                className="w-8 h-8 flex items-center justify-center border-2 border-black hover:bg-black hover:text-white transition-colors"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <h3 className="font-[var(--font-terminal)] text-xs uppercase text-outline mb-2">
                  Description
                </h3>
                <p className="font-[var(--font-label)] text-sm">{selectedTeam.description}</p>
              </div>

              <div>
                <h3 className="font-[var(--font-terminal)] text-xs uppercase text-outline mb-2">
                  Team Members
                </h3>
                <div className="flex flex-wrap gap-2">
                  {selectedTeam.teamMembers.map((member) => (
                    <span
                      key={member}
                      className="text-xs px-3 py-1 bg-white border border-gray-400 font-[var(--font-terminal)]"
                    >
                      {member.replace(/-/g, " ")}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-[var(--font-terminal)] text-xs uppercase text-outline mb-3">
                  Workflow Phases
                </h3>
                <div className="space-y-3">
                  {selectedTeam.phases.map((phase) => (
                    <div key={phase.order} className="border border-gray-300 p-4 bg-gray-50">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-8 h-8 bg-black text-white flex items-center justify-center font-[var(--font-terminal)] font-bold text-sm">
                          {phase.order}
                        </span>
                        <h4 className="font-[var(--font-terminal)] font-bold">{phase.name}</h4>
                        {phase.parallel && (
                          <span className="text-xs px-2 py-0.5 bg-purple-100 border border-purple-400 text-purple-900 font-[var(--font-terminal)]">
                            PARALLEL
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-[var(--font-label)] text-outline mb-3">
                        {phase.description}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {phase.agents.map((agent) => (
                          <span
                            key={agent}
                            className="text-xs px-2 py-0.5 bg-white border border-gray-400 font-[var(--font-terminal)]"
                          >
                            {agent.replace(/-/g, " ")}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t-2 border-black">
                <button
                  onClick={() => handleRunTeam(selectedTeam)}
                  disabled={running || !sessionId}
                  className={`w-full py-3 border-2 border-black font-[var(--font-terminal)] font-bold uppercase transition-all ${
                    running
                      ? "bg-gray-100 cursor-wait"
                      : !sessionId
                      ? "bg-gray-100 cursor-not-allowed"
                      : "bg-primary text-white hover:bg-primary/90"
                  }`}
                >
                  {running ? "Running Workflow..." : !sessionId ? "No Session" : "Run Team Workflow"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
