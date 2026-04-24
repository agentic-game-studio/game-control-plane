"use client";

export default function TicketsPage() {
  return (
    <div className="flex flex-col h-full p-8 gap-6">
      {/* Header */}
      <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 border-2 border-black bg-black flex items-center justify-center text-white">
            <span className="material-symbols-outlined">checklist</span>
          </div>
          <div>
            <h1 className="font-[var(--font-terminal)] text-xl font-bold uppercase tracking-widest">
              Quest Board
            </h1>
            <span className="font-[var(--font-terminal)] text-xs text-[#737688] uppercase">
              Task Management // Standby
            </span>
          </div>
        </div>
      </div>

      {/* Kanban Columns Placeholder */}
      <div className="flex-1 grid grid-cols-4 gap-4">
        {["Available", "In Progress", "QA", "Completed"].map((col) => (
          <div key={col} className="border-2 border-black bg-white flex flex-col shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
            <div className="border-b-2 border-black p-3 bg-black text-white">
              <span className="font-[var(--font-terminal)] text-xs font-bold uppercase tracking-wider">
                {col}
              </span>
            </div>
            <div className="flex-1 p-3 flex flex-col items-center justify-center gap-2">
              <span className="material-symbols-outlined text-[#737688]">inbox</span>
              <span className="font-[var(--font-terminal)] text-xs text-[#737688] uppercase">
                No Quests
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
