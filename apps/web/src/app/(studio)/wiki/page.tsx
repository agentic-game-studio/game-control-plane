export default function WikiPage() {
  return (
    <div className="flex h-full">
      {/* Left Pane: File Explorer */}
      <aside className="w-[280px] border-r-2 border-black flex flex-col bg-surface shrink-0">
        <div className="h-10 border-b-2 border-black flex items-center px-[var(--spacing-sm)] bg-surface-container text-on-surface font-[var(--font-terminal)] text-sm uppercase">
          <span className="material-symbols-outlined mr-[var(--spacing-xs)] text-base">folder_open</span>
          SYS.DIR / LORE
        </div>
        <div className="flex-1 overflow-y-auto p-[var(--spacing-sm)] font-[var(--font-terminal)] text-xs font-bold uppercase flex flex-col gap-[var(--spacing-xs)]">
          <button className="w-full text-left p-[var(--spacing-xs)] border-2 border-transparent hover:border-black hover:bg-surface-container flex items-center gap-[var(--spacing-xs)]">
            <span className="material-symbols-outlined text-base">description</span>
            world_origins.md
          </button>
          <button className="w-full text-left p-[var(--spacing-xs)] border-2 border-black bg-primary-container text-on-primary flex items-center gap-[var(--spacing-xs)]">
            <span className="material-symbols-outlined text-base">description</span>
            lore_intro.md
          </button>
          <button className="w-full text-left p-[var(--spacing-xs)] border-2 border-transparent hover:border-black hover:bg-surface-container flex items-center gap-[var(--spacing-xs)]">
            <span className="material-symbols-outlined text-base">description</span>
            faction_sun.md
          </button>
          <button className="w-full text-left p-[var(--spacing-xs)] border-2 border-transparent hover:border-black hover:bg-surface-container flex items-center gap-[var(--spacing-xs)]">
            <span className="material-symbols-outlined text-base">description</span>
            faction_moon.md
          </button>
          <button className="w-full text-left p-[var(--spacing-xs)] border-2 border-transparent hover:border-black hover:bg-surface-container flex items-center gap-[var(--spacing-xs)] opacity-50">
            <span className="material-symbols-outlined text-base">lock</span>
            ancient_secrets.dat
          </button>
        </div>
      </aside>

      {/* Center Pane: Editor */}
      <section className="flex-1 flex flex-col bg-surface-container-lowest relative">
        <div className="h-10 border-b-2 border-black flex items-center px-[var(--spacing-md)] bg-surface-container text-on-surface font-[var(--font-terminal)] text-sm uppercase justify-between">
          <div className="flex items-center">
            <span className="material-symbols-outlined mr-[var(--spacing-xs)] text-base">edit_document</span>
            EDIT: lore_intro.md
          </div>
          <div className="flex gap-[var(--spacing-sm)]">
            <span className="text-[10px] border-2 border-black px-1 py-0.5 bg-white">Ln 14, Col 42</span>
            <span className="text-[10px] border-2 border-black px-1 py-0.5 bg-primary-container text-white">UTF-8</span>
          </div>
        </div>
        <div className="flex-1 p-[var(--spacing-lg)] font-[var(--font-terminal)] text-base leading-relaxed overflow-y-auto whitespace-pre-wrap">
          <p># THE FRACTURED ERA</p>
          <br />
          <p>&gt; SYS.LOG ENTRY: 042-ALPHA</p>
          <p>&gt; AUTHOR: ARCHIVIST_NULL</p>
          <br />
          <p>The world did not end with a bang, but with a series of minor integer overflows in the core planetary simulation engine.</p>
          <br />
          <p>Before the <strong>Great Formatting</strong>, the realm of Aethelgard was a contiguous landmass. Now, it exists as segmented chunks of memory, floating in the digital void.</p>
          <br />
          <p>## THE THREE LAWS OF SURVIVAL</p>
          <br />
          <p>1. Never trust a rendering artifact.</p>
          <p>2. Always keep a backup of your memory cores.</p>
          <p>3. The edges of the map are not the end of the world, they are just the beginning of the <span className="typewriter-cursor" /></p>
        </div>
      </section>

      {/* Right Pane: Knowledge Graph */}
      <aside className="w-[320px] border-l-2 border-black flex flex-col bg-surface-container shrink-0">
        <div className="h-10 border-b-2 border-black flex items-center px-[var(--spacing-sm)] bg-surface-container text-on-surface font-[var(--font-terminal)] text-sm uppercase">
          <span className="material-symbols-outlined mr-[var(--spacing-xs)] text-base">hub</span>
          NODE_MAP.EXE
        </div>
        <div
          className="flex-1 relative overflow-hidden bg-surface p-[var(--spacing-md)]"
          style={{
            backgroundImage: "radial-gradient(#d9d9e6 2px, transparent 2px)",
            backgroundSize: "16px 16px",
          }}
        >
          {/* Connection Lines */}
          <div className="absolute top-[80px] left-[60px] w-[120px] border-t-2 border-black origin-left rotate-[20deg]" />
          <div className="absolute top-[120px] left-[180px] w-[80px] border-t-2 border-black origin-left -rotate-45" />
          <div className="absolute top-[80px] left-[60px] w-[100px] border-l-2 border-black h-[140px] origin-top" />

          {/* Nodes */}
          <button
            className="absolute top-[60px] left-[40px] w-10 h-10 border-2 border-black bg-surface hover:bg-black hover:text-white flex items-center justify-center font-[var(--font-label)] text-xs retro-press z-10"
            title="world_origins.md"
          >
            O
          </button>
          <button
            className="absolute top-[100px] left-[160px] w-10 h-10 border-2 border-black bg-primary-container text-white flex items-center justify-center font-[var(--font-label)] text-xs retro-press z-10 shadow-[4px_4px_0px_#000]"
            title="lore_intro.md"
          >
            LI
          </button>
          <button
            className="absolute top-[40px] left-[220px] w-10 h-10 border-2 border-black bg-surface hover:bg-black hover:text-white flex items-center justify-center font-[var(--font-label)] text-xs retro-press z-10"
            title="faction_sun.md"
          >
            FS
          </button>
          <button
            className="absolute top-[200px] left-[40px] w-10 h-10 border-2 border-black bg-surface hover:bg-black hover:text-white flex items-center justify-center font-[var(--font-label)] text-xs retro-press z-10"
            title="faction_moon.md"
          >
            FM
          </button>

          {/* Legend */}
          <div className="absolute bottom-[var(--spacing-md)] left-[var(--spacing-md)] right-[var(--spacing-md)] border-2 border-black bg-white p-[var(--spacing-xs)] font-[var(--font-label)] text-xs font-bold uppercase flex justify-between items-center">
            <span>ACTIVE: lore_intro</span>
            <span className="flex gap-1">
              <span className="w-3 h-3 bg-primary-container border border-black inline-block" />
              <span className="w-3 h-3 bg-surface border border-black inline-block" />
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}
