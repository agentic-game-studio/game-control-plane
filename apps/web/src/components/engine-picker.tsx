"use client";

import { useMemo } from "react";
import type { ProjectEngine } from "@game-studio/types";

const ENGINES: {
  engine: ProjectEngine;
  label: string;
  tagline: string;
  icon: string;
  badge?: string;
  disabled?: boolean;
}[] = [
  { engine: "godot", label: "Godot", tagline: "Open-source 2D/3D engine", icon: "🎮" },
  { engine: "phaser", label: "Phaser", tagline: "2D web-native games", icon: "🌐" },
  { engine: "threejs", label: "Three.js", tagline: "3D web with WebGL/WebGPU", icon: "🧊" },
  { engine: "babylon", label: "Babylon.js", tagline: "Full-featured 3D web engine", icon: "🔷" },
  { engine: "unity", label: "Unity", tagline: "Industry-standard native engine", icon: "🧩" },
  { engine: "unreal", label: "Unreal Engine", tagline: "High-fidelity native 3D", icon: "⚔️" },
  { engine: "bevy", label: "Bevy", tagline: "Rust game engine", icon: "🦀", disabled: true, badge: "coming soon" },
  { engine: "playcanvas", label: "PlayCanvas", tagline: "Web-first engine", icon: "▶️", disabled: true, badge: "coming soon" },
];

/**
 * Recommend an engine based on a free-form concept string.
 */
export function recommendEngine(concept: string): ProjectEngine {
  const lowered = concept.toLowerCase();
  if (lowered.includes("3d") || lowered.includes("webgl") || lowered.includes("webgpu")) {
    return lowered.includes("babylon") ? "babylon" : "threejs";
  }
  if (lowered.includes("2d") || lowered.includes("web") || lowered.includes("browser")) {
    return "phaser";
  }
  if (lowered.includes("unity")) return "unity";
  if (lowered.includes("unreal")) return "unreal";
  if (lowered.includes("godot")) return "godot";
  return "godot";
}

interface EnginePickerProps {
  value: ProjectEngine;
  onChange: (engine: ProjectEngine) => void;
  showRecommendation?: boolean;
  concept?: string;
}

export function EnginePicker({ value, onChange, showRecommendation, concept }: EnginePickerProps) {
  const recommended = useMemo(
    () => (showRecommendation ? recommendEngine(concept ?? "") : null),
    [showRecommendation, concept],
  );

  return (
    <div className="grid grid-cols-2 gap-3">
      {ENGINES.map(({ engine, label, tagline, icon, badge, disabled }) => {
        const isSelected = value === engine;
        const isRecommended = recommended === engine;
        return (
          <button
            key={engine}
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onChange(engine)}
            className={`relative border-2 p-3 text-left transition-colors ${
              disabled
                ? "border-[#e1e1ef] bg-[#faf8ff]/50 opacity-60 cursor-not-allowed"
                : isSelected
                  ? "border-black bg-black text-white"
                  : "border-[#e1e1ef] bg-[#faf8ff] hover:border-black hover:text-black"
            }`}
          >
            <div className="flex items-start justify-between">
              <span className="text-2xl">{icon}</span>
              {isRecommended && !disabled && (
                <span className="bg-[#2ECC71] px-1.5 py-0.5 font-[var(--font-label)] text-[8px] font-bold uppercase text-white">
                  Recommended
                </span>
              )}
              {badge && (
                <span className="bg-[#737688] px-1.5 py-0.5 font-[var(--font-label)] text-[8px] font-bold uppercase text-white">
                  {badge}
                </span>
              )}
            </div>
            <div className="mt-2 font-[var(--font-label)] text-xs font-bold uppercase">
              {label}
            </div>
            <div className="mt-1 font-[var(--font-terminal)] text-[10px] opacity-80">
              {tagline}
            </div>
          </button>
        );
      })}
    </div>
  );
}
