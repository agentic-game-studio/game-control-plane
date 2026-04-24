"use client";

import { useState, useCallback, useEffect, useRef } from "react";

export interface ChatMessage {
  id: string;
  type: "system" | "agent" | "user" | "progress" | "welcome" | "diff" | "navigate";
  sender: string;
  content: string;
  timestamp: string;
  showActions?: boolean;
  progress?: number;
  codeBlock?: string;
  toolCalls?: { name: string; args: Record<string, unknown>; status: string; result?: string }[];
  diff?: { oldContent: string; newContent: string; filePath: string };
  thinking?: string;
  navigateTo?: string;
}

export interface FileOp {
  path: string;
  operation: "read" | "written" | "edited";
  timestamp: string;
}

export interface AgentSession {
  role: string;
  messages: ChatMessage[];
  status: "active" | "done";
  progress: number;
  spawnedAt: string;
  fileOps: FileOp[];
}

const GREETINGS: Record<string, string> = {
  "creative-director": "I'm the Creative Director. I oversee the artistic vision and ensure all creative elements align. What would you like to explore?",
  "technical-director": "Technical Director online. I manage the technical architecture and engineering pipeline. What system needs attention?",
  "producer": "Producer here. I manage timelines, resources, and coordination across teams. What's the priority?",
  "game-designer": "Game Designer ready. I design core mechanics, systems, and gameplay loops. What system should we work on?",
  "lead-programmer": "Lead Programmer spawned. I coordinate all programming tasks and code architecture. What needs implementation?",
  "art-director": "Art Director online. I define the visual style and guide all artistic output. What's the creative brief?",
  "audio-director": "Audio Director here. I oversee sound design, music, and audio systems. What's the soundscape vision?",
  "narrative-director": "Narrative Director ready. I guide story, dialogue, and world-building. What tale shall we craft?",
  "qa-lead": "QA Lead spawned. I manage testing strategy and quality assurance. What needs verification?",
  "release-manager": "Release Manager online. I coordinate builds, deployments, and release schedules. What's the target?",
};

