"use client";

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-full p-8 gap-6">
      {/* Header */}
      <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 border-2 border-black bg-black flex items-center justify-center text-white">
            <span className="material-symbols-outlined">tune</span>
          </div>
          <div>
            <h1 className="font-[var(--font-terminal)] text-xl font-bold uppercase tracking-widest">
              Ledger
            </h1>
            <span className="font-[var(--font-terminal)] text-xs text-[#737688] uppercase">
              System Config // Standby
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Credits */}
        <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
          <div className="border-b-2 border-black p-3 bg-black text-white">
            <span className="font-[var(--font-terminal)] text-xs font-bold uppercase tracking-wider">
              Credit Management
            </span>
          </div>
          <div className="p-8 flex flex-col items-center justify-center gap-4">
            <div className="border-4 border-black bg-black text-white p-6 w-full max-w-sm text-center">
              <span className="font-[var(--font-headline)] text-6xl font-black tracking-tighter">
                —
              </span>
            </div>
            <span className="font-[var(--font-terminal)] text-xs text-[#737688] uppercase">
              Balance unavailable in standby mode
            </span>
          </div>
        </div>

        {/* Config */}
        <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
          <div className="border-b-2 border-black p-3 bg-black text-white">
            <span className="font-[var(--font-terminal)] text-xs font-bold uppercase tracking-wider">
              Core Configuration
            </span>
          </div>
          <div className="p-6 flex flex-col gap-4">
            <div className="border-2 border-black bg-[#f3f2ff] p-4">
              <span className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest block mb-3">
                Parameters
              </span>
              <div className="space-y-3 font-[var(--font-terminal)] text-sm">
                <div className="flex justify-between items-center border-b border-[#e1e1ef] pb-2">
                  <span className="text-[#434656]">Target Engine</span>
                  <span className="font-bold">—</span>
                </div>
                <div className="flex justify-between items-center border-b border-[#e1e1ef] pb-2">
                  <span className="text-[#434656]">Asset Model</span>
                  <span className="font-bold">—</span>
                </div>
                <div className="flex justify-between items-center border-b border-[#e1e1ef] pb-2">
                  <span className="text-[#434656]">API Key</span>
                  <span className="font-bold">—</span>
                </div>
              </div>
            </div>
            <div className="border-2 border-black bg-[#faf8ff] p-4 text-center">
              <span className="material-symbols-outlined text-[#737688] mb-2">construction</span>
              <p className="font-[var(--font-terminal)] text-xs text-[#737688]">
                Configuration panel under retrofit.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
