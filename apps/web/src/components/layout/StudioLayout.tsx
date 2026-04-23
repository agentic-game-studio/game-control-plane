"use client";

import TopAppBar from "./TopAppBar";
import SideNavBar from "./SideNavBar";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopAppBar />
      <div className="flex pt-16 h-screen overflow-hidden">
        <SideNavBar />
        <main className="flex-1 overflow-y-auto bg-surface-container-lowest">
          {children}
        </main>
      </div>
      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-white border-t-2 border-black flex justify-around items-center h-16 z-50">
        <a className="flex flex-col items-center justify-center w-full h-full text-primary border-t-4 border-primary" href="/dashboard">
          <span className="material-symbols-outlined">dashboard</span>
          <span className="font-[var(--font-label)] text-xs font-bold uppercase mt-1">DASH</span>
        </a>
        <a className="flex flex-col items-center justify-center w-full h-full text-black hover:bg-zinc-100 border-t-4 border-transparent" href="/chat">
          <span className="material-symbols-outlined">chat</span>
          <span className="font-[var(--font-label)] text-xs font-bold uppercase mt-1">COMMS</span>
        </a>
        <a className="flex flex-col items-center justify-center w-full h-full text-black hover:bg-zinc-100 border-t-4 border-transparent" href="/tickets">
          <span className="material-symbols-outlined">checklist</span>
          <span className="font-[var(--font-label)] text-xs font-bold uppercase mt-1">QUESTS</span>
        </a>
        <a className="flex flex-col items-center justify-center w-full h-full text-black hover:bg-zinc-100 border-t-4 border-transparent" href="/assets">
          <span className="material-symbols-outlined">menu</span>
          <span className="font-[var(--font-label)] text-xs font-bold uppercase mt-1">MORE</span>
        </a>
      </nav>
    </>
  );
}
