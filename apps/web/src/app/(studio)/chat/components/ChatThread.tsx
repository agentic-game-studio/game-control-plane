"use client";

import { useEffect, useRef, useMemo, memo, useCallback, useState } from "react";
import type { ChatMessage, AgentSession } from "@/hooks/useCommandRoom";
import { getAgentIcon } from "@/lib/agent-icons";
import { renderMarkdown } from "@/lib/markdown";
import { formatTime } from "@/lib/format-time";
import DiffView from "./DiffView";
import QuestionMessage from "./QuestionMessage";
import PlanMessage from "./PlanMessage";
import WorkflowMessage from "./WorkflowMessage";
import { COMMANDS } from "./CommandInput";

interface ChatThreadProps {
  messages: ChatMessage[];
  sessions: Map<string, AgentSession>;
  threadId: string;
  threadTitle: string;
  currentSession: string;
  connected?: boolean;
  onDecision: (action: string, sender: string) => void;
  onNavigate?: (targetSession: string) => void;
  onAnswer?: (questionId: string, selected: string[], customInput?: string) => void;
  onPlanAction?: (phaseId: string, action: "execute" | "execute-all") => void;
  onSamplePrompt?: (prompt: string) => void;
}

const SAMPLE_PROMPTS: { icon: string; label: string; prompt: string }[] = [
  {
    icon: "swords",
    label: "Help with game design",
    prompt: "Help me think through the game design for this project and propose clear next steps.",
  },
  {
    icon: "architecture",
    label: "Review project now",
    prompt: "Review the current project status across design, implementation, and risks, then recommend priorities.",
  },
  {
    icon: "checklist",
    label: "Check task status",
    prompt: "Check task and ticket status for this project, summarize what is in progress, blocked, and completed.",
  },
];

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

/** Default color for tools missing from TOOL_COLORS. Mirrors the
 * chrome/secondary text color used elsewhere so unknown tools blend
 * in rather than jumping out as "broken". Centralized so the value
 * stays in sync between the tool pill and any future call site. */
const DEFAULT_TOOL_COLOR = "#737688";

function getToolColor(name: string): string {
  return TOOL_COLORS[name] ?? DEFAULT_TOOL_COLOR;
}

function truncateArg(str: string, maxLen: number): string {
  // Split at word boundary or path separator for cleaner truncation
  const splitPoints = str.match(/[/\\. _-]/g) || [];
  if (str.length <= maxLen) return str;
  // Try to truncate at last split point before maxLen
  let cutoff = maxLen;
  for (let i = maxLen - 1; i > 0; i--) {
    if (/[/\\. _-]/.test(str[i])) { cutoff = i + 1; break; }
  }
  return str.slice(0, cutoff) + '…';
}

/* ─── Activity Log (collapsible tool calls) ─── */

interface ActivityLogProps {
  toolCalls: Array<{ name: string; args: Record<string, unknown>; status: string }>;
  logs?: string[];
  defaultExpanded?: boolean;
}

type LogEntry =
  | { kind: "tool"; name: string; args: Record<string, unknown>; status: string }
  | { kind: "log"; text: string };

