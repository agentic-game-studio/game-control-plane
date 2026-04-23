export default function SettingsPage() {
  return (
    <div className="p-[var(--spacing-margin)] min-h-full bg-background">
      {/* Page Header */}
      <header className="mb-[var(--spacing-lg)] border-b-4 border-black pb-[var(--spacing-sm)]">
        <h1 className="font-[var(--font-headline)] text-5xl font-bold text-on-background uppercase tracking-tight leading-none">
          Ledger &amp; Config
        </h1>
        <p className="font-[var(--font-terminal)] text-base text-outline mt-[var(--spacing-xs)] uppercase">
          System parameters and resource allocation.
        </p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-[var(--spacing-gutter)] items-start">
        {/* Left Column: Credit Management */}
        <section className="border-2 border-black bg-surface-container-lowest flex flex-col h-full">
          <div className="border-b-2 border-black bg-black text-white p-[var(--spacing-sm)] px-[var(--spacing-md)] flex justify-between items-center">
            <h2 className="font-[var(--font-headline)] text-2xl font-semibold uppercase m-0">
              Credit Management
            </h2>
            <span className="material-symbols-outlined text-white">monetization_on</span>
          </div>
          <div className="p-[var(--spacing-lg)] flex flex-col items-center justify-center flex-1 gap-[var(--spacing-lg)] bg-[#f0f0fd] relative overflow-hidden">
            {/* Corner decorations */}
            <div className="absolute top-0 left-0 w-4 h-4 border-r-2 border-b-2 border-black" />
            <div className="absolute top-0 right-0 w-4 h-4 border-l-2 border-b-2 border-black" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-r-2 border-t-2 border-black" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-l-2 border-t-2 border-black" />

            <div className="text-center w-full">
              <span className="font-[var(--font-label)] text-xs font-bold text-outline uppercase tracking-widest block mb-[var(--spacing-sm)]">
                Current Balance
              </span>
              <div className="border-4 border-black bg-black text-primary p-[var(--spacing-md)] inline-block w-full max-w-[400px]">
                <span
                  className="font-[var(--font-headline)] font-black block tracking-tighter leading-none"
                  style={{ fontSize: "80px", textShadow: "0 0 10px rgba(0,85,255,0.5)" }}
                >
                  84,200
                </span>
              </div>
            </div>
            <button className="border-2 border-black bg-primary text-on-primary font-[var(--font-headline)] text-2xl font-semibold uppercase px-[var(--spacing-xl)] py-[var(--spacing-md)] hover:bg-black hover:text-white retro-press flex items-center gap-[var(--spacing-sm)] mt-[var(--spacing-md)] w-full max-w-[400px] justify-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                generating_tokens
              </span>
              Insert Coin
            </button>
            <div className="w-full max-w-[400px] border-t-2 border-black pt-[var(--spacing-md)] mt-[var(--spacing-sm)] flex justify-between font-[var(--font-terminal)] text-sm">
              <span className="uppercase">Burn Rate: 120/hr</span>
              <span className="uppercase">Est. Depletion: 28 Days</span>
            </div>
          </div>
        </section>

        {/* Right Column: Core Configuration */}
        <section className="border-2 border-black bg-surface-container-lowest flex flex-col h-full">
          <div className="border-b-2 border-black bg-black text-white p-[var(--spacing-sm)] px-[var(--spacing-md)] flex justify-between items-center">
            <h2 className="font-[var(--font-headline)] text-2xl font-semibold uppercase m-0">
              Core Configuration
            </h2>
            <span className="material-symbols-outlined text-white">tune</span>
          </div>
          <div className="p-[var(--spacing-lg)] flex flex-col gap-[var(--spacing-lg)]">
            {/* Engine Selection */}
            <div className="flex flex-col gap-[var(--spacing-sm)]">
              <label className="font-[var(--font-label)] text-xs font-bold uppercase text-on-surface">
                Target Engine
              </label>
              <div className="flex border-2 border-black">
                {["Unity", "Unreal", "Godot"].map((engine, i) => (
                  <label
                    key={engine}
                    className="flex-1 text-center border-r-2 border-black last:border-r-0 cursor-pointer group relative"
                  >
                    <input
                      defaultChecked={i === 0}
                      className="peer sr-only"
                      name="engine"
                      type="radio"
                    />
                    <div className="p-[var(--spacing-sm)] bg-white peer-checked:bg-primary peer-checked:text-white group-hover:bg-black group-hover:text-white font-[var(--font-terminal)] text-base uppercase transition-colors">
                      {engine}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Model Dropdown */}
            <div className="flex flex-col gap-[var(--spacing-sm)] border-t-2 border-black pt-[var(--spacing-md)]">
              <label className="font-[var(--font-label)] text-xs font-bold uppercase text-on-surface">
                Asset Generation Model
              </label>
              <div className="relative w-full">
                <select className="w-full appearance-none border-2 border-black bg-white p-[var(--spacing-sm)] px-[var(--spacing-md)] font-[var(--font-terminal)] text-base uppercase focus:outline-none focus:ring-0 focus:bg-surface-container hover:bg-surface-container cursor-pointer">
                  <option>Studio XYZ Optimized (Fast)</option>
                  <option>Studio XYZ Ultra (High-Res)</option>
                  <option>Standard Legacy Model</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-[var(--spacing-md)] border-l-2 border-black bg-black text-white">
                  <span className="material-symbols-outlined">expand_more</span>
                </div>
              </div>
            </div>

            {/* Advanced Settings */}
            <div className="flex flex-col gap-[var(--spacing-sm)] border-t-2 border-black mt-[var(--spacing-md)] pt-[var(--spacing-md)]">
              <div className="flex items-center gap-[var(--spacing-xs)] mb-[var(--spacing-sm)]">
                <span className="material-symbols-outlined text-tertiary-container">warning</span>
                <h3 className="font-[var(--font-headline)] text-2xl font-semibold uppercase text-tertiary-container">
                  Advanced Parameters
                </h3>
              </div>
              <div className="border-2 border-black bg-surface-container p-[var(--spacing-md)] flex flex-col gap-[var(--spacing-md)]">
                <div className="flex flex-col gap-[var(--spacing-xs)]">
                  <label className="font-[var(--font-label)] text-xs font-bold uppercase text-on-surface">
                    External API Key
                  </label>
                  <input
                    className="border-2 border-black bg-white p-[var(--spacing-sm)] font-[var(--font-terminal)] text-base focus:outline-none focus:bg-primary-fixed w-full"
                    placeholder="ENTER KEY..."
                    type="password"
                    defaultValue="************************"
                  />
                </div>
                <div className="flex flex-col gap-[var(--spacing-xs)]">
                  <label className="font-[var(--font-label)] text-xs font-bold uppercase text-on-surface">
                    Webhook URL
                  </label>
                  <input
                    className="border-2 border-black bg-white p-[var(--spacing-sm)] font-[var(--font-terminal)] text-base focus:outline-none focus:bg-primary-fixed w-full"
                    type="text"
                    defaultValue="https://api.studio-xyz.com/v1/hook"
                  />
                </div>
                <button className="border-2 border-black bg-white text-black font-[var(--font-label)] text-xs font-bold uppercase px-[var(--spacing-md)] py-[var(--spacing-sm)] hover:bg-black hover:text-white retro-press transition-all self-end mt-[var(--spacing-sm)]">
                  Save Config
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
