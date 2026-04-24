"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/hooks/useCommandRoom";
import { getAgentIcon } from "@/lib/agent-icons";
import { renderMarkdown } from "@/lib/markdown";
import DiffView from "./DiffView";
import QuestionMessage from "./QuestionMessage";
import PlanMessage from "./PlanMessage";

interface ChatThreadProps {
  messages: ChatMessage[];
  threadId: string;
  threadTitle: string;
  currentSession: string;
  onDecision: (action: string, sender: string) => void;
  onNavigate?: (targetSession: string) => void;
  onAnswer?: (questionId: string, selected: string[], customInput?: string) => void;
  onPlanAction?: (phaseId: string, action: "execute" | "execute-all") => void;
}

const TOOL_ICONS: Record<string, string> = {
  Read: "description",
  Write: "edit_note",
  Edit: "edit",
  Glob: "folder_open",
  Grep: "search",
  Bash: "terminal",
  Task: "group",
  AskUserQuestion: "help",
};

const TOOL_COLORS: Record<string, string> = {
  Read: "#0055FF",
  Write: "#df2b31",
  Edit: "#c13301",
  Glob: "#737688",
  Grep: "#737688",
  Bash: "#191b25",
  Task: "#0055FF",
  AskUserQuestion: "#c13301",
};

function ImageGallery({ images }: { images?: string[] }) {
  if (!images || images.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 mt-3">
      {images.map((src, i) => (
        <div key={i} className="border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] overflow-hidden inline-block">
          <img src={src} alt={`Attachment ${i + 1}`} className="max-w-full max-h-64 object-contain" loading="lazy" />
        </div>
      ))}
    </div>
  );
}

function SystemMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="flex justify-center my-2 px-8">
      <div className="bg-[#e7e7f5] border-2 border-black px-5 py-1.5 text-center">
        <span className="font-[var(--font-terminal)] text-xs uppercase text-[#434656]">
          {msg.content}
        </span>
      </div>
    </div>
  );
}

function WelcomeMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="my-6 px-8">
      <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] max-w-2xl">
        <div className="bg-black p-3 flex items-center gap-3">
          <span className="material-symbols-outlined text-white">stadia_controller</span>
          <span className="font-[var(--font-terminal)] text-sm font-bold uppercase text-white tracking-wider">
            GAME DIRECTOR ONLINE
          </span>
        </div>
        <div className="p-5">
          <p className="font-[var(--font-terminal)] text-base mb-4">
            Welcome, Director. Game Director is online and ready to orchestrate your team.
          </p>
          <div className="border-2 border-black bg-[#f3f2ff] p-4">
            <span className="font-[var(--font-label)] text-[10px] uppercase text-[#434656] tracking-widest block mb-3">Quick Reference</span>
            <div className="space-y-2 font-[var(--font-terminal)] text-sm text-[#434656]">
              <div className="flex gap-3 items-baseline">
                <code className="text-[#0055FF] font-bold bg-white border border-black px-2 py-0.5 text-xs whitespace-nowrap">spawn &lt;agent&gt;</code>
                <span>Bring an agent online</span>
              </div>
              <div className="flex gap-3 items-baseline">
                <code className="text-[#0055FF] font-bold bg-white border border-black px-2 py-0.5 text-xs whitespace-nowrap">approve</code>
                <span>Approve last agent&apos;s request</span>
              </div>
              <div className="flex gap-3 items-baseline">
                <code className="text-[#0055FF] font-bold bg-white border border-black px-2 py-0.5 text-xs whitespace-nowrap">done &lt;agent&gt;</code>
                <span>Despawn an agent</span>
              </div>
            </div>
          </div>
          <span className="font-[var(--font-terminal)] text-[10px] text-[#737688] block mt-3 text-right">
            {msg.timestamp} UTC
          </span>
        </div>
      </div>
    </div>
  );
}

