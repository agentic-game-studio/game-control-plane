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

interface Skill {
  name: string;
  description: string;
  phases: SkillPhase[];
  model?: string;
  userInvocable: boolean;
  args?: { name: string; description: string; required?: boolean }[];
  gates?: string[];
  teamMembers?: string[];
}

const CATEGORY_LABELS: Record<string, string> = {
  onboarding: "Onboarding",
  design: "Design",
  "ux-design": "UX Design",
  architecture: "Architecture",
  "stories-sprints": "Stories & Sprints",
  reviews: "Reviews",
  qa: "QA & Testing",
  production: "Production",
  release: "Release",
  "creative-content": "Creative & Content",
};

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [invoking, setInvoking] = useState(false);
  const [invokeSuccess, setInvokeSuccess] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "team" | "solo">("all");

  useEffect(() => {
    const loadSkills = async () => {
      try {
        const data = await apiFetch<Skill[]>("/api/skills");
        setSkills(data);
      } catch (error) {
        console.error("Failed to load skills:", error);
      } finally {
        setLoading(false);
      }
    };
    loadSkills();

    // Create or get session
    const initSession = async () => {
      try {
        const sessions = await apiFetch<{ sessions: Record<string, unknown>; currentSessionId: string }>(
          "/api/chat/sessions"
        );
        setSessionId(sessions.currentSessionId);
      } catch (error) {
        console.error("Failed to get session:", error);
      }
    };
    initSession();
  }, []);

  const getSkillCategory = (skill: Skill): string => {
    if (skill.name.startsWith("start") || skill.name.startsWith("help") || skill.name.startsWith("setup")) {
      return "onboarding";
    } else if (skill.name.startsWith("ux-")) {
      return "ux-design";
    } else if (skill.name.startsWith("create-architecture") || skill.name.startsWith("architecture")) {
      return "architecture";
    } else if (skill.name.startsWith("create-") && (skill.name.includes("epic") || skill.name.includes("story") || skill.name.includes("sprint"))) {
      return "stories-sprints";
    } else if (skill.name.includes("-review") || skill.name === "design-review" || skill.name === "code-review") {
      return "reviews";
    } else if (skill.name.startsWith("test") || skill.name.startsWith("qa-") || skill.name === "smoke-check") {
      return "qa";
    } else if (skill.name.startsWith("milestone") || skill.name === "retrospective" || skill.name.startsWith("bug")) {
      return "production";
    } else if (skill.name.startsWith("release") || skill.name.startsWith("launch") || skill.name.includes("-checklist")) {
      return "release";
    } else if (skill.name.startsWith("team-")) {
      return "team";
    }
    return "design";
  };

  const categorizeSkills = () => {
    const categorized: Record<string, Skill[]> = {};
    skills.forEach((skill) => {
      const cat = getSkillCategory(skill);
      if (!categorized[cat]) categorized[cat] = [];
      categorized[cat].push(skill);
    });
    return categorized;
  };

  const filteredSkills = skills.filter((skill) => {
    const matchesSearch =
      skill.name.toLowerCase().includes(search.toLowerCase()) ||
      skill.description.toLowerCase().includes(search.toLowerCase());
    const skillCategory = getSkillCategory(skill);
    const matchesCategory = category === "all" || category === skillCategory;
    const isTeamSkill = skill.name.startsWith("team-");
    const matchesTab =
      activeTab === "all" ||
      (activeTab === "team" && isTeamSkill) ||
      (activeTab === "solo" && !isTeamSkill);
    return matchesSearch && matchesCategory && matchesTab;
  });

  const handleInvoke = async (skill: Skill) => {
    if (!sessionId) {
      alert("No session available. Please refresh the page.");
      return;
    }
    setInvoking(true);
    setInvokeSuccess(false);
    try {
      await apiFetch<{ skillId: string; status: string }>(`/api/skills/${skill.name}/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, reviewMode: "lean" }),
      });
      setInvokeSuccess(true);
      setTimeout(() => setInvokeSuccess(false), 3000);
    } catch (error) {
      console.error("Failed to invoke skill:", error);
      alert(`Failed to invoke skill: ${error}`);
    } finally {
      setInvoking(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-black border-t-primary animate-spin mx-auto mb-4" />
          <span className="font-[var(--font-terminal)] text-sm uppercase text-outline">
            Loading skills...
          </span>
        </div>
      </div>
    );
  }

  const categorized = categorizeSkills();

  return (
    <div className="h-full overflow-hidden flex flex-col">
      {/* Header */}
      <div className="border-b-2 border-black bg-white px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-[var(--font-terminal)] text-2xl font-bold uppercase tracking-wider">
            Skills Library
          </h1>
          <div className="text-sm font-[var(--font-terminal)] text-outline">
            {filteredSkills.length} skills
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search skills..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-4 py-2 border-2 border-black font-[var(--font-terminal)] text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {["all", "team", "solo"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as "all" | "team" | "solo")}
                className={`px-4 py-2 border-2 border-black font-[var(--font-terminal)] text-sm uppercase ${
                  activeTab === tab ? "bg-black text-white" : "bg-white text-black hover:bg-gray-100"
                }`}
              >
                {tab === "all" ? "All" : tab === "team" ? "Team Skills" : "Solo Skills"}
              </button>
            ))}
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex gap-2 mt-4 overflow-x-auto pb-2">
          <button
            onClick={() => setCategory("all")}
            className={`px-3 py-1 border-2 border-black font-[var(--font-terminal)] text-xs whitespace-nowrap ${
              category === "all" ? "bg-black text-white" : "bg-white text-black"
            }`}
          >
            All ({skills.length})
          </button>
          {Object.entries(categorized)
            .filter(([cat]) => cat !== "team")
            .map(([cat, catSkills]) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3 py-1 border-2 border-black font-[var(--font-terminal)] text-xs whitespace-nowrap ${
                  category === cat ? "bg-black text-white" : "bg-white text-black"
                }`}
              >
                {CATEGORY_LABELS[cat] || cat} ({catSkills.length})
              </button>
            ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSkills.map((skill) => (
            <div
              key={skill.name}
              onClick={() => setSelectedSkill(skill)}
              className={`border-2 border-black p-4 cursor-pointer transition-all hover:shadow-[4px_4px_0_0_rgba(0,0,0,1)] ${
                selectedSkill?.name === skill.name ? "bg-gray-50" : "bg-white"
              } ${skill.name.startsWith("team-") ? "border-l-4 border-l-blue-500" : ""}`}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-[var(--font-terminal)] font-bold text-sm uppercase">
                  {skill.name}
                </h3>
                {skill.name.startsWith("team-") && (
                  <span className="text-xs px-2 py-0.5 bg-blue-100 border border-blue-400 text-blue-900 font-[var(--font-terminal)]">
                    TEAM
                  </span>
                )}
              </div>
              <p className="text-xs text-outline font-[var(--font-label)] line-clamp-2 mb-3">
                {skill.description}
              </p>
              <div className="flex items-center justify-between">
                <div className="text-xs font-[var(--font-terminal)] text-outline">
                  {skill.phases.length} phases
                  {skill.gates && skill.gates.length > 0 && (
                    <span className="ml-2 text-orange-600">• {skill.gates.length} gates</span>
                  )}
                </div>
                {skill.phases.length > 0 && (
                  <span className="material-symbols-outlined text-xs text-outline">
                    chevron_right
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail Panel */}
      {selectedSkill && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setSelectedSkill(null)}
        >
          <div
            className="bg-white border-2 border-black w-full max-w-3xl max-h-[85vh] overflow-y-auto shadow-[8px_8px_0_0_rgba(0,0,0,1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b-2 border-black bg-gray-50 p-4 flex items-center justify-between sticky top-0">
              <h2 className="font-[var(--font-terminal)] text-xl font-bold uppercase">
                {selectedSkill.name}
              </h2>
              <div className="flex items-center gap-4">
                {selectedSkill.name.startsWith("team-") && (
                  <span className="text-xs px-3 py-1 bg-blue-100 border border-blue-400 text-blue-900 font-[var(--font-terminal)]">
                    TEAM SKILL
                  </span>
                )}
                <button
                  onClick={() => setSelectedSkill(null)}
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
                <p className="font-[var(--font-label)] text-sm">{selectedSkill.description}</p>
              </div>

              {/* Team Members */}
              {selectedSkill.teamMembers && selectedSkill.teamMembers.length > 0 && (
                <div>
                  <h3 className="font-[var(--font-terminal)] text-xs uppercase text-outline mb-2">
                    Team Members
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedSkill.teamMembers.map((member) => (
                      <span
                        key={member}
                        className="text-xs px-3 py-1 bg-gray-100 border border-gray-300 font-[var(--font-terminal)]"
                      >
                        {member.replace(/-/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Phases */}
              {selectedSkill.phases.length > 0 && (
                <div>
                  <h3 className="font-[var(--font-terminal)] text-xs uppercase text-outline mb-3">
                    Phases ({selectedSkill.phases.length})
                  </h3>
                  <div className="space-y-3">
                    {selectedSkill.phases.map((phase) => (
                      <div
                        key={phase.order}
                        className="border border-gray-300 p-3 bg-gray-50"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="w-6 h-6 flex items-center justify-center bg-black text-white text-xs font-[var(--font-terminal)]">
                            {phase.order}
                          </span>
                          <h4 className="font-[var(--font-terminal)] font-bold text-sm">
                            {phase.name}
                          </h4>
                          {phase.parallel && (
                            <span className="text-xs px-2 py-0.5 bg-purple-100 border border-purple-400 text-purple-900 font-[var(--font-terminal)]">
                              PARALLEL
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-outline font-[var(--font-label)] mb-2">
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
                        {phase.gates && phase.gates.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {phase.gates.map((gate) => (
                              <span
                                key={gate}
                                className="text-xs px-2 py-0.5 bg-orange-100 border border-orange-400 text-orange-900 font-[var(--font-terminal)]"
                              >
                                {gate}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Gates */}
              {selectedSkill.gates && selectedSkill.gates.length > 0 && (
                <div>
                  <h3 className="font-[var(--font-terminal)] text-xs uppercase text-outline mb-2">
                    Required Gates
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedSkill.gates.map((gate) => (
                      <span
                        key={gate}
                        className="text-xs px-3 py-1 bg-orange-100 border border-orange-400 text-orange-900 font-[var(--font-terminal)]"
                      >
                        {gate}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Invoke Button */}
              <div className="pt-4 border-t-2 border-black">
                <button
                  onClick={() => handleInvoke(selectedSkill)}
                  disabled={invoking || !sessionId}
                  className={`w-full py-3 border-2 border-black font-[var(--font-terminal)] font-bold uppercase text-sm transition-all ${
                    invokeSuccess
                      ? "bg-green-500 text-white border-green-500"
                      : invoking
                      ? "bg-gray-100 cursor-wait"
                      : !sessionId
                      ? "bg-gray-100 cursor-not-allowed"
                      : "bg-primary text-white hover:bg-primary/90"
                  }`}
                >
                  {invokeSuccess
                    ? "✓ Skill Invoked"
                    : invoking
                    ? "Invoking..."
                    : !sessionId
                    ? "No Session"
                    : "Invoke Skill"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
