export default function TicketsPage() {
  return (
    <div className="p-[var(--spacing-margin)] h-full flex flex-col gap-[var(--spacing-margin)] overflow-hidden bg-background">
      {/* Board Header */}
      <div className="flex justify-between items-end border-b-2 border-on-background pb-[var(--spacing-sm)]">
        <div>
          <h1 className="font-[var(--font-headline)] text-5xl font-bold text-on-background uppercase leading-none">
            Active_Quests
          </h1>
          <p className="font-[var(--font-terminal)] text-base text-on-surface-variant uppercase mt-[var(--spacing-xs)]">
            Sprint_04 // Alpha_Milestone
          </p>
        </div>
        <div className="flex gap-[var(--spacing-md)]">
          <button className="bg-surface-container-lowest text-on-background border-2 border-on-background font-[var(--font-label)] text-xs font-bold uppercase px-[var(--spacing-md)] py-[var(--spacing-sm)] hover:bg-on-background hover:text-on-primary retro-press transition-all">
            FILTER_LOG
          </button>
          <button className="bg-primary-container text-on-primary border-2 border-on-background font-[var(--font-label)] text-xs font-bold uppercase px-[var(--spacing-md)] py-[var(--spacing-sm)] hover:bg-on-background hover:text-on-primary retro-press transition-all flex items-center gap-[var(--spacing-xs)]">
            <span className="material-symbols-outlined text-base">add</span>
            INIT_QUEST
          </button>
        </div>
      </div>

      {/* Kanban Grid */}
      <div className="flex-grow grid grid-cols-4 gap-[var(--spacing-gutter)] overflow-hidden">
        {/* Column 1: Available */}
        <div className="flex flex-col gap-[var(--spacing-sm)] h-full border-r-2 border-outline-variant pr-[var(--spacing-gutter)] pb-[var(--spacing-xl)] overflow-y-auto">
          <div className="sticky top-0 bg-background z-10 py-[var(--spacing-xs)] mb-[var(--spacing-sm)] border-b-2 border-on-background flex justify-between items-center">
            <h3 className="font-[var(--font-headline)] text-2xl font-semibold uppercase">Available</h3>
            <span className="bg-on-background text-on-primary font-[var(--font-label)] text-xs font-bold px-2 py-1">
              3
            </span>
          </div>

          {/* Ticket Card */}
          <div className="bg-surface-container-lowest border-2 border-on-background p-[var(--spacing-md)] flex flex-col gap-[var(--spacing-md)] relative group hover:border-primary-container transition-colors cursor-pointer">
            <div className="flex justify-between items-start">
              <div className="font-[var(--font-label)] text-xs font-bold uppercase text-outline flex flex-col">
                <span>UI_CORE &gt; HUD_REWORK</span>
                <span className="text-on-background mt-[var(--spacing-xs)]">Design Minimap Shell</span>
              </div>
              <span className="bg-surface-variant border-2 border-on-background font-[var(--font-terminal)] text-xs px-1 font-bold">
                150cr
              </span>
            </div>
            <p className="font-[var(--font-body)] text-base line-clamp-3">
              Draft high-contrast border styles for the new minimap component matching the
              brutalist OS aesthetic.
            </p>
            <div className="flex justify-between items-end mt-auto pt-[var(--spacing-sm)] border-t-2 border-outline-variant">
              <div className="flex items-center gap-[var(--spacing-xs)]">
                <span className="material-symbols-outlined text-outline text-base">schedule</span>
                <span className="font-[var(--font-label)] text-xs font-bold text-outline uppercase">
                  Est. 4h
                </span>
              </div>
              <div className="w-8 h-8 border-2 border-on-background border-dashed flex items-center justify-center bg-surface-container-low text-outline">
                <span className="material-symbols-outlined text-base">person_add</span>
              </div>
            </div>
          </div>

          {/* Ticket Card 2 */}
          <div className="bg-surface-container-lowest border-2 border-on-background p-[var(--spacing-md)] flex flex-col gap-[var(--spacing-md)] relative group hover:border-primary-container transition-colors cursor-pointer">
            <div className="flex justify-between items-start">
              <div className="font-[var(--font-label)] text-xs font-bold uppercase text-outline flex flex-col">
                <span>ENV_ART &gt; SECTOR_7</span>
                <span className="text-on-background mt-[var(--spacing-xs)]">Model Terminal Props</span>
              </div>
              <span className="bg-surface-variant border-2 border-on-background font-[var(--font-terminal)] text-xs px-1 font-bold">
                300cr
              </span>
            </div>
            <p className="font-[var(--font-body)] text-base line-clamp-3">
              Create low-poly computer terminal assets with sharp edges and emission maps for
              screens.
            </p>
            <div className="flex justify-between items-end mt-auto pt-[var(--spacing-sm)] border-t-2 border-outline-variant">
              <div className="flex items-center gap-[var(--spacing-xs)]">
                <span className="material-symbols-outlined text-outline text-base">schedule</span>
                <span className="font-[var(--font-label)] text-xs font-bold text-outline uppercase">
                  Est. 8h
                </span>
              </div>
              <div className="w-8 h-8 border-2 border-on-background border-dashed flex items-center justify-center bg-surface-container-low text-outline">
                <span className="material-symbols-outlined text-base">person_add</span>
              </div>
            </div>
          </div>
        </div>

        {/* Column 2: In Progress */}
        <div className="flex flex-col gap-[var(--spacing-sm)] h-full border-r-2 border-outline-variant pr-[var(--spacing-gutter)] pb-[var(--spacing-xl)] overflow-y-auto">
          <div className="sticky top-0 bg-background z-10 py-[var(--spacing-xs)] mb-[var(--spacing-sm)] border-b-2 border-on-background flex justify-between items-center">
            <h3 className="font-[var(--font-headline)] text-2xl font-semibold uppercase text-primary-container">
              Processing
            </h3>
            <span className="bg-primary-container text-on-primary font-[var(--font-label)] text-xs font-bold px-2 py-1 border-2 border-primary-container">
              2
            </span>
          </div>

          <div className="bg-surface-container-lowest border-2 border-primary-container p-[var(--spacing-md)] flex flex-col gap-[var(--spacing-md)] relative shadow-[4px_4px_0px_#0055ff] transition-transform cursor-pointer">
            <div className="flex justify-between items-start">
              <div className="font-[var(--font-label)] text-xs font-bold uppercase text-outline flex flex-col">
                <span>SYS_ENG &gt; NET_CODE</span>
                <span className="text-primary-container mt-[var(--spacing-xs)]">
                  Optimize Sync Loop
                </span>
              </div>
              <span className="bg-primary-container text-on-primary border-2 border-primary-container font-[var(--font-terminal)] text-xs px-1 font-bold">
                500cr
              </span>
            </div>
            <p className="font-[var(--font-body)] text-base font-bold">
              Refactor the state synchronization loop to reduce bandwidth overhead by 15%.
            </p>
            <div className="flex justify-between items-end mt-auto pt-[var(--spacing-sm)] border-t-2 border-outline-variant">
              <div className="flex items-center gap-[var(--spacing-xs)]">
                <div className="w-2 h-2 bg-primary-container" />
                <span className="font-[var(--font-label)] text-xs font-bold text-primary-container uppercase">
                  Active
                </span>
              </div>
              <div className="w-8 h-8 border-2 border-on-background overflow-hidden bg-surface flex items-center justify-center">
                <span className="material-symbols-outlined text-base">smart_toy</span>
              </div>
            </div>
          </div>
        </div>

        {/* Column 3: QA Review */}
        <div className="flex flex-col gap-[var(--spacing-sm)] h-full border-r-2 border-outline-variant pr-[var(--spacing-gutter)] pb-[var(--spacing-xl)] overflow-y-auto">
          <div className="sticky top-0 bg-background z-10 py-[var(--spacing-xs)] mb-[var(--spacing-sm)] border-b-2 border-on-background flex justify-between items-center">
            <h3 className="font-[var(--font-headline)] text-2xl font-semibold uppercase text-tertiary-container">
              Verify
            </h3>
            <span className="bg-tertiary-container text-on-tertiary font-[var(--font-label)] text-xs font-bold px-2 py-1">
              1
            </span>
          </div>

          <div className="bg-surface-container-lowest border-2 border-tertiary-container p-[var(--spacing-md)] flex flex-col gap-[var(--spacing-md)] relative cursor-pointer">
            <div className="flex justify-between items-start">
              <div className="font-[var(--font-label)] text-xs font-bold uppercase text-outline flex flex-col">
                <span>VFX &gt; WEAPONS</span>
                <span className="text-tertiary-container mt-[var(--spacing-xs)]">
                  Plasma Rifle Decals
                </span>
              </div>
              <span className="bg-surface-variant border-2 border-on-background font-[var(--font-terminal)] text-xs px-1 font-bold">
                100cr
              </span>
            </div>
            <p className="font-[var(--font-body)] text-base line-through text-outline">
              Implement scorch mark decals for plasma projectile impacts on metal surfaces.
            </p>
            <div className="flex justify-between items-end mt-auto pt-[var(--spacing-sm)] border-t-2 border-outline-variant">
              <div className="flex items-center gap-[var(--spacing-xs)]">
                <span className="material-symbols-outlined text-tertiary-container text-base">
                  bug_report
                </span>
                <span className="font-[var(--font-label)] text-xs font-bold text-tertiary-container uppercase">
                  QA_PENDING
                </span>
              </div>
              <div className="w-8 h-8 border-2 border-on-background overflow-hidden bg-surface flex items-center justify-center">
                <span className="material-symbols-outlined text-base">smart_toy</span>
              </div>
            </div>
          </div>
        </div>

        {/* Column 4: Completed */}
        <div className="flex flex-col gap-[var(--spacing-sm)] h-full pb-[var(--spacing-xl)] overflow-y-auto opacity-70">
          <div className="sticky top-0 bg-background z-10 py-[var(--spacing-xs)] mb-[var(--spacing-sm)] border-b-2 border-outline-variant flex justify-between items-center">
            <h3 className="font-[var(--font-headline)] text-2xl font-semibold uppercase text-outline">
              Archived
            </h3>
            <span className="bg-surface-variant text-outline font-[var(--font-label)] text-xs font-bold px-2 py-1 border-2 border-outline-variant">
              4
            </span>
          </div>

          <div className="bg-surface-container-low border-2 border-outline-variant p-[var(--spacing-md)] flex flex-col gap-[var(--spacing-md)] cursor-pointer">
            <div className="flex justify-between items-start">
              <div className="font-[var(--font-label)] text-xs font-bold uppercase text-outline flex flex-col">
                <span>AUDIO &gt; AMBIENCE</span>
                <span className="text-on-background mt-[var(--spacing-xs)]">Server Room Hum</span>
              </div>
              <span className="text-outline font-[var(--font-terminal)] text-xs px-1 font-bold">
                50cr
              </span>
            </div>
            <p className="font-[var(--font-body)] text-base text-outline">
              Mix and master looping drone sound for the mainframe level.
            </p>
            <div className="flex justify-between items-end mt-auto pt-[var(--spacing-sm)] border-t-2 border-outline-variant">
              <div className="flex items-center gap-[var(--spacing-xs)]">
                <span className="material-symbols-outlined text-outline text-base">done_all</span>
                <span className="font-[var(--font-label)] text-xs font-bold text-outline uppercase">
                  Logged
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
