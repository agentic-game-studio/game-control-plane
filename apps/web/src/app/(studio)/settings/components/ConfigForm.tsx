"use client";

import { useState, useEffect } from "react";
import type { SettingsConfig, GameEngine } from "@game-studio/types";

const ENGINE_OPTIONS: GameEngine[] = ["Unity", "Unreal", "Godot"];
const MODEL_OPTIONS = [
  "Studio XYZ Optimized (Fast)",
  "Studio XYZ Ultra (High-Res)",
  "Standard Legacy Model",
];

interface ConfigFormProps {
  settings: SettingsConfig;
  onSave: (updates: Partial<SettingsConfig>) => void | Promise<void>;
  saving?: boolean;
}

export function ConfigForm({ settings, onSave, saving }: ConfigFormProps) {
  const [engine, setEngine] = useState<GameEngine>(settings.targetEngine);
  const [assetModel, setAssetModel] = useState(settings.assetModel);
  const [apiKey, setApiKey] = useState(settings.externalApiKey ?? "");
  const [webhook, setWebhook] = useState(settings.webhookUrl ?? "");

  useEffect(() => {
    setEngine(settings.targetEngine);
    setAssetModel(settings.assetModel);
    setApiKey(settings.externalApiKey ?? "");
    setWebhook(settings.webhookUrl ?? "");
  }, [settings]);

  const handleSave = () => {
    onSave({
      targetEngine: engine,
      assetModel,
      externalApiKey: apiKey,
      webhookUrl: webhook,
    });
  };

  return (
    <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
      <div className="border-b-2 border-black bg-black text-white p-3 flex items-center justify-between">
        <span className="font-[var(--font-terminal)] text-xs font-bold uppercase tracking-wider">
          Core Configuration
        </span>
        <span className="material-symbols-outlined text-white">tune</span>
      </div>
      <div className="p-4 flex flex-col gap-4">
        {/* Target Engine */}
        <div className="flex flex-col gap-2">
          <label className="font-[var(--font-label)] text-[10px] font-bold uppercase text-[#737688] tracking-widest">
            Target Engine
          </label>
          <div className="flex border-2 border-black">
            {ENGINE_OPTIONS.map((opt) => (
              <label
                key={opt}
                className="flex-1 text-center border-r-2 border-black last:border-r-0 cursor-pointer group"
              >
                <input
                  type="radio"
                  name="engine"
                  value={opt}
                  checked={engine === opt}
                  onChange={() => setEngine(opt)}
                  className="sr-only peer"
                />
                <div className="p-2 bg-white peer-checked:bg-[#0055FF] peer-checked:text-white group-hover:bg-black group-hover:text-white font-[var(--font-terminal)] text-xs uppercase transition-colors">
                  {opt}
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Asset Model */}
        <div className="flex flex-col gap-2">
          <label className="font-[var(--font-label)] text-[10px] font-bold uppercase text-[#737688] tracking-widest">
            Asset Generation Model
          </label>
          <div className="relative">
            <select
              value={assetModel}
              onChange={(e) => setAssetModel(e.target.value)}
              className="w-full appearance-none border-2 border-black bg-white p-2 pr-10 font-[var(--font-terminal)] text-xs uppercase focus:outline-none focus:bg-[#f3f2ff] cursor-pointer"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 border-l-2 border-black bg-black text-white">
              <span className="material-symbols-outlined text-sm">expand_more</span>
            </div>
          </div>
        </div>

        {/* Advanced Parameters */}
        <div className="border-t-2 border-black pt-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#972500] text-sm">warning</span>
            <span className="font-[var(--font-headline)] text-sm font-bold uppercase text-[#972500]">
              Advanced Parameters
            </span>
          </div>

          <div className="border-2 border-black bg-[#f3f2ff] p-3 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="font-[var(--font-label)] text-[10px] font-bold uppercase text-[#737688]">
                External API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="ENTER KEY..."
                className="border-2 border-black bg-white p-2 font-[var(--font-terminal)] text-xs focus:outline-none focus:bg-[#f3f2ff] w-full placeholder-black/50"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-[var(--font-label)] text-[10px] font-bold uppercase text-[#737688]">
                Webhook URL
              </label>
              <input
                type="text"
                value={webhook}
                onChange={(e) => setWebhook(e.target.value)}
                placeholder="https://..."
                className="border-2 border-black bg-white p-2 font-[var(--font-terminal)] text-xs focus:outline-none focus:bg-[#f3f2ff] w-full placeholder-black/50"
              />
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="self-end border-2 border-black bg-white text-black px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-black hover:text-white active:translate-x-[2px] active:translate-y-[2px] transition-all disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Config"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
