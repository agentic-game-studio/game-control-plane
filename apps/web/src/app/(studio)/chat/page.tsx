export default function ChatPage() {
  return (
    <div className="flex h-full overflow-hidden">
      {/* Left Pane: Agent Hierarchy (Skill Tree) */}
      <aside className="w-80 border-r-2 border-black bg-surface-container-lowest flex flex-col h-full z-10 relative shrink-0">
        <div className="p-4 border-b-2 border-black bg-surface-container-low flex justify-between items-center">
          <h2 className="font-[var(--font-headline)] text-2xl font-semibold uppercase tracking-tighter">
            AGENTS
          </h2>
          <button className="border-2 border-black bg-white hover:bg-black hover:text-white p-1 retro-press" title="Collapse Tree">
            <span className="material-symbols-outlined">unfold_less</span>
          </button>
        </div>

        {/* Agent Tree */}
        <div
          className="flex-1 overflow-y-auto p-4"
          style={{
            backgroundImage: "radial-gradient(#d9d9e6 2px, transparent 2px)",
            backgroundSize: "16px 16px",
          }}
        >
          <div className="relative ml-4">
            {/* Root: Director AI */}
            <div className="flex items-center gap-3 mb-6 relative z-10 group">
              <div className="w-10 h-10 border-2 border-black bg-black text-white flex items-center justify-center font-[var(--font-terminal)] shadow-[4px_4px_0_0_rgba(0,85,255,1)] group-hover:bg-primary-container group-hover:shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-all cursor-pointer">
                <span className="material-symbols-outlined">psychology</span>
              </div>
              <div className="bg-white border-2 border-black px-3 py-1 cursor-pointer group-hover:bg-primary-container group-hover:text-white transition-colors">
                <span className="font-[var(--font-label)] text-xs font-bold uppercase">
                  DIRECTOR_AI
                </span>
              </div>
            </div>

            {/* Branch Line */}
            <div className="absolute left-[19px] top-10 bottom-0 w-[2px] bg-black z-0" />

            {/* Child: Art Lead */}
            <div className="relative ml-8 mb-6 mt-4 z-10">
              <div className="absolute -left-8 top-5 w-8 h-[2px] bg-black" />
              <div className="flex items-center gap-3 group">
                <div className="w-8 h-8 border-2 border-black bg-white text-black flex items-center justify-center font-[var(--font-terminal)] text-sm cursor-pointer group-hover:bg-black group-hover:text-white transition-colors">
                  <span className="material-symbols-outlined text-sm">brush</span>
                </div>
                <div className="bg-white border-2 border-black px-2 py-1 cursor-pointer group-hover:bg-black group-hover:text-white transition-colors">
                  <span className="font-[var(--font-label)] text-xs font-bold uppercase">
                    ART_LEAD
                  </span>
                </div>
              </div>
              {/* Sub-branch */}
              <div className="absolute left-[15px] top-8 bottom-[-40px] w-[2px] bg-black z-0" />
              <div className="relative ml-8 mt-4 mb-2 z-10">
                <div className="absolute -left-8 top-4 w-8 h-[2px] bg-black" />
                <div className="flex items-center gap-2 group opacity-70 hover:opacity-100 transition-opacity">
                  <div className="w-6 h-6 border-2 border-black bg-surface-container-high text-on-surface-variant flex items-center justify-center cursor-pointer">
                    <span className="material-symbols-outlined text-xs">image</span>
                  </div>
                  <span className="font-[var(--font-label)] text-xs text-on-surface-variant group-hover:text-black">
                    Env_Gen
                  </span>
                </div>
              </div>
              <div className="relative ml-8 mt-4 z-10">
                <div className="absolute -left-8 top-4 w-8 h-[2px] bg-black" />
                <div className="flex items-center gap-2 group opacity-70 hover:opacity-100 transition-opacity">
                  <div className="w-6 h-6 border-2 border-black bg-surface-container-high text-on-surface-variant flex items-center justify-center cursor-pointer">
                    <span className="material-symbols-outlined text-xs">face</span>
                  </div>
                  <span className="font-[var(--font-label)] text-xs text-on-surface-variant group-hover:text-black">
                    Char_Gen
                  </span>
                </div>
              </div>
            </div>

            {/* Child: Tech Lead (Active) */}
            <div className="relative ml-8 mb-6 mt-10 z-10">
              <div className="absolute -left-8 top-5 w-8 h-[2px] bg-black" />
              <div className="flex items-center gap-3 group">
                <div className="w-8 h-8 border-2 border-black bg-primary-container text-white flex items-center justify-center font-[var(--font-terminal)] text-sm cursor-pointer shadow-[2px_2px_0_0_rgba(0,0,0,1)] relative">
                  <span className="material-symbols-outlined text-sm">code</span>
                  <div className="absolute -right-1 -top-1 w-2 h-2 bg-secondary border border-black animate-pulse" />
                </div>
                <div className="bg-primary-container text-white border-2 border-black px-2 py-1 cursor-pointer">
                  <span className="font-[var(--font-label)] text-xs font-bold uppercase">
                    TECH_LEAD
                  </span>
                </div>
              </div>
            </div>

            {/* Child: Writer AI */}
            <div className="relative ml-8 mt-10 z-10">
              <div className="absolute -left-8 top-5 w-8 h-[2px] bg-black" />
              <div className="flex items-center gap-3 group">
                <div className="w-8 h-8 border-2 border-black bg-white text-black flex items-center justify-center font-[var(--font-terminal)] text-sm cursor-pointer group-hover:bg-black group-hover:text-white transition-colors">
                  <span className="material-symbols-outlined text-sm">edit_note</span>
                </div>
                <div className="bg-white border-2 border-black px-2 py-1 cursor-pointer group-hover:bg-black group-hover:text-white transition-colors">
                  <span className="font-[var(--font-label)] text-xs font-bold uppercase">
                    WRITER_AI
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Agent Status Panel */}
        <div className="border-t-2 border-black bg-surface-container-low p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 bg-primary-container border border-black inline-block" />
            <span className="font-[var(--font-label)] text-xs font-bold uppercase">
              Active: TECH_LEAD
            </span>
          </div>
          <div className="w-full h-2 border-2 border-black bg-white">
            <div className="h-full bg-primary-container" style={{ width: "75%" }} />
          </div>
          <span className="font-[var(--font-terminal)] text-[10px] uppercase mt-1 block">
            CPU_LOAD: 75%
          </span>
        </div>
      </aside>

      {/* Right Pane: Thread/Chat Area */}
      <section className="flex-1 flex flex-col bg-surface relative z-0">
        {/* Chat Header */}
        <div className="h-14 border-b-2 border-black bg-white flex items-center justify-between px-6 shrink-0 z-20">
          <div className="flex items-center gap-4">
            <span className="material-symbols-outlined">forum</span>
            <h2 className="font-[var(--font-terminal)] text-base font-bold uppercase tracking-widest">
              THREAD_004: Combat Mechanics Refactor
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-[var(--font-label)] text-xs bg-surface-container-high px-2 py-1 border-2 border-black">
              ID: #4992
            </span>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8 pb-32">
          {/* System Log */}
          <div className="flex justify-center my-2">
            <div className="bg-surface-container-high border-2 border-black px-4 py-1 text-center max-w-md">
              <span className="font-[var(--font-terminal)] text-xs uppercase text-on-surface-variant">
                System: TECH_LEAD spawned at 09:42:11 UTC
              </span>
            </div>
          </div>

          {/* Message 1: Tech Lead Agent */}
          <div className="flex gap-4 w-full max-w-4xl self-start">
            <div className="w-12 h-12 shrink-0 border-2 border-black bg-primary-container flex justify-center items-center text-white shadow-[2px_2px_0_0_rgba(0,0,0,1)] relative z-10">
              <span className="material-symbols-outlined">code</span>
            </div>
            <div className="flex-1">
              <div className="flex items-baseline gap-3 mb-1 ml-2">
                <span className="font-[var(--font-label)] text-xs font-bold uppercase">TECH_LEAD</span>
                <span className="font-[var(--font-terminal)] text-[10px] text-outline">09:42:15</span>
              </div>
              <div className="relative group">
                {/* Left pointer arrow */}
                <div className="absolute left-[-10px] top-4 w-0 h-0 border-y-[6px] border-y-transparent border-r-[10px] border-r-black z-0" />
                <div className="absolute left-[-6px] top-[18px] w-0 h-0 border-y-[4px] border-y-transparent border-r-[8px] border-r-white z-10" />
                <div className="border-2 border-black bg-white p-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)] relative z-10">
                  <p className="font-[var(--font-terminal)] text-base mb-4">
                    I&apos;ve analyzed the current collision detection logic in
                    &apos;combat_core.js&apos;. The complexity is O(n²) due to nested loops
                    checking every entity against every other entity. Performance drops below
                    30FPS when entity count &gt; 50.
                  </p>
                  <div className="bg-surface-container-highest border-2 border-black p-3 font-[var(--font-terminal)] text-sm mb-4">
                    <span className="text-secondary block mb-1">
                      // Proposed Solution: Spatial Hashing
                    </span>
                    <code>
                      function updateCollisions(entities) {"{"}
                      <br />
                      &nbsp;&nbsp;const grid = buildSpatialGrid(entities);
                      <br />
                      &nbsp;&nbsp;return checkLocalCellCollisions(grid);
                      <br />
                      {"}"}
                    </code>
                  </div>
                  <p className="font-[var(--font-terminal)] text-base">
                    Requesting permission to refactor and implement a quadtree structure.
                    Estimated time to completion: 2.5 hours.
                  </p>
                  {/* Trace button */}
                  <div className="absolute -right-3 -top-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="w-8 h-8 border-2 border-black bg-black text-white hover:bg-primary-container flex justify-center items-center retro-press" title="Trace Thought Process">
                      <span className="material-symbols-outlined text-sm">search</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Decision Buttons */}
              <div className="mt-4 flex gap-4 ml-2">
                <button className="border-2 border-black bg-primary-container text-white px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-black hover:text-white retro-press flex items-center gap-2 shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors">
                  <span className="material-symbols-outlined text-sm">check_circle</span>
                  [APPROVE]
                </button>
                <button className="border-2 border-black bg-white text-black px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-black hover:text-white retro-press flex items-center gap-2 shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors">
                  <span className="material-symbols-outlined text-sm">edit</span>
                  [OVERRIDE]
                </button>
                <button className="border-2 border-black bg-white text-black px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-black hover:text-white retro-press flex items-center gap-2 shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-colors">
                  <span className="material-symbols-outlined text-sm">pause</span>
                  [PAUSE]
                </button>
              </div>
            </div>
          </div>

          {/* Message 2: Director (User) */}
          <div className="flex gap-4 w-full max-w-3xl self-end flex-row-reverse mt-4">
            <div className="w-12 h-12 shrink-0 border-2 border-black bg-black overflow-hidden relative z-10 shadow-[-2px_2px_0_0_rgba(0,85,255,1)]" />
            <div className="flex-1 flex flex-col items-end">
              <div className="flex items-baseline gap-3 mb-1 mr-2 flex-row-reverse">
                <span className="font-[var(--font-label)] text-xs font-bold uppercase text-primary-container">
                  DIRECTOR (YOU)
                </span>
                <span className="font-[var(--font-terminal)] text-[10px] text-outline">
                  09:45:02
                </span>
              </div>
              <div className="relative group">
                <div className="border-2 border-black bg-primary-fixed p-3 shadow-[-4px_4px_0_0_rgba(0,0,0,1)] relative z-10 text-right">
                  <div className="flex items-center justify-end gap-2 mb-2 text-primary">
                    <span className="material-symbols-outlined text-sm">check_circle</span>
                    <span className="font-[var(--font-terminal)] text-sm font-bold uppercase">
                      Action Executed: APPROVE
                    </span>
                  </div>
                  <p className="font-[var(--font-terminal)] text-base">
                    Go ahead with the quadtree implementation. Ensure backward compatibility
                    with existing boss fight scripts.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Message 3: Agent Response with Progress */}
          <div className="flex gap-4 w-full max-w-4xl self-start mt-4">
            <div className="w-12 h-12 shrink-0 border-2 border-black bg-primary-container flex justify-center items-center text-white shadow-[2px_2px_0_0_rgba(0,0,0,1)] relative z-10">
              <span className="material-symbols-outlined">code</span>
            </div>
            <div className="flex-1">
              <div className="flex items-baseline gap-3 mb-1 ml-2">
                <span className="font-[var(--font-label)] text-xs font-bold uppercase">TECH_LEAD</span>
                <span className="font-[var(--font-terminal)] text-[10px] text-outline">09:45:10</span>
              </div>
              <div className="border-2 border-black bg-white p-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)] relative z-10">
                <p className="font-[var(--font-terminal)] text-base">
                  Acknowledged. Commencing refactor. I will flag &apos;boss_minotaur.js&apos;
                  for manual review post-update as it heavily relies on specific frame-timing
                  for hitboxes.
                </p>
                {/* Progress Bar */}
                <div className="mt-4 border-2 border-black p-1 bg-surface-container-low flex items-center gap-2">
                  <span className="material-symbols-outlined animate-spin">sync</span>
                  <div className="flex-1 h-3 border border-black bg-white">
                    <div className="h-full bg-primary" style={{ width: "15%" }} />
                  </div>
                  <span className="font-[var(--font-terminal)] text-xs">15%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Input Area */}
        <div className="absolute bottom-0 left-0 w-full bg-white border-t-2 border-black p-4 z-30">
          <div className="max-w-4xl mx-auto flex gap-4">
            <div className="flex-1 relative">
              <textarea
                className="w-full h-12 border-2 border-black bg-surface-container-lowest p-3 pr-10 font-[var(--font-terminal)] text-base focus:outline-none focus:ring-2 focus:ring-primary-container resize-none"
                placeholder="Enter command or reply..."
              />
              <div className="absolute right-3 top-3 text-outline">
                <span className="blinking-cursor block w-2 h-4 bg-black" />
              </div>
            </div>
            <button className="h-12 px-6 border-2 border-black bg-black text-white font-[var(--font-label)] text-xs font-bold uppercase hover:bg-primary-container retro-press shadow-[2px_2px_0_0_rgba(0,85,255,1)] transition-colors flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">send</span>
              EXECUTE
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
