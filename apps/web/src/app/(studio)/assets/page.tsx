export default function AssetsPage() {
  return (
    <div className="flex flex-col h-full">
      {/* Crafting Input Bar */}
      <header className="p-[var(--spacing-md)] border-b-2 border-on-surface bg-surface-container-lowest flex items-center gap-[var(--spacing-md)] z-10 shrink-0">
        <div className="flex-1 flex items-center gap-2 border-2 border-on-surface bg-white p-2">
          <span className="material-symbols-outlined text-on-surface ml-2">manufacturing</span>
          <input
            className="w-full bg-transparent border-none outline-none font-[var(--font-terminal)] text-base placeholder:text-outline p-0"
            placeholder="Prompt a new asset (e.g. 'Low poly health potion')..."
            type="text"
          />
        </div>
        <div className="relative border-2 border-on-surface bg-white shrink-0">
          <select className="appearance-none bg-transparent outline-none font-[var(--font-label)] text-xs font-bold uppercase py-3 pl-4 pr-10 cursor-pointer">
            <option value="retro_3d">Retro 3D (PS1)</option>
            <option value="pixel_art">Pixel Art (16-bit)</option>
            <option value="cel_shaded">Cel Shaded</option>
            <option value="high_res">High Res UI</option>
          </select>
          <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-sm">
            arrow_drop_down
          </span>
        </div>
        <button className="bg-primary-container text-on-primary border-2 border-on-surface font-[var(--font-label)] text-xs font-bold uppercase px-6 py-3 hover:bg-on-surface hover:text-on-primary retro-press transition-all flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined text-sm">bolt</span>
          Craft
        </button>
      </header>

      {/* Layout Wrapper */}
      <div className="flex flex-1 overflow-hidden">
        {/* Inventory Grid */}
        <section className="flex-1 p-[var(--spacing-gutter)] overflow-y-auto bg-surface relative">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-[var(--spacing-md)]">
            {/* Asset Item 1 */}
            <div className="border-2 border-on-surface bg-surface-container-lowest flex flex-col group cursor-pointer hover:-translate-y-1 hover:shadow-[4px_4px_0px_0px_rgba(25,27,37,1)] transition-all">
              <div className="aspect-square border-b-2 border-on-surface bg-surface-variant relative overflow-hidden flex items-center justify-center p-4">
                <div className="w-full h-full bg-gradient-to-br from-surface-container-high to-outline-variant opacity-60 flex items-center justify-center">
                  <span className="material-symbols-outlined text-5xl text-outline">view_in_ar</span>
                </div>
                <div className="absolute top-2 right-2 border-2 border-on-surface bg-white px-1 py-0.5 font-[var(--font-label)] text-[10px] font-bold uppercase">
                  3D
                </div>
              </div>
              <div className="p-[var(--spacing-sm)] flex flex-col gap-1">
                <div className="font-[var(--font-terminal)] text-sm font-bold truncate">
                  Iron_Sword_Tier1.obj
                </div>
                <div className="flex gap-2">
                  <span className="border-2 border-on-surface px-1 text-[10px] font-[var(--font-label)] font-bold uppercase bg-surface">
                    1.2 MB
                  </span>
                  <span className="border-2 border-on-surface px-1 text-[10px] font-[var(--font-label)] font-bold uppercase bg-primary-container text-white">
                    Prop
                  </span>
                </div>
              </div>
            </div>

            {/* Asset Item 2 */}
            <div className="border-2 border-on-surface bg-surface-container-lowest flex flex-col group cursor-pointer hover:-translate-y-1 hover:shadow-[4px_4px_0px_0px_rgba(25,27,37,1)] transition-all">
              <div className="aspect-square border-b-2 border-on-surface bg-surface-variant relative overflow-hidden flex items-center justify-center p-4">
                <div className="w-full h-full bg-gradient-to-br from-surface-container to-surface-container-high opacity-60 flex items-center justify-center">
                  <span className="material-symbols-outlined text-5xl text-outline">terminal</span>
                </div>
                <div className="absolute top-2 right-2 border-2 border-on-surface bg-white px-1 py-0.5 font-[var(--font-label)] text-[10px] font-bold uppercase">
                  2D
                </div>
              </div>
              <div className="p-[var(--spacing-sm)] flex flex-col gap-1">
                <div className="font-[var(--font-terminal)] text-sm font-bold truncate">
                  Terminal_Sprite_Sheet.png
                </div>
                <div className="flex gap-2">
                  <span className="border-2 border-on-surface px-1 text-[10px] font-[var(--font-label)] font-bold uppercase bg-surface">
                    256 KB
                  </span>
                  <span className="border-2 border-on-surface px-1 text-[10px] font-[var(--font-label)] font-bold uppercase bg-secondary-container text-white">
                    Env
                  </span>
                </div>
              </div>
            </div>

            {/* Asset Item 3 */}
            <div className="border-2 border-on-surface bg-surface-container-lowest flex flex-col group cursor-pointer hover:-translate-y-1 hover:shadow-[4px_4px_0px_0px_rgba(25,27,37,1)] transition-all">
              <div className="aspect-square border-b-2 border-on-surface bg-surface-variant relative overflow-hidden flex items-center justify-center p-4">
                <div className="w-full h-full bg-gradient-to-br from-tertiary-container to-surface-tint opacity-80" />
                <div className="absolute top-2 right-2 border-2 border-on-surface bg-white px-1 py-0.5 font-[var(--font-label)] text-[10px] font-bold uppercase">
                  VFX
                </div>
              </div>
              <div className="p-[var(--spacing-sm)] flex flex-col gap-1">
                <div className="font-[var(--font-terminal)] text-sm font-bold truncate">
                  Fireball_Impact.png
                </div>
                <div className="flex gap-2">
                  <span className="border-2 border-on-surface px-1 text-[10px] font-[var(--font-label)] font-bold uppercase bg-surface">
                    512 KB
                  </span>
                  <span className="border-2 border-on-surface px-1 text-[10px] font-[var(--font-label)] font-bold uppercase bg-on-surface text-white">
                    Tex
                  </span>
                </div>
              </div>
            </div>

            {/* Empty Slots */}
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="border-2 border-outline-variant bg-surface-container border-dashed flex flex-col aspect-square justify-center items-center opacity-50"
              >
                {i === 0 && (
                  <>
                    <span className="material-symbols-outlined text-outline text-3xl">add</span>
                    <span className="font-[var(--font-label)] text-xs font-bold uppercase mt-2 text-outline">
                      Empty Slot
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Art Bible Sidebar */}
        <aside className="w-80 border-l-2 border-on-surface bg-surface-container-lowest overflow-y-auto flex flex-col shrink-0">
          <div className="p-[var(--spacing-md)] border-b-2 border-on-surface bg-on-surface text-white flex items-center justify-between sticky top-0 z-10">
            <h2 className="font-[var(--font-terminal)] text-base font-bold uppercase tracking-tight flex items-center gap-2">
              <span className="material-symbols-outlined text-sm">menu_book</span>
              Art Bible
            </h2>
            <span className="border-2 border-white px-1 text-[10px] font-[var(--font-label)] font-bold uppercase">
              Global
            </span>
          </div>
          <div className="p-[var(--spacing-md)] flex flex-col gap-[var(--spacing-lg)]">
            {/* Resolution Slider */}
            <div className="flex flex-col gap-[var(--spacing-sm)]">
              <div className="flex justify-between items-center border-b-2 border-black pb-1">
                <label className="font-[var(--font-label)] text-xs font-bold uppercase">
                  Base Texture Res
                </label>
                <span className="font-[var(--font-terminal)] text-sm">256x256</span>
              </div>
              <div className="relative w-full h-4 border-2 border-on-surface bg-surface mt-2 cursor-pointer">
                <div className="absolute left-0 top-0 h-full bg-primary-container w-1/3 border-r-2 border-on-surface" />
                <div className="absolute left-1/3 top-1/2 -translate-y-1/2 w-4 h-6 bg-white border-2 border-on-surface hover:bg-surface-variant" />
              </div>
            </div>

            {/* Poly Limit Slider */}
            <div className="flex flex-col gap-[var(--spacing-sm)]">
              <div className="flex justify-between items-center border-b-2 border-black pb-1">
                <label className="font-[var(--font-label)] text-xs font-bold uppercase">
                  Max Polycount
                </label>
                <span className="font-[var(--font-terminal)] text-sm">1500 tris</span>
              </div>
              <div className="relative w-full h-4 border-2 border-on-surface bg-surface mt-2 cursor-pointer">
                <div className="absolute left-0 top-0 h-full bg-primary-container w-1/2 border-r-2 border-on-surface" />
                <div className="absolute left-1/2 top-1/2 -translate-y-1/2 w-4 h-6 bg-white border-2 border-on-surface hover:bg-surface-variant" />
              </div>
            </div>

            {/* Toggles */}
            <div className="flex flex-col gap-[var(--spacing-sm)] mt-4">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative w-5 h-5 border-2 border-on-surface bg-white group-hover:bg-surface-variant flex items-center justify-center">
                  <div className="w-3 h-3 bg-primary-container" />
                </div>
                <span className="font-[var(--font-label)] text-xs font-bold uppercase">
                  Enforce Palette
                </span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative w-5 h-5 border-2 border-on-surface bg-white group-hover:bg-surface-variant flex items-center justify-center" />
                <span className="font-[var(--font-label)] text-xs font-bold uppercase">
                  Strict Orthographic
                </span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative w-5 h-5 border-2 border-on-surface bg-white group-hover:bg-surface-variant flex items-center justify-center">
                  <div className="w-3 h-3 bg-primary-container" />
                </div>
                <span className="font-[var(--font-label)] text-xs font-bold uppercase">
                  Snap to Grid (8px)
                </span>
              </label>
            </div>

            {/* Save Button */}
            <button className="mt-8 border-2 border-on-surface bg-white px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-on-surface hover:text-white transition-colors flex justify-center items-center gap-2 w-full retro-press">
              <span className="material-symbols-outlined text-sm">save</span>
              Save Constraints
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
