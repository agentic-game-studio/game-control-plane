"use client";

export default function DashboardPage() {
  return (
    <div className="flex flex-col h-full p-8 gap-6">
      {/* Header */}
      <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 border-2 border-black bg-black flex items-center justify-center text-white">
            <span className="material-symbols-outlined">dashboard</span>
          </div>
          <div>
            <h1 className="font-[var(--font-terminal)] text-xl font-bold uppercase tracking-widest">
              Mission Control
            </h1>
            <span className="font-[var(--font-terminal)] text-xs text-[#737688] uppercase">
              System Overview // Offline
            </span>
          </div>
        </div>
      </div>

      {/* Status Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border-2 border-black bg-white p-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
          <div className="font-[var(--font-terminal)] text-xs uppercase text-[#737688] border-b-2 border-black pb-2 mb-3">
            Active Projects
          </div>
          <div className="font-[var(--font-terminal)] text-4xl font-bold">—</div>
        </div>
        <div className="border-2 border-black bg-white p-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
          <div className="font-[var(--font-terminal)] text-xs uppercase text-[#737688] border-b-2 border-black pb-2 mb-3">
            Agent Uptime
          </div>
          <div className="font-[var(--font-terminal)] text-4xl font-bold">—</div>
        </div>
        <div className="border-2 border-black bg-white p-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
          <div className="font-[var(--font-terminal)] text-xs uppercase text-[#737688] border-b-2 border-black pb-2 mb-3">
            Credits
          </div>
          <div className="font-[var(--font-terminal)] text-4xl font-bold">—</div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 border-2 border-black bg-[#f3f2ff] p-8 flex flex-col items-center justify-center shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
        <div className="w-16 h-16 border-2 border-black bg-black flex items-center justify-center text-white mb-4">
          <span className="material-symbols-outlined text-3xl">construction</span>
        </div>
        <h2 className="font-[var(--font-terminal)] text-lg font-bold uppercase tracking-wider mb-2">
          Under Construction
        </h2>
        <p className="font-[var(--font-terminal)] text-sm text-[#737688] text-center max-w-md">
          Mission Control dashboard is being retrofitted with live data feeds.
          <br />
          Check back soon, Director.
        </p>
      </div>
    </div>
  );
}