const ActivityLog = memo(function ActivityLog({ toolCalls, logs, defaultExpanded = false }: ActivityLogProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const entries: LogEntry[] = useMemo(() => {
    const combined: LogEntry[] = [
      ...toolCalls.map((tc) => ({ kind: "tool" as const, ...tc })),
      ...(logs ?? []).map((text) => ({ kind: "log" as const, text })),
    ];
    return combined.reverse();
  }, [toolCalls, logs]);

  const totalCount = toolCalls.length + (logs?.length ?? 0);
  const previewEntries = entries.slice(0, 3);

  return (
    <div className="mt-4 border-2 border-black bg-white shadow-[2px_2px_0_0_rgba(0,0,0,1)] min-w-0 max-w-full">
      {/* Header bar */}
      <button
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        // 14-FH6-activity-aria: aria-expanded announces collapsed/
        // expanded state to screen readers (matches the WAI-ARIA
        // disclosure pattern). aria-controls wires the button to the
        // region it toggles so SR users can navigate to the content.
        aria-controls="activity-log-panel"
        className="w-full px-3 py-1.5 bg-black flex items-center gap-2 hover:bg-[#191b25] transition-colors"
      >
        <span className="material-symbols-outlined text-white text-sm">
          {expanded ? "expand_less" : "expand_more"}
        </span>
        <span className="font-[var(--font-label)] text-[10px] uppercase text-white tracking-widest">
          Activity
        </span>
        <span className="ml-auto font-[var(--font-terminal)] text-[10px] text-white/70">
          {totalCount} {totalCount === 1 ? "entry" : "entries"}
        </span>
      </button>

      {/* Collapsed: show 3 latest entries */}
      {!expanded && previewEntries.length > 0 && (
        <div id="activity-log-panel" className="divide-y divide-[#e1e1ef]">
          {previewEntries.map((entry, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 min-w-0">
              {entry.kind === "tool" ? (
                <>
                  <span
                    className="material-symbols-outlined text-sm shrink-0"
                    style={{ color: getToolColor(entry.name) }}
                  >
                    {TOOL_ICONS[entry.name] ?? "build"}
                  </span>
                  <span className="font-[var(--font-terminal)] text-xs flex-1 min-w-0 truncate">
                    {entry.name}{" "}
                    {Object.values(entry.args)[0]
                      ? `· ${truncateArg(String(Object.values(entry.args)[0]), 100)}`
                      : ""}
                  </span>
                  <span className="font-[var(--font-terminal)] text-[10px] uppercase px-1.5 py-0.5 border border-black bg-[#e7e7f5] text-[#191b25]">
                    {entry.status}
                  </span>
                </>
              ) : (
                <span className="font-[var(--font-terminal)] text-xs text-[#737688] flex-1 min-w-0 truncate">
                  {entry.text}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Expanded: all entries in reverse order (newest first) */}
      {expanded && (
        <div id="activity-log-panel" className="divide-y divide-[#e1e1ef]">
          {entries.map((entry, i) =>
            entry.kind === "tool" ? (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 min-w-0">
                <span
                  className="material-symbols-outlined text-sm shrink-0"
                  style={{ color: getToolColor(entry.name) }}
                >
                  {TOOL_ICONS[entry.name] ?? "build"}
                </span>
                <span className="font-[var(--font-terminal)] text-xs flex-1 min-w-0 truncate">
                  {entry.name}{" "}
                  {Object.values(entry.args)[0]
                    ? `· ${truncateArg(String(Object.values(entry.args)[0]), 100)}`
                    : ""}
                </span>
                <span className="font-[var(--font-terminal)] text-[10px] uppercase px-1.5 py-0.5 border border-black bg-[#e7e7f5] text-[#191b25]">
                  {entry.status}
                </span>
              </div>
            ) : (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 min-w-0">
                <span className="material-symbols-outlined text-sm shrink-0 text-[#a0a0b0]">notes</span>
                <span className="font-[var(--font-terminal)] text-xs text-[#737688] flex-1 min-w-0 truncate">
                  {entry.text}
                </span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
});

/* ─── Memoized Message Components ─── */

const ImageGallery = memo(function ImageGallery({ images }: { images?: string[] }) {
  if (!images || images.length === 0) return null;
  // 12-C3: only render allowlisted URL schemes. The producer chat lets
  // users paste arbitrary content, and a malicious paste of e.g.
  // `data:text/html,<script>...</script>` would otherwise render as an
  // <img> whose `src` browsers may treat as a navigation target on
  // right-click / drag-out. Allow only http(s), blob:, and data:image/*.
  // Anything else is silently dropped so the chat keeps rendering.
  const safe = images.filter((src) => {
    if (typeof src !== "string" || src.length === 0) return false;
    const trimmed = src.trim().toLowerCase();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return true;
    if (trimmed.startsWith("blob:") || trimmed.startsWith("/")) return true;
    // data:image/png;base64,..., data:image/jpeg;..., data:image/webp;..., etc.
    // Block data:text/html, data:application/*, etc.
    if (trimmed.startsWith("data:image/")) return true;
    return false;
  });
  if (safe.length === 0) return null;
  return (
      <div className="flex flex-col gap-2 mt-3 max-w-full min-w-0">
        {safe.map((src, i) => (
          <div key={i} className="border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)] overflow-hidden max-w-full">
          <img src={src} alt={`Attachment ${i + 1}`} className="max-w-full max-h-64 object-contain" loading="lazy" />
        </div>
      ))}
    </div>
  );
});

const ProducerUpdateMessage = memo(function ProducerUpdateMessage({ msg }: { msg: ChatMessage }) {
  const renderedContent = useMemo(() => cachedRenderMarkdown(msg.content), [msg.content]);

  return (
    <div className="flex justify-start my-3 px-8 w-full max-w-3xl min-w-0">
      <div className="border-2 border-black bg-[#eef4ff] shadow-[3px_3px_0_0_rgba(0,85,255,0.35)] w-full min-w-0">
        <div className="bg-[#0055FF] text-white px-3 py-1.5 flex items-center justify-between gap-2 border-b-2 border-black">
          <span className="font-[var(--font-label)] text-[10px] font-bold uppercase tracking-widest">
            Producer update
          </span>
          <span className="font-[var(--font-terminal)] text-[10px] opacity-90">{formatTime(msg.timestamp)}</span>
        </div>
        <div className="px-4 py-3 min-w-0">
          <div
            className="font-[var(--font-terminal)] text-sm prose prose-sm max-w-none min-w-0 break-words [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_code]:break-words [&_h2]:text-base [&_h2]:mt-0 [&_h2]:mb-2"
            dangerouslySetInnerHTML={{ __html: renderedContent }}
          />
        </div>
      </div>
    </div>
  );
});

const SystemMessage = memo(function SystemMessage({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const measureRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    setExpanded(false);
  }, [msg.content]);

  useEffect(() => {
    const measure = measureRef.current;
    if (!measure) return;

    const updateOverflowState = () => {
      const computed = window.getComputedStyle(measure);
      const fontSize = Number.parseFloat(computed.fontSize) || 12;
      const lineHeight = Number.parseFloat(computed.lineHeight) || fontSize * 1.4;
      setIsOverflowing(measure.offsetHeight > lineHeight * 4 + 1);
    };

    updateOverflowState();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateOverflowState);
      observer.observe(measure);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateOverflowState);
    return () => window.removeEventListener("resize", updateOverflowState);
  }, [msg.content]);

  return (
    <div className="flex justify-start my-2 px-8">
      <div className="bg-[#e7e7f5] border-2 border-black px-5 py-1.5 text-left max-w-3xl">
        <div className="relative">
          <span
            className="font-[var(--font-terminal)] text-xs uppercase text-[#434656] whitespace-pre-wrap break-words block"
            style={
              !expanded && isOverflowing
                ? {
                    display: "-webkit-box",
                    WebkitBoxOrient: "vertical",
                    WebkitLineClamp: 4,
                    overflow: "hidden",
                  }
                : undefined
            }
          >
            {msg.content}
          </span>
          <span
            ref={measureRef}
            aria-hidden="true"
            className="font-[var(--font-terminal)] text-xs uppercase text-[#434656] whitespace-pre-wrap break-words block invisible pointer-events-none absolute inset-x-0 top-0"
          >
            {msg.content}
          </span>
        </div>
        {isOverflowing && (
          <div className="mt-2 pt-2 border-t border-[#b7b9c9]">
            <button
              onClick={() => setExpanded((value) => !value)}
              className="font-[var(--font-label)] text-[10px] font-bold uppercase border border-black bg-white px-2 py-1 hover:bg-black hover:text-white transition-colors"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

const WelcomeMessage = memo(function WelcomeMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="my-6 px-8">
      <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] max-w-2xl">
        <div className="bg-black p-3 flex items-center gap-3">
          <span className="material-symbols-outlined text-white">stadia_controller</span>
          <span className="font-[var(--font-terminal)] text-sm font-bold uppercase text-white tracking-wider">
            PRODUCER ONLINE
          </span>
        </div>
        <div className="p-5">
          <p className="font-[var(--font-terminal)] text-base mb-1">
            Hi, Game Director.
          </p>
          <p className="font-[var(--font-terminal)] text-lg font-bold mb-4">
            What do you want to do today?
          </p>

          <div className="border-2 border-black bg-[#f3f2ff] p-4 mb-4">
            <span className="font-[var(--font-label)] text-[10px] uppercase text-[#434656] tracking-widest block mb-3">
              Quick Commands
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 font-[var(--font-terminal)] text-sm text-[#434656]">
              <div className="flex gap-2 items-baseline">
                <code className="text-[#0055FF] font-bold bg-white border border-black px-1.5 py-0.5 text-[10px] whitespace-nowrap">/plan</code>
                <span className="text-xs">Create execution plan</span>
              </div>
              <div className="flex gap-2 items-baseline">
                <code className="text-[#0055FF] font-bold bg-white border border-black px-1.5 py-0.5 text-[10px] whitespace-nowrap">/autonomous</code>
                <span className="text-xs">Start production loop</span>
              </div>
              <div className="flex gap-2 items-baseline">
                <code className="text-[#0055FF] font-bold bg-white border border-black px-1.5 py-0.5 text-[10px] whitespace-nowrap">/consult</code>
                <span className="text-xs">Consult a director</span>
              </div>
              <div className="flex gap-2 items-baseline">
                <code className="text-[#0055FF] font-bold bg-white border border-black px-1.5 py-0.5 text-[10px] whitespace-nowrap">/tree</code>
                <span className="text-xs">Show agent hierarchy</span>
              </div>
              <div className="flex gap-2 items-baseline">
                <code className="text-[#0055FF] font-bold bg-white border border-black px-1.5 py-0.5 text-[10px] whitespace-nowrap">/context</code>
                <span className="text-xs">Check context usage</span>
              </div>
              <div className="flex gap-2 items-baseline">
                <code className="text-[#0055FF] font-bold bg-white border border-black px-1.5 py-0.5 text-[10px] whitespace-nowrap">/export</code>
                <span className="text-xs">Export session</span>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-[#e1e1ef]">
              <span className="font-[var(--font-terminal)] text-[10px] text-[#737688]">
                Type <code className="text-[#0055FF] font-bold">/help</code> to see all {COMMANDS.length} commands
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-xs text-[#737688] mt-0.5">lightbulb</span>
            <p className="font-[var(--font-terminal)] text-xs text-[#737688]">
              Tip: Describe what you want — the Producer orchestrates everything. It decides which agents to spawn, delegates tasks, and manages the pipeline. No need to micromanage.
            </p>
          </div>

          <span className="font-[var(--font-terminal)] text-[10px] text-[#737688] block mt-3 text-right">
            {formatTime(msg.timestamp)} UTC
          </span>
        </div>
      </div>
    </div>
  );
});

/* Markdown render cache — LRU with project-scoped buckets (10-C2).
 *
 * The old module-level Map used FIFO eviction and never cleared on
 * project switch, so long-running sessions leaked up to MAX_CACHE large
 * HTML strings per project, with no LRU semantics (FIFO deletes the
 * oldest-inserted, not the least-recently-used). We split by project
 * (keyed by the current project's id) and use a true LRU: read
 * promotes to most-recent, write evicts the least-recently-read entry.
 *
 * `currentProjectIdRef` is read at call time so callers don't have to
 * thread the project through every renderMarkdown site. The parent
 * (chat page) sets the ref via setCurrentProjectIdForMarkdownCache()
 * whenever currentProjectId changes — see useEffect there. */
const MD_CACHE_LIMIT = 200;
const mdCaches = new Map<string, Map<string, string>>();
// 14-CR-markdown-cache: the ref holds the *currently active* project
// id. Without it, every call site that forgot to pass projectId would
// bucket into the same `__default__` Map, causing cross-project HTML
// contamination (a 100KB entry from project A served for project B's
// message if the markdown bodies happened to collide) and unbounded
// growth (one map per app session, never reclaimed on project switch).
let currentProjectIdRef: string | null = null;

/** Update the projectId used to bucket the markdown cache. Call from
 * a useEffect on currentProjectId change in the chat page. */
export function setCurrentProjectIdForMarkdownCache(projectId: string | null): void {
  currentProjectIdRef = projectId;
}

function getMdCache(projectId: string | null): Map<string, string> {
  const key = projectId ?? "__default__";
  let cache = mdCaches.get(key);
  if (!cache) {
    cache = new Map();
    mdCaches.set(key, cache);
  }
  return cache;
}

function cachedRenderMarkdown(content: string, projectId?: string | null): string {
  // 14-CR-markdown-cache: prefer the explicit arg, fall back to the
  // ref (so legacy call sites that didn't pass projectId still bucket
  // correctly), fall back to `__default__`. The ref path is what
  // fixes the cross-project contamination.
  const effectiveProjectId = projectId ?? currentProjectIdRef;
  const cache = getMdCache(effectiveProjectId);
  const cached = cache.get(content);
  if (cached !== undefined) {
    // LRU: re-insert to mark as most-recently-used.
    cache.delete(content);
    cache.set(content, cached);
    return cached;
  }
  const html = renderMarkdown(content);
  if (cache.size >= MD_CACHE_LIMIT) {
    // Delete the oldest-inserted (which is also the least-recently-used
    // because we re-insert on read).
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(content, html);
  return html;
}

/** Drop the markdown cache for a specific project. Called on project
 * switch so a long-lived session doesn't keep prior projects' HTML. */
export function clearProjectMarkdownCache(projectId: string): void {
  mdCaches.delete(projectId);
}

const AgentMessage = memo(function AgentMessage({
  msg,
  onDecision,
  agentDone,
}: {
  msg: ChatMessage;
  onDecision: (action: string, sender: string) => void;
  agentDone?: boolean;
}) {
  const icon = getAgentIcon(msg.sender);
  const label = msg.sender.replace(/-/g, "_").toUpperCase();
  const isProgress = msg.type === "progress";

  const toolCalls = msg.toolCalls;

  const handleApprove = useCallback(() => onDecision("approve", msg.sender), [onDecision, msg.sender]);
  const handleOverride = useCallback(() => onDecision("override", msg.sender), [onDecision, msg.sender]);
  const handlePause = useCallback(() => onDecision("pause", msg.sender), [onDecision, msg.sender]);
  const handleClose = useCallback(() => onDecision("close", msg.sender), [onDecision, msg.sender]);

  const renderedContent = useMemo(() => cachedRenderMarkdown(msg.content), [msg.content]);

  return (
    <div className="flex gap-4 w-full max-w-4xl min-w-0 self-start">
      <div className="w-12 h-12 shrink-0 border-2 border-black bg-[#0055FF] flex justify-center items-center text-white shadow-[2px_2px_0_0_rgba(0,0,0,1)] relative z-10">
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-3 mb-1 ml-2">
          <span className="font-[var(--font-label)] text-xs font-bold uppercase">{label}</span>
          <span className="font-[var(--font-terminal)] text-[10px] text-[#737688]">{formatTime(msg.timestamp)}</span>
        </div>
        <div className="relative group">
          <div className="absolute left-[-10px] top-4 w-0 h-0 border-y-[6px] border-y-transparent border-r-[10px] border-r-black z-0" />
          <div className="absolute left-[-6px] top-[18px] w-0 h-0 border-y-[4px] border-y-transparent border-r-[8px] border-r-white z-10" />
          <div className="border-2 border-black bg-white p-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)] relative z-10 min-w-0">
            {msg.codeBlock && (
              <div className="bg-[#e1e1ef] border-2 border-black p-3 font-[var(--font-terminal)] text-sm mb-4 max-w-full overflow-x-auto">
                <span className="text-[#df2b31] block mb-1">// Code Output</span>
                <code className="block whitespace-pre-wrap break-words">{msg.codeBlock}</code>
              </div>
            )}
            <div
              className="font-[var(--font-terminal)] text-base prose prose-sm max-w-none min-w-0 break-words [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_code]:break-words"
              dangerouslySetInnerHTML={{ __html: renderedContent }}
            />
            <ImageGallery images={msg.images} />

            {/* Rich progress message — conversation flow: activity top, thinking middle, progress bottom */}
            {isProgress && msg.progress !== undefined && (
              <div className="mt-4 border-2 border-black bg-[#f3f2ff] shadow-[2px_2px_0_0_rgba(0,0,0,1)] min-w-0">
                {/* Activity log at top (newest first) */}
                {(toolCalls?.length || msg.logs?.length) ? (
                  <ActivityLog toolCalls={toolCalls ?? []} logs={msg.logs} defaultExpanded={false} />
                ) : null}

                {/* Thinking in the middle */}
                {msg.thinking && (
                  <div className="border-t-2 border-black px-3 py-2 bg-[#faf8ff] min-w-0">
                    <span className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest block mb-1">Thinking</span>
                    <span className="font-[var(--font-terminal)] text-xs text-[#737688] break-words [overflow-wrap:anywhere]">{msg.thinking}</span>
                  </div>
                )}

                {/* Progress bar at bottom like Claude Code thinking indicator */}
                <div className="p-2 flex items-center gap-3 border-t-2 border-black min-w-0">
                  <span className="material-symbols-outlined animate-spin text-sm text-[#0055FF] shrink-0">sync</span>
                  <div className="flex-1 min-w-0 h-4 border-2 border-black bg-white relative overflow-hidden">
                    <div className="h-full bg-[#0055FF] transition-[width] duration-700 ease-out relative" style={{ width: `${msg.progress}%` }}>
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                    </div>
                  </div>
                  <span className="font-[var(--font-terminal)] text-xs font-bold tabular-nums min-w-[3ch] shrink-0 text-right">{msg.progress}%</span>
                </div>
              </div>
            )}

            {!isProgress && msg.thinking && (
              <div className="mt-3 border border-[#e1e1ef] bg-[#faf8ff] p-2 min-w-0">
                <span className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest block mb-1">Thinking</span>
                <span className="font-[var(--font-terminal)] text-xs text-[#737688] break-words [overflow-wrap:anywhere]">{msg.thinking}</span>
              </div>
            )}

            {/* Activity log for completed messages */}
            {!isProgress && (toolCalls?.length || msg.logs?.length) && (
              <ActivityLog toolCalls={toolCalls ?? []} logs={msg.logs} />
            )}

            <div className="absolute -right-3 -top-3 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                className="w-8 h-8 border-2 border-black bg-black text-white hover:bg-[#0055FF] flex justify-center items-center retro-press"
                title="Trace Thought Process"
                aria-label="Trace thought process"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden="true">search</span>
              </button>
            </div>
          </div>
        </div>

        {msg.showActions && (
          <div className="mt-4 flex gap-4 ml-2">
            {agentDone ? (
              <button
                onClick={handleClose}
                className="border-2 border-black bg-[#df2b31] text-white px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-black hover:text-white retro-press flex items-center gap-2 shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors"
              >
                <span className="material-symbols-outlined text-sm">close</span>
                [CLOSE SESSION]
              </button>
            ) : (
              <>
                <button
                  onClick={handleApprove}
                  className="border-2 border-black bg-[#0055FF] text-white px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-black hover:text-white retro-press flex items-center gap-2 shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">check_circle</span>
                  [APPROVE]
                </button>
                <button
                  onClick={handleOverride}
                  className="border-2 border-black bg-white text-black px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-black hover:text-white retro-press flex items-center gap-2 shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">edit</span>
                  [OVERRIDE]
                </button>
                <button
                  onClick={handlePause}
                  className="border-2 border-black bg-white text-black px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-black hover:text-white retro-press flex items-center gap-2 shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">pause</span>
                  [PAUSE]
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

const UserMessage = memo(function UserMessage({ msg }: { msg: ChatMessage }) {
  const renderedContent = useMemo(() => cachedRenderMarkdown(msg.content), [msg.content]);

  return (
    <div className="flex gap-4 w-full max-w-3xl min-w-0 self-end flex-row-reverse mt-4">
      <div className="w-12 h-12 shrink-0 border-2 border-black bg-black relative z-10 shadow-[-2px_2px_0_0_rgba(0,85,255,1)]" />
      <div className="flex-1 flex flex-col items-end min-w-0">
        <div className="flex items-baseline gap-3 mb-1 mr-2 flex-row-reverse">
          <span className="font-[var(--font-label)] text-xs font-bold uppercase text-[#0055FF]">DIRECTOR (YOU)</span>
          <span className="font-[var(--font-terminal)] text-[10px] text-[#737688]">{formatTime(msg.timestamp)}</span>
        </div>
        <div className="relative group">
          <div className="absolute right-[-10px] top-4 w-0 h-0 border-y-[6px] border-y-transparent border-l-[10px] border-l-black z-0" />
          <div className="absolute right-[-6px] top-[18px] w-0 h-0 border-y-[4px] border-y-transparent border-l-[8px] border-l-[#dce1ff] z-10" />
          <div className="border-2 border-black bg-[#dce1ff] p-3 shadow-[-4px_4px_0_0_rgba(0,0,0,1)] relative z-10 text-right min-w-0 max-w-full">
            <div
              className="font-[var(--font-terminal)] text-base prose prose-sm max-w-none min-w-0 break-words [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_code]:break-words"
              dangerouslySetInnerHTML={{ __html: renderedContent }}
            />
            <ImageGallery images={msg.images} />
          </div>
        </div>
      </div>
    </div>
  );
});

const DiffMessage = memo(function DiffMessage({ msg, onNavigate }: { msg: ChatMessage; onNavigate?: (target: string) => void }) {
  const icon = getAgentIcon(msg.sender);
  const label = msg.sender.replace(/-/g, "_").toUpperCase();

  if (!msg.diff) return null;

  return (
    <div className="flex gap-4 w-full max-w-4xl min-w-0 self-start">
      <div className="w-12 h-12 shrink-0 border-2 border-black bg-[#0055FF] flex justify-center items-center text-white shadow-[2px_2px_0_0_rgba(0,0,0,1)] relative z-10">
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-3 mb-1 ml-2">
          <span className="font-[var(--font-label)] text-xs font-bold uppercase">{label}</span>
          <span className="font-[var(--font-terminal)] text-[10px] text-[#737688]">{formatTime(msg.timestamp)}</span>
        </div>
        <DiffView
          oldContent={msg.diff.oldContent}
          newContent={msg.diff.newContent}
          filePath={msg.diff.filePath}
        />
      </div>
    </div>
  );
});

const NavigateMessage = memo(function NavigateMessage({ msg, onNavigate }: { msg: ChatMessage; onNavigate?: (targetSession: string) => void }) {
  const target = msg.navigate?.targetSession ?? msg.navigateTo;
  if (!target) return null;

  return (
    <div className="flex justify-center my-4 px-8">
      <button
        onClick={() => onNavigate?.(target)}
        className="border-2 border-[#0055FF] bg-white px-6 py-3 font-[var(--font-label)] text-xs font-bold uppercase text-[#0055FF] hover:bg-[#0055FF] hover:text-white retro-press flex items-center gap-3 shadow-[2px_2px_0_0_rgba(0,85,255,1)] transition-colors"
      >
        <span className="material-symbols-outlined text-sm">arrow_forward</span>
        {msg.navigate?.label ?? msg.content ?? "Navigate"}
      </button>
    </div>
  );
});

export default function ChatThread({ messages, sessions, threadId, threadTitle, currentSession, connected, onDecision, onNavigate, onAnswer, onPlanAction, onSamplePrompt }: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);

  // 11-M13: only auto-scroll when the user is already near the bottom.
  // If they've scrolled up to read history, yanking them back to the
  // bottom on every incoming message is hostile. Use the scroll
  // container of `bottomRef.current` and treat "within 150px of bottom"
  // as "follow the tail."
  const msgCount = messages.length;
  useEffect(() => {
    if (msgCount > prevMsgCountRef.current) {
      const el = bottomRef.current;
      if (el) {
        // The nearest scrollable ancestor — walk up until we find one.
        let scrollContainer: HTMLElement | null = el.parentElement;
        while (scrollContainer && scrollContainer !== document.body) {
          const style = window.getComputedStyle(scrollContainer);
          if (/auto|scroll/.test(style.overflowY)) break;
          scrollContainer = scrollContainer.parentElement;
        }
        const FOLLOW_TAIL_THRESHOLD_PX = 150;
        const isFirstMessage = prevMsgCountRef.current === 0;
        const isAtBottom = scrollContainer
          ? scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < FOLLOW_TAIL_THRESHOLD_PX
          : true;
        if (isFirstMessage || isAtBottom) {
          el.scrollIntoView({ behavior: "smooth" });
        }
      }
    }
    prevMsgCountRef.current = msgCount;
  }, [msgCount]);

  // Pre-compute agent done states to avoid passing sessions Map to every message
  const agentDoneMap = useMemo(() => {
    const map = new Map<string, boolean>();
    if (sessions) {
      for (const [key, session] of sessions) {
        map.set(key, session.status === "completed");
      }
    }
    return map;
  }, [sessions]);

  const isProducerView = currentSession.startsWith("producer-") || currentSession === "producer";
  const sessionLabel = isProducerView
    ? "BOARD_ROOM"
    : currentSession.replace(/-/g, "_").toUpperCase();

  // Show sample prompts only in the producer view when the user hasn't
  // sent anything yet (only welcome/system messages so far).
  const hasUserActivity = messages.some(
    (m) => m.type === "user" || m.type === "agent" || m.type === "question" || m.type === "plan",
  );
  const showSamplePrompts = isProducerView && !hasUserActivity && !!onSamplePrompt;

  return (
    <section className="flex-1 flex flex-col bg-[#faf8ff] relative z-0 min-h-0">
      {/* Header */}
      <div className="h-14 border-b-2 border-black bg-white flex items-center justify-between px-6 shrink-0 z-20">
        <div className="flex items-center gap-4">
          <span className="material-symbols-outlined">{isProducerView ? "forum" : "smart_toy"}</span>
          <h2 className="font-[var(--font-terminal)] text-base font-bold uppercase tracking-widest">
            {sessionLabel}
          </h2>
          {!isProducerView && (
            <span className="font-[var(--font-label)] text-[10px] uppercase bg-[#e7e7f5] px-2 py-1 border border-black">
              Agent Session
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {connected === false && (
            <span className="font-[var(--font-label)] text-[10px] font-bold uppercase bg-[#df2b31] text-white px-2 py-1 border border-black animate-pulse">
              OFFLINE
            </span>
          )}
          {connected === true && (
            <span className="font-[var(--font-label)] text-[10px] font-bold uppercase bg-[#2ECC71] text-white px-2 py-1 border border-black">
              LIVE
            </span>
          )}
          <span className="font-[var(--font-label)] text-xs bg-[#e7e7f5] px-2 py-1 border-2 border-black">
            ID: {threadId}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 pb-32 min-w-0">
        {messages.map((msg) => {
          switch (msg.type) {
            case "system":
              return <SystemMessage key={msg.id} msg={msg} />;
            case "producer_update":
              return <ProducerUpdateMessage key={msg.id} msg={msg} />;
            case "welcome":
              return <WelcomeMessage key={msg.id} msg={msg} />;
            case "agent":
              return <AgentMessage key={msg.id} msg={msg} onDecision={onDecision} agentDone={agentDoneMap.get(msg.sender)} />;
            case "user":
              return <UserMessage key={msg.id} msg={msg} />;
            case "progress":
              return <AgentMessage key={msg.id} msg={msg} onDecision={onDecision} />;
            case "diff":
              return <DiffMessage key={msg.id} msg={msg} onNavigate={onNavigate} />;
            case "navigate":
              return <NavigateMessage key={msg.id} msg={msg} onNavigate={onNavigate} />;
            case "question": {
              if (!onAnswer) return null;
              const msgIndex = messages.indexOf(msg);
              const answerMsg = messages.slice(msgIndex + 1).find(
                (m) => m.type === "user" && (m.content.startsWith("Selected:") || m.content.startsWith("Additional input:"))
              );
              return (
                <QuestionMessage
                  key={`${msg.id}-${msg.question?.questionId}`}
                  msg={msg}
                  onAnswer={onAnswer}
                  sender={msg.sender}
                  isAnswered={!!answerMsg}
                  answerContent={answerMsg?.content}
                />
              );
            }
            case "plan":
              return onPlanAction ? <PlanMessage key={`${msg.id}-plan`} msg={msg} onPlanAction={onPlanAction} sender={msg.sender} /> : null;
            case "workflow":
              return <WorkflowMessage key={msg.id} msg={msg} />;
            default:
              return null;
          }
        })}
        {showSamplePrompts && (
          <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] p-5 self-start max-w-2xl">
            <div className="font-[var(--font-terminal)] text-xs uppercase tracking-widest text-[#737688] mb-3">
              Or pick a starting point:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SAMPLE_PROMPTS.map((sp) => (
                <button
                  key={sp.label}
                  type="button"
                  onClick={() => onSamplePrompt?.(sp.prompt)}
                  className="border-2 border-black bg-white px-3 py-4 text-left hover:bg-black hover:text-white transition-colors retro-press flex flex-col gap-2"
                >
                  <span className="material-symbols-outlined">{sp.icon}</span>
                  <span className="font-[var(--font-label)] text-xs font-bold uppercase leading-tight">
                    {sp.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
