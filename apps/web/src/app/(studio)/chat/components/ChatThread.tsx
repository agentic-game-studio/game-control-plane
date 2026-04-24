"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/hooks/useCommandRoom";
import { getAgentIcon } from "@/lib/agent-icons";

interface ChatThreadProps {
  messages: ChatMessage[];
  threadId: string;
  threadTitle: string;
  currentSession: string;
  onDecision: (action: string, sender: string) => void;
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
            <p className="font-[var(--font-terminal)] text-base">{msg.content}</p>

            {msg.type === "progress" && msg.progress !== undefined && (
              <div className="mt-4 border-2 border-black p-1 bg-[#f3f2ff] flex items-center gap-2">
                <span className="material-symbols-outlined animate-spin text-sm">sync</span>
                <div className="flex-1 h-3 border border-black bg-white">
                  <div className="h-full bg-[#0055FF] transition-all duration-500" style={{ width: `${msg.progress}%` }} />
                </div>
                <span className="font-[var(--font-terminal)] text-xs">{msg.progress}%</span>
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
            <p className="font-[var(--font-terminal)] text-base">{msg.content}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DiffMessage({ msg }: { msg: ChatMessage }) {
  if (!msg.diffBlocks?.length) return null;

  return (
    <div className="my-4 px-8">
      <div className="border-2 border-black bg-[#1e1e1e] shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
        <div className="bg-[#2d2d2d] border-b border-[#404040] px-4 py-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-sm text-[#a0a0a0]">description</span>
          <span className="font-[var(--font-terminal)] text-xs text-[#a0a0a0] uppercase">
            {msg.diffBlocks.length} file(s) changed
          </span>
        </div>
        {msg.diffBlocks.map((block, bi) => (
          <div key={bi} className="border-b border-[#404040] last:border-b-0">
            <div className="bg-[#2d2d2d] px-4 py-1 text-[#e0e0e0] font-[var(--font-terminal)] text-xs border-b border-[#404040]">
              {block.filePath}
            </div>
            {block.hunks.map((hunk, hi) => (
              <div key={hi} className="font-mono text-xs">
                {hunk.lines.map((line, li) => (
                  <div
                    key={li}
                    className={`px-4 py-0.5 flex ${
                      hunk.type === "add"
                        ? "bg-[#1c3a1c] text-[#7ec67e]"
                        : hunk.type === "remove"
                          ? "bg-[#3a1c1c] text-[#e06c75]"
                          : "bg-transparent text-[#a0a0a0]"
                    }`}
                  >
                    <span className="w-12 text-right pr-4 text-[#606060] select-none">
                      {hunk.lineNum ? hunk.lineNum + li : ""}
                    </span>
                    <span className="w-6 text-right pr-2 select-none">
                      {hunk.type === "add" ? "+" : hunk.type === "remove" ? "-" : " "}
                    </span>
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function NavigateMessage({ msg }: { msg: ChatMessage }) {
  if (!msg.navigate) return null;

  return (
    <div className="flex justify-center my-4 px-8">
      <button className="border-2 border-[#0055FF] bg-white px-6 py-3 font-[var(--font-label)] text-xs font-bold uppercase text-[#0055FF] hover:bg-[#0055FF] hover:text-white retro-press flex items-center gap-3 shadow-[2px_2px_0_0_rgba(0,85,255,1)] transition-colors">
        <span className="material-symbols-outlined text-sm">arrow_forward</span>
        {msg.navigate.label}
      </button>
    </div>
  );
}

export default function ChatThread({ messages, threadId, threadTitle, currentSession, onDecision }: ChatThreadProps) {
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
              return <DiffMessage key={msg.id} msg={msg} />;
            case "navigate":
              return <NavigateMessage key={msg.id} msg={msg} />;
            default:
              return null;
          }
        })}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