function AgentMessage({ msg, onDecision }: { msg: ChatMessage; onDecision: (action: string, sender: string) => void }) {
  const icon = getAgentIcon(msg.sender);
  const label = msg.sender.replace(/-/g, "_").toUpperCase();
  const isProgress = msg.type === "progress";

  const toolCalls = msg.toolCalls;

  return (
    <div className="flex gap-4 w-full max-w-4xl self-start">
      <div className="w-12 h-12 shrink-0 border-2 border-black bg-[#0055FF] flex justify-center items-center text-white shadow-[2px_2px_0_0_rgba(0,0,0,1)] relative z-10">
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <div className="flex-1">
        <div className="flex items-baseline gap-3 mb-1 ml-2">
          <span className="font-[var(--font-label)] text-xs font-bold uppercase">{label}</span>
          <span className="font-[var(--font-terminal)] text-[10px] text-[#737688]">{msg.timestamp}</span>
        </div>
        <div className="relative group">
          <div className="absolute left-[-10px] top-4 w-0 h-0 border-y-[6px] border-y-transparent border-r-[10px] border-r-black z-0" />
          <div className="absolute left-[-6px] top-[18px] w-0 h-0 border-y-[4px] border-y-transparent border-r-[8px] border-r-white z-10" />
          <div className="border-2 border-black bg-white p-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)] relative z-10">
            {msg.codeBlock && (
              <div className="bg-[#e1e1ef] border-2 border-black p-3 font-[var(--font-terminal)] text-sm mb-4">
                <span className="text-[#df2b31] block mb-1">// Code Output</span>
                <code className="whitespace-pre-wrap">{msg.codeBlock}</code>
              </div>
            )}
            <div
              className="font-[var(--font-terminal)] text-base prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
            />
            <ImageGallery images={msg.images} />

            {/* Rich progress message */}
            {isProgress && msg.progress !== undefined && (
              <div className="mt-4 border-2 border-black bg-[#f3f2ff]">
                <div className="p-1 flex items-center gap-2">
                  <span className="material-symbols-outlined animate-spin text-sm">sync</span>
                  <div className="flex-1 h-3 border border-black bg-white">
                    <div className="h-full bg-[#0055FF] transition-all duration-500" style={{ width: `${msg.progress}%` }} />
                  </div>
                  <span className="font-[var(--font-terminal)] text-xs">{msg.progress}%</span>
                </div>

                {msg.thinking && (
                  <div className="border-t border-black px-3 py-2 bg-[#faf8ff]">
                    <span className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest block mb-1">Thinking</span>
                    <span className="font-[var(--font-terminal)] text-xs text-[#737688]">{msg.thinking}</span>
                  </div>
                )}

                {toolCalls && toolCalls.length > 0 && (
                  <div className="border-t-2 border-black bg-white">
                    <div className="px-3 py-1 bg-black">
                      <span className="font-[var(--font-label)] text-[10px] uppercase text-white tracking-widest">Activity</span>
                    </div>
                    <div className="divide-y divide-[#e1e1ef]">
                      {toolCalls.map((tc, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                          <span className="material-symbols-outlined text-sm" style={{ color: TOOL_COLORS[tc.name] ?? '#737688' }}>
                            {TOOL_ICONS[tc.name] ?? 'build'}
                          </span>
                          <span className="font-[var(--font-terminal)] text-xs flex-1 truncate">
                            {tc.name} {Object.values(tc.args)[0] ? `· ${String(Object.values(tc.args)[0]).slice(0, 40)}` : ''}
                          </span>
                          <span className="font-[var(--font-terminal)] text-[10px] uppercase px-1.5 py-0.5 border border-black bg-[#e7e7f5] text-[#191b25]">
                            {tc.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!isProgress && msg.thinking && (
              <div className="mt-3 border border-[#e1e1ef] bg-[#faf8ff] p-2">
                <span className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest block mb-1">Thinking</span>
                <span className="font-[var(--font-terminal)] text-xs text-[#737688]">{msg.thinking}</span>
              </div>
            )}

            <div className="absolute -right-3 -top-3 opacity-0 group-hover:opacity-100 transition-opacity">
              <button className="w-8 h-8 border-2 border-black bg-black text-white hover:bg-[#0055FF] flex justify-center items-center retro-press" title="Trace Thought Process">
                <span className="material-symbols-outlined text-sm">search</span>
              </button>
            </div>
          </div>
        </div>

        {msg.showActions && (
          <div className="mt-4 flex gap-4 ml-2">
            <button
              onClick={() => onDecision("approve", msg.sender)}
              className="border-2 border-black bg-[#0055FF] text-white px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-black hover:text-white retro-press flex items-center gap-2 shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors"
            >
              <span className="material-symbols-outlined text-sm">check_circle</span>
              [APPROVE]
            </button>
            <button
              onClick={() => onDecision("override", msg.sender)}
              className="border-2 border-black bg-white text-black px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-black hover:text-white retro-press flex items-center gap-2 shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors"
            >
              <span className="material-symbols-outlined text-sm">edit</span>
              [OVERRIDE]
            </button>
            <button
              onClick={() => onDecision("pause", msg.sender)}
              className="border-2 border-black bg-white text-black px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-black hover:text-white retro-press flex items-center gap-2 shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors"
            >
              <span className="material-symbols-outlined text-sm">pause</span>
              [PAUSE]
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function UserMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="flex gap-4 w-full max-w-3xl self-end flex-row-reverse mt-4">
      <div className="w-12 h-12 shrink-0 border-2 border-black bg-black relative z-10 shadow-[-2px_2px_0_0_rgba(0,85,255,1)]" />
      <div className="flex-1 flex flex-col items-end">
        <div className="flex items-baseline gap-3 mb-1 mr-2 flex-row-reverse">
          <span className="font-[var(--font-label)] text-xs font-bold uppercase text-[#0055FF]">DIRECTOR (YOU)</span>
          <span className="font-[var(--font-terminal)] text-[10px] text-[#737688]">{msg.timestamp}</span>
        </div>
        <div className="relative group">
          <div className="absolute right-[-10px] top-4 w-0 h-0 border-y-[6px] border-y-transparent border-l-[10px] border-l-black z-0" />
          <div className="absolute right-[-6px] top-[18px] w-0 h-0 border-y-[4px] border-y-transparent border-l-[8px] border-l-[#dce1ff] z-10" />
          <div className="border-2 border-black bg-[#dce1ff] p-3 shadow-[-4px_4px_0_0_rgba(0,0,0,1)] relative z-10 text-right">
            <div
              className="font-[var(--font-terminal)] text-base prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
            />
            <ImageGallery images={msg.images} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DiffMessage({ msg, onNavigate }: { msg: ChatMessage; onNavigate?: (target: string) => void }) {
  const icon = getAgentIcon(msg.sender);
  const label = msg.sender.replace(/-/g, "_").toUpperCase();

  // Handle both old format (msg.diff) and new format (msg.diffBlocks)
  if (!msg.diff) return null;

  return (
    <div className="flex gap-4 w-full max-w-4xl self-start">
      <div className="w-12 h-12 shrink-0 border-2 border-black bg-[#0055FF] flex justify-center items-center text-white shadow-[2px_2px_0_0_rgba(0,0,0,1)] relative z-10">
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <div className="flex-1">
        <div className="flex items-baseline gap-3 mb-1 ml-2">
          <span className="font-[var(--font-label)] text-xs font-bold uppercase">{label}</span>
          <span className="font-[var(--font-terminal)] text-[10px] text-[#737688]">{msg.timestamp}</span>
        </div>
        <DiffView
          oldContent={msg.diff.oldContent}
          newContent={msg.diff.newContent}
          filePath={msg.diff.filePath}
        />
      </div>
    </div>
  );
}

function NavigateMessage({ msg, onNavigate }: { msg: ChatMessage; onNavigate?: (targetSession: string) => void }) {
  const target = msg.navigate?.targetSession ?? msg.navigateTo;
  if (!target) return null;

  const handleClick = () => {
    if (onNavigate) {
      onNavigate(target);
    }
  };

  return (
    <div className="flex justify-center my-4 px-8">
      <button
        onClick={handleClick}
        className="border-2 border-[#0055FF] bg-white px-6 py-3 font-[var(--font-label)] text-xs font-bold uppercase text-[#0055FF] hover:bg-[#0055FF] hover:text-white retro-press flex items-center gap-3 shadow-[2px_2px_0_0_rgba(0,85,255,1)] transition-colors"
      >
        <span className="material-symbols-outlined text-sm">arrow_forward</span>
        {msg.navigate?.label ?? msg.content ?? "Navigate"}
      </button>
    </div>
  );
}

export default function ChatThread({ messages, threadId, threadTitle, currentSession, onDecision, onNavigate, onAnswer, onPlanAction }: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sessionLabel = currentSession === "game-director"
    ? "BOARD_ROOM"
    : currentSession.replace(/-/g, "_").toUpperCase();

  return (
    <section className="flex-1 flex flex-col bg-[#faf8ff] relative z-0">
      {/* Header */}
      <div className="h-14 border-b-2 border-black bg-white flex items-center justify-between px-6 shrink-0 z-20">
        <div className="flex items-center gap-4">
          <span className="material-symbols-outlined">{currentSession === "game-director" ? "forum" : "smart_toy"}</span>
          <h2 className="font-[var(--font-terminal)] text-base font-bold uppercase tracking-widest">
            {sessionLabel}
          </h2>
          {currentSession !== "game-director" && (
            <span className="font-[var(--font-label)] text-[10px] uppercase bg-[#e7e7f5] px-2 py-1 border border-black">
              Agent Session
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-[var(--font-label)] text-xs bg-[#e7e7f5] px-2 py-1 border-2 border-black">
            ID: {threadId}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 pb-32">
        {messages.map((msg) => {
          switch (msg.type) {
            case "system":
              return <SystemMessage key={msg.id} msg={msg} />;
            case "welcome":
              return <WelcomeMessage key={msg.id} msg={msg} />;
            case "agent":
              return <AgentMessage key={msg.id} msg={msg} onDecision={onDecision} />;
            case "user":
              return <UserMessage key={msg.id} msg={msg} />;
            case "progress":
              return <AgentMessage key={msg.id} msg={msg} onDecision={onDecision} />;
            case "diff":
              return <DiffMessage key={msg.id} msg={msg} onNavigate={onNavigate} />;
            case "navigate":
              return <NavigateMessage key={msg.id} msg={msg} onNavigate={onNavigate} />;
            case "question":
              return onAnswer ? <QuestionMessage key={`${msg.id}-${msg.question?.questionId}`} msg={msg} onAnswer={onAnswer} sender={msg.sender} /> : null;
            case "plan":
              return onPlanAction ? <PlanMessage key={`${msg.id}-plan`} msg={msg} onPlanAction={onPlanAction} sender={msg.sender} /> : null;
            default:
              return null;
          }
        })}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
