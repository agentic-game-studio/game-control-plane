"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import type { SettingsConfig } from "@game-studio/types";
import { DataLoader } from "@/components/DataLoader";

const engines = ["Unity", "Unreal", "Godot"] as const;
const models = [
  "Studio XYZ Optimized (Fast)",
  "Studio XYZ Ultra (High-Res)",
  "Standard Legacy Model",
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const fetchData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    setError(null);
    try {
      const settingsData = await apiFetch<SettingsConfig>("/api/settings");
      setSettings(settingsData);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load settings";
      setError(message);
      console.error("Failed to fetch settings:", err);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(true);
  }, [fetchData, retryCount]);

  const handleRetry = () => {
    setRetryCount((c) => c + 1);
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await apiFetch<SettingsConfig>("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Reset all settings to default? This cannot be undone.")) return;
    setSaving(true);
    try {
      const data = await apiFetch<SettingsConfig>("/api/settings/reset", { method: "POST" });
      setSettings(data);
    } catch (error) {
      console.error("Failed to reset settings:", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DataLoader loading={loading} error={error} onRetry={handleRetry}>
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
                  {settings?.creditBalance.current.toLocaleString() ?? "—"}
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
              <span className="uppercase">
                Burn Rate: {settings?.creditBalance.burnRatePerHour ?? "—"}/hr
              </span>
              <span className="uppercase">
                Est. Depletion: {settings?.creditBalance.estimatedDepletionDays ?? "—"} Days
              </span>
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
                {engines.map((engine, i) => (
                  <label
                    key={engine}
                    className="flex-1 text-center border-r-2 border-black last:border-r-0 cursor-pointer group relative"
                  >
                    <input
                      checked={settings?.targetEngine === engine}
                      onChange={() => setSettings((prev) => prev ? { ...prev, targetEngine: engine } : null)}
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
                <select
                  value={settings?.assetModel ?? ""}
                  onChange={(e) => setSettings((prev) => prev ? { ...prev, assetModel: e.target.value } : null)}
                  className="w-full appearance-none border-2 border-black bg-white p-[var(--spacing-sm)] px-[var(--spacing-md)] font-[var(--font-terminal)] text-base uppercase focus:outline-none focus:ring-0 focus:bg-surface-container hover:bg-surface-container cursor-pointer"
                >
                  {models.map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
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
                    value={settings?.externalApiKey ?? ""}
                    onChange={(e) => setSettings((prev) => prev ? { ...prev, externalApiKey: e.target.value } : null)}
                  />
                </div>
                <div className="flex flex-col gap-[var(--spacing-xs)]">
                  <label className="font-[var(--font-label)] text-xs font-bold uppercase text-on-surface">
                    Webhook URL
                  </label>
                  <input
                    className="border-2 border-black bg-white p-[var(--spacing-sm)] font-[var(--font-terminal)] text-base focus:outline-none focus:bg-primary-fixed w-full"
                    type="text"
                    value={settings?.webhookUrl ?? ""}
                    onChange={(e) => setSettings((prev) => prev ? { ...prev, webhookUrl: e.target.value } : null)}
                  />
                </div>
                <div className="flex gap-2 self-end mt-[var(--spacing-sm)]">
                  <button
                    onClick={handleReset}
                    disabled={saving}
                    className="border-2 border-black bg-surface text-black font-[var(--font-label)] text-xs font-bold uppercase px-[var(--spacing-md)] py-[var(--spacing-sm)] hover:bg-black hover:text-white retro-press transition-all disabled:opacity-50"
                  >
                    Reset
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="border-2 border-black bg-white text-black font-[var(--font-label)] text-xs font-bold uppercase px-[var(--spacing-md)] py-[var(--spacing-sm)] hover:bg-black hover:text-white retro-press transition-all disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save Config"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      </div>
    </DataLoader>
  );
}
