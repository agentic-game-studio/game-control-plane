"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useProject } from "@/contexts/ProjectContext";

function ProjectPill() {
  const { projects, currentProject, selectProject } = useProject();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`border-2 border-black flex items-center gap-2 px-3 py-1 font-[var(--font-terminal)] text-xs uppercase font-bold retro-press transition-colors ${
          currentProject
            ? "bg-white hover:bg-black hover:text-white"
            : "bg-yellow-300 hover:bg-yellow-400"
        }`}
      >
        <span className="material-symbols-outlined text-sm">
          {currentProject ? "folder_open" : "warning"}
        </span>
        <span className="max-w-[160px] truncate">
          {currentProject ? currentProject.name : "NO PROJECT"}
        </span>
        <span className="material-symbols-outlined text-sm">expand_more</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] z-50">
          <div className="border-b-2 border-black px-3 py-2 font-[var(--font-terminal)] text-xs uppercase font-bold bg-black text-white">
            Switch Project
          </div>
          <div className="max-h-64 overflow-y-auto">
            {projects.length === 0 ? (
              <div className="px-3 py-3 font-[var(--font-terminal)] text-xs text-zinc-500">
                No projects yet.
              </div>
            ) : (
              projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    selectProject(p.id);
                    setOpen(false);
                  }}
                  className={`block w-full text-left px-3 py-2 font-[var(--font-terminal)] text-xs uppercase border-b border-zinc-200 hover:bg-zinc-100 ${
                    p.id === currentProject?.id ? "bg-black text-white hover:bg-black" : "bg-white"
                  }`}
                >
                  <div className="font-bold truncate">{p.name}</div>
                  {p.engine && (
                    <div className="text-[10px] opacity-70 mt-0.5">{p.engine}</div>
                  )}
                </button>
              ))
            )}
          </div>
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 font-[var(--font-terminal)] text-xs uppercase font-bold border-t-2 border-black bg-white hover:bg-black hover:text-white text-center"
          >
            + Create New Project
          </Link>
        </div>
      )}
    </div>
  );
}

export default function TopAppBar() {
  return (
    <header className="fixed top-0 left-0 w-full h-16 flex justify-between items-center px-6 z-50 bg-white border-b-2 border-black">
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="font-[var(--font-headline)] text-xl font-black text-black uppercase tracking-tighter">
          STUDIO_OS v1.0
        </Link>
        <ProjectPill />
      </div>
      <div className="flex items-center gap-4">
        <div className="border-2 border-black flex items-center px-2 py-1 bg-white hidden md:flex">
          <span className="material-symbols-outlined text-black mr-2 text-sm">search</span>
          <input
            className="bg-transparent border-none outline-none text-black font-[var(--font-terminal)] text-sm p-0 w-32 focus:ring-0 placeholder:text-black"
            placeholder="SEARCH_"
            type="text"
          />
        </div>
        <button className="border-2 border-black bg-white p-1 hover:bg-black hover:text-white transition-colors retro-press">
          <span className="material-symbols-outlined">notifications</span>
        </button>
        <Link href="/settings">
          <button className="border-2 border-black bg-white p-1 hover:bg-black hover:text-white transition-colors retro-press">
            <span className="material-symbols-outlined">settings</span>
          </button>
        </Link>
        <div className="w-8 h-8 border-2 border-black bg-surface-container-high overflow-hidden">
          <div className="w-full h-full bg-zinc-300" />
        </div>
      </div>
    </header>
  );
}