const DEFAULT_GREETING = "Agent spawned and ready. Awaiting your instructions.";

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function uid(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function useCommandRoom() {
  const [sessions, setSessions] = useState<Map<string, AgentSession>>(new Map());
  const [currentSession, setCurrentSession] = useState("game-director");
  const [threadId, setThreadId] = useState("");
  const [threadTitle, setThreadTitle] = useState("Board Room");
  const lastSpawnedRef = useRef<string | null>(null);
  const activityLogRef = useRef<string[]>([]);

  // Initialize on client only to avoid hydration mismatch
  useEffect(() => {
    const gd: AgentSession = {
      role: "game-director",
      messages: [{
        id: uid(),
        type: "welcome",
        sender: "GAME_DIRECTOR",
        content: "BOARD_ROOM initialized. Game Director online.",
        timestamp: timestamp(),
      }],
      status: "active",
      progress: 0,
      spawnedAt: timestamp(),
      fileOps: [],
    };
    setSessions(new Map([["game-director", gd]]));
    setThreadId(`#${Math.floor(Math.random() * 9000 + 1000)}`);
  }, []);

  const addSessionMessage = useCallback((sessionRole: string, msg: Omit<ChatMessage, "id" | "timestamp">) => {
    setSessions((prev) => {
      const session = prev.get(sessionRole);
      if (!session) return prev;
      const next = new Map(prev);
      next.set(sessionRole, {
        ...session,
        messages: [...session.messages, { ...msg, id: uid(), timestamp: timestamp() }],
      });
      return next;
    });
  }, []);

  const spawnAgent = useCallback((role: string) => {
    const r = role.toLowerCase().trim();

    setSessions((prev) => {
      if (prev.has(r)) return prev;
      const next = new Map(prev);
      next.set(r, {
        role: r,
        messages: [
          { id: uid(), type: "system", sender: "SYSTEM", content: `${r.toUpperCase()} session initialized.`, timestamp: timestamp() },
          { id: uid(), type: "agent", sender: r, content: GREETINGS[r] ?? DEFAULT_GREETING, timestamp: timestamp(), showActions: true },
        ],
        status: "active",
        progress: 0,
        spawnedAt: timestamp(),
        fileOps: [],
      });
      return next;
    });

    lastSpawnedRef.current = r;

    addSessionMessage("game-director", {
      type: "system",
      sender: "SYSTEM",
      content: `${r.toUpperCase()} spawned at ${timestamp()} UTC`,
    });
    addSessionMessage("game-director", {
      type: "agent",
      sender: "game-director",
      content: `I've brought ${r.replace(/-/g, " ")} online. They're ready for tasks. You can view their session in the sidebar.`,
      showActions: false,
    });

    if (threadTitle === "Board Room") {
      setThreadTitle(`Session: ${r.replace(/-/g, " ")}`);
    }
  }, [addSessionMessage, threadTitle]);

  // Approve agent — step-based workflow with mock tool calls, thinking, diff
  const approveAgent = useCallback((role: string) => {
    const steps = [
      { progress: 10, label: "Analyzing task requirements...", thinking: "Breaking down the task into actionable steps..." },
      { progress: 25, label: "Reading project context...", thinking: "Scanning relevant files for context..." },
      { progress: 40, label: "Planning implementation...", thinking: "Designing the solution approach..." },
      { progress: 55, label: "Implementing changes...", thinking: "Writing and editing code..." },
      { progress: 75, label: "Verifying changes...", thinking: "Running checks and validation..." },
      { progress: 100, label: "Complete", thinking: "Task finished successfully." },
    ];

    let stepIndex = 0;
    const progressMsgId = uid();
    activityLogRef.current = [];

    setSessions((prev) => {
      const next = new Map(prev);
      const session = next.get(role);
      if (!session || session.status !== "active") return prev;
      next.set(role, {
        ...session,
        progress: 10,
        messages: [...session.messages, {
          id: progressMsgId,
          type: "progress" as const,
          sender: role,
          content: steps[0].label,
          timestamp: timestamp(),
          progress: 10,
          thinking: steps[0].thinking,
        }],
      });
      return next;
    });

    const interval = setInterval(() => {
      stepIndex++;
      if (stepIndex >= steps.length) {
        clearInterval(interval);
        return;
      }

      const step = steps[stepIndex];

      setSessions((prev) => {
        const next = new Map(prev);
        const session = next.get(role);
        if (!session || session.status !== "active") return prev;

        const newStandaloneMessages: ChatMessage[] = [];
        const stepToolCalls: NonNullable<ChatMessage["toolCalls"]> = [];

        if (step.progress === 25) {
          stepToolCalls.push({
            name: "Read",
            args: { file_path: "src/utils.ts" },
            status: "completed",
            result: "function oldName() {\n  return 42;\n}",
          });
          activityLogRef.current.push("Read src/utils.ts — Retrieved source context");
        }

        if (step.progress === 40) {
          stepToolCalls.push({
            name: "Grep",
            args: { pattern: "oldName", path: "src" },
            status: "completed",
            result: "src/utils.ts:1: function oldName()\nsrc/main.ts:5: oldName()",
          });
          activityLogRef.current.push("Grep 'oldName' in src/ — Found 2 references across codebase");
        }

        if (step.progress === 55) {
          stepToolCalls.push({
            name: "Edit",
            args: { file_path: "src/utils.ts", old_string: "function oldName()", new_string: "function newName()" },
            status: "completed",
            result: "Done",
          });
          activityLogRef.current.push("Edit src/utils.ts — Renamed function oldName → newName");
          newStandaloneMessages.push({
            id: uid(),
            type: "diff" as const,
            sender: role,
            content: "Edited src/utils.ts",
            timestamp: timestamp(),
            diff: {
              filePath: "src/utils.ts",
              oldContent: "function oldName() {\n  return 42;\n}",
              newContent: "function newName() {\n  return 42;\n}",
            },
          });
        }

        if (step.progress === 75) {
          stepToolCalls.push({
            name: "Write",
            args: { file_path: "src/utils.test.ts", content: "import { newName } from './utils';\n\ntest('newName', () => {\n  expect(newName()).toBe(42);\n});" },
            status: "completed",
            result: "Done",
          });
          activityLogRef.current.push("Write src/utils.test.ts — Added unit test coverage");
        }

        const updatedMessages = session.messages.map((m) => {
          if (m.id !== progressMsgId) return m;
          return {
            ...m,
            progress: step.progress,
            content: step.label,
            thinking: step.thinking,
            timestamp: timestamp(),
            toolCalls: [...(m.toolCalls ?? []), ...stepToolCalls],
          };
        });

        if (step.progress === 100) {
          newStandaloneMessages.push({
            id: uid(),
            type: "system" as const,
            sender: "SYSTEM",
            content: "Task completed successfully.",
            timestamp: timestamp(),
          });
          newStandaloneMessages.push({
            id: uid(),
            type: "navigate" as const,
            sender: "SYSTEM",
            content: "Back to Game Director",
            timestamp: timestamp(),
            navigateTo: "game-director",
          });
        }

        next.set(role, {
          ...session,
          progress: step.progress,
          status: step.progress === 100 ? "done" : "active",
          messages: [...updatedMessages, ...newStandaloneMessages],
        });

        return next;
      });

      if (step.progress === 100) {
        clearInterval(interval);
        const bullets = activityLogRef.current.length > 0
          ? "\n\n" + activityLogRef.current.map((s) => `• ${s}`).join("\n")
          : "";
        addSessionMessage("game-director", {
          type: "agent",
          sender: "game-director",
          content: `${role.replace(/-/g, " ")} reports task complete.${bullets}`,
          showActions: false,
        });
      }
    }, 1500);
  }, [addSessionMessage]);

  const executeCommand = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const lower = trimmed.toLowerCase();

    // Always switch to GD view for typed commands
    setCurrentSession("game-director");

    // Slash commands
    if (lower.startsWith("/")) {
      const parts = lower.slice(1).split(" ");
      const cmd = parts[0];
      const args = parts.slice(1).join(" ");

      switch (cmd) {
        case "clear": {
          setSessions((prev) => {
            const next = new Map(prev);
            const gd = next.get("game-director");
            if (gd) {
              next.set("game-director", { ...gd, messages: [] });
            }
            return next;
          });
          addSessionMessage("game-director", { type: "system", sender: "SYSTEM", content: "Chat cleared." });
          return;
        }
        case "help": {
          addSessionMessage("game-director", { type: "user", sender: "DIRECTOR", content: trimmed });
          addSessionMessage("game-director", {
            type: "agent",
            sender: "game-director",
            content: `Available commands:\n- /clear — Clear the chat\n- /help — Show this message\n- /spawn <agent> — Bring an agent online\n- /cost — Show mock token usage\n- /diff — Show recent changes\nYou can also use: spawn <agent>, approve, done <agent>`,
            showActions: false,
          });
          return;
        }
        case "spawn": {
          if (!args) {
            addSessionMessage("game-director", { type: "system", sender: "SYSTEM", content: "Usage: /spawn <agent-role>" });
            return;
          }
          addSessionMessage("game-director", { type: "user", sender: "DIRECTOR", content: trimmed });
          spawnAgent(args);
          return;
        }
        case "cost": {
          addSessionMessage("game-director", { type: "user", sender: "DIRECTOR", content: trimmed });
          addSessionMessage("game-director", {
            type: "agent",
            sender: "game-director",
            content: `Token usage (mock):\n- Input: 1,247 tokens\n- Output: 892 tokens\n- Total: 2,139 tokens\n- Estimated cost: $0.0042`,
            showActions: false,
          });
          return;
        }
        case "diff": {
          addSessionMessage("game-director", { type: "user", sender: "DIRECTOR", content: trimmed });
          addSessionMessage("game-director", {
            type: "diff",
            sender: "game-director",
            content: "Recent changes",
            diff: {
              filePath: "src/utils.ts",
              oldContent: "function oldName() {\n  return 42;\n}",
              newContent: "function newName() {\n  return 42;\n}",
            },
          });
          return;
        }
        default: {
          addSessionMessage("game-director", { type: "system", sender: "SYSTEM", content: `Unknown command: /${cmd}. Type /help for available commands.` });
          return;
        }
      }
    }

    // spawn <agent>
    if (lower.startsWith("spawn ")) {
      const role = lower.slice(6).trim();
      if (!role) {
        addSessionMessage("game-director", { type: "system", sender: "SYSTEM", content: "Usage: spawn <agent-role>" });
        return;
      }
      addSessionMessage("game-director", { type: "user", sender: "DIRECTOR", content: trimmed });
      spawnAgent(role);
      return;
    }

    // approve — from text command, approves last spawned
    if (lower === "approve") {
      const role = lastSpawnedRef.current;
      if (!role) {
        addSessionMessage("game-director", { type: "system", sender: "SYSTEM", content: "No agent to approve." });
        return;
      }
      addSessionMessage("game-director", { type: "user", sender: "DIRECTOR", content: "Approved. Proceed with the task." });
      approveAgent(role);
      return;
    }

    // done <agent>
    if (lower.startsWith("done ")) {
      const role = lower.slice(5).trim();
      addSessionMessage("game-director", { type: "user", sender: "DIRECTOR", content: trimmed });

      setSessions((prev) => {
        const session = prev.get(role);
        if (!session) return prev;
        const next = new Map(prev);
        next.set(role, {
          ...session,
          status: "done",
          messages: [...session.messages, {
            id: uid(),
            type: "system" as const,
            sender: "SYSTEM",
            content: "Session closed. Task completed.",
            timestamp: timestamp(),
          }],
        });
        return next;
      });

      addSessionMessage("game-director", {
        type: "system",
        sender: "SYSTEM",
        content: `${role.toUpperCase()} completed task and despawned.`,
      });
      return;
    }

    // Default: plain message to Game Director
    addSessionMessage("game-director", { type: "user", sender: "DIRECTOR", content: trimmed });

    setTimeout(() => {
      addSessionMessage("game-director", {
        type: "agent",
        sender: "game-director",
        content: `Acknowledged. I'll coordinate the appropriate team members. Use \`spawn <agent-role>\` to bring a specialist online if needed.`,
        showActions: false,
      });
    }, 500);
  }, [addSessionMessage, spawnAgent, approveAgent]);

  // Derived state
  const currentMessages = sessions.get(currentSession)?.messages ?? [];
  const activeAgentList = [...sessions.values()].filter((s) => s.role !== "game-director" && s.status === "active");
  const totalProgress = activeAgentList.length > 0
    ? Math.round(activeAgentList.reduce((sum, s) => sum + s.progress, 0) / activeAgentList.length)
    : 0;

  return {
    sessions,
    currentSession,
    currentMessages,
    threadId,
    threadTitle,
    totalProgress,
    executeCommand,
    selectSession: setCurrentSession,
    approveAgent,
  };
}
