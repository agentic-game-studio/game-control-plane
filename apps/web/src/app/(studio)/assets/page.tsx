"use client";

export default function AssetsPage() {
  return (
    <div className="flex flex-col h-full p-8 gap-6">
      {/* Header */}
      <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 border-2 border-black bg-black flex items-center justify-center text-white">
            <span className="material-symbols-outlined">inventory_2</span>
          </div>
          <div>
            <h1 className="font-[var(--font-terminal)] text-xl font-bold uppercase tracking-widest">
              Asset Forge
            </h1>
            <span className="font-[var(--font-terminal)] text-xs text-[#737688] uppercase">
              Resource Management // Offline
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex gap-4">
        {/* Inventory Grid */}
        <div className="flex-1 border-2 border-black bg-[#f3f2ff] p-6 shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-16 h-16 border-2 border-black bg-black flex items-center justify-center text-white">
              <span className="material-symbols-outlined text-3xl">construction</span>
            </div>
            <h2 className="font-[var(--font-terminal)] text-lg font-bold uppercase tracking-wider">
              Forge Offline
            </h2>
            <p className="font-[var(--font-terminal)] text-sm text-[#737688] text-center max-w-md">
              Asset inventory system is being rebuilt with retro-computing aesthetics.
              <br />
              Return to the Board Room to coordinate asset creation.
            </p>
          </div>
        </div>

        {/* Art Bible Sidebar */}
        <div className="w-80 border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
          <div className="border-b-2 border-black p-3 bg-black text-white">
            <span className="font-[var(--font-terminal)] text-xs font-bold uppercase tracking-wider">
              Art Bible
            </span>
          </div>
          <div className="p-4 flex flex-col gap-4">
            <div className="border-2 border-black bg-[#f3f2ff] p-3">
              <span className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest block mb-2">
                Constraints
              </span>
              <div className="space-y-2 font-[var(--font-terminal)] text-xs text-[#434656]">
                <div className="flex justify-between">
                  <span>Texture Res</span>
                  <span className="font-bold">—</span>
                </div>
                <div className="flex justify-between">
                  <span>Max Polycount</span>
                  <span className="font-bold">—</span>
                </div>
                <div className="flex justify-between">
                  <span>Palette</span>
                  <span className="font-bold">—</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
