"use client";

import { memo } from "react";
import type { ChatMessage } from "@/hooks/useCommandRoom";
import type { WorkflowStage } from "@game-studio/types";

const STAGE_ORDER: WorkflowStage[] = ["plan", "decompose", "execute", "verify", "fix"];

const STAGE_LABELS: Record<WorkflowStage, string> = {
  plan: "PLAN",
  decompose: "DECOMPOSE",
  execute: "EXECUTE",
  verify: "VERIFY",
  fix: "FIX",
};

const STAGE_ICONS: Record<WorkflowStage, string> = {
  plan: "lightbulb",
  decompose: "account_tree",
  execute: "rocket_launch",
  verify: "verified",
  fix: "build",
};

const WorkflowMessage = memo(function WorkflowMessage({ msg }: { msg: ChatMessage }) {
  const wf = msg.workflow;
  if (!wf) return null;

  const currentIdx = STAGE_ORDER.indexOf(wf.currentStage as WorkflowStage);

  return (
    <div className="my-3 px-8">
      <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] max-w-3xl">
        {/* Header */}
        <div className="bg-black p-2 flex items-center gap-3">
          <span className="material-symbols-outlined text-white text-sm">account_tree</span>
          <span className="font-[var(--font-terminal)] text-xs font-bold uppercase text-white tracking-wider">
            WORKFLOW PIPELINE
          </span>
          <span className="font-[var(--font-terminal)] text-[10px] text-[#737688] ml-auto">
            {wf.workflowId}
          </span>
        </div>

        {/* Pipeline Steps */}
        <div className="p-4">
          <div className="flex items-center gap-1">
            {STAGE_ORDER.map((stage, idx) => {
              const step = wf.steps.find((s) => s.stage === stage);
              const isCurrent = stage === wf.currentStage;
              const isDone = currentIdx > idx || step?.status === "completed";
              const isActive = isCurrent && step?.status !== "completed";

              return (
                <div key={stage} className="flex items-center gap-1 flex-1">
                  {/* Step */}
                  <div className={`flex flex-col items-center gap-1 flex-1 ${
                    isDone ? "text-[#2ECC71]" : isActive ? "text-[#0055FF]" : "text-[#737688]"
                  }`}>
                    <div className={`w-8 h-8 border-2 border-black flex items-center justify-center relative ${
                      isDone
                        ? "bg-[#2ECC71] text-white"
                        : isActive
                        ? "bg-[#0055FF] text-white animate-pulse"
                        : "bg-[#e7e7f5] text-[#737688]"
                    }`}>
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                        {isDone ? "check" : STAGE_ICONS[stage]}
                      </span>
                    </div>
                    <span className="font-[var(--font-label)] text-[9px] font-bold uppercase">
                      {STAGE_LABELS[stage]}
                    </span>
                    {step?.agentRole && (
                      <span className="font-[var(--font-terminal)] text-[8px] text-[#434656]">
                        {step.agentRole.replace(/-/g, " ")}
                      </span>
                    )}
                  </div>

                  {/* Connector arrow */}
                  {idx < STAGE_ORDER.length - 1 && (
                    <div className={`w-4 h-[2px] mb-4 ${
                      isDone ? "bg-[#2ECC71]" : "bg-[#d9d9e6]"
                    }`} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Linked Tickets */}
          {wf.steps.some((s) => s.ticketId) && (
            <div className="mt-3 border-t-2 border-black pt-2">
              <span className="font-[var(--font-label)] text-[9px] uppercase text-[#434656] tracking-widest block mb-1">
                Linked Quests
              </span>
              <div className="flex flex-wrap gap-2">
                {wf.steps.filter((s) => s.ticketId).map((step) => (
                  <a
                    key={step.ticketId}
                    href={`/tickets`}
                    className="border-2 border-black bg-[#f3f2ff] px-2 py-1 font-[var(--font-terminal)] text-[10px] hover:bg-[#0055FF] hover:text-white transition-colors inline-flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 12 }}>quest</span>
                    {step.ticketId?.replace("ticket-", "#")}
                    {step.agentRole && ` → ${step.agentRole.replace(/-/g, " ")}`}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default WorkflowMessage;
