"use client";

import { useState } from "react";
import { TIER_DEFINITIONS, type SubscriptionTier } from "@game-studio/types";
import { Modal } from "@/components/Modal";

interface UpgradeTierModalProps {
  currentTier: SubscriptionTier;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (tier: SubscriptionTier) => Promise<unknown>;
}

export function UpgradeTierModal({ currentTier, isOpen, onClose, onSubmit }: UpgradeTierModalProps) {
  const [selected, setSelected] = useState<SubscriptionTier>(currentTier);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (selected === currentTier) {
      onClose();
      return;
    }
    setLoading(true);
    try {
      await onSubmit(selected);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="UPGRADE TIER"
      onSubmit={handleSubmit}
      submitLabel={loading ? "Upgrading..." : "CONFIRM UPGRADE"}
      submitDisabled={loading || selected === currentTier}
    >
      <div className="flex flex-col gap-3">
        <p className="font-[var(--font-terminal)] text-sm text-[#434656]">
          Select a new subscription tier. Your subscription credits will reset immediately.
        </p>
        {TIER_DEFINITIONS.map((tier) => {
          const isCurrent = tier.id === currentTier;
          const isSelected = tier.id === selected;
          return (
            <button
              key={tier.id}
              onClick={() => setSelected(tier.id)}
              className={`border-2 p-3 text-left transition-all ${
                isSelected
                  ? "border-[#0055FF] bg-[#f3f2ff] shadow-[4px_4px_0_0_#0055FF]"
                  : "border-black bg-white hover:bg-[#faf8ff]"
              } ${isCurrent ? "opacity-60" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-[var(--font-headline)] text-sm font-bold uppercase">
                  {tier.name}
                </span>
                <span className="font-[var(--font-terminal)] text-xs font-bold">
                  {tier.priceUsd === 0 ? "FREE" : `$${tier.priceUsd}/mo`}
                </span>
              </div>
              <div className="font-[var(--font-terminal)] text-[10px] text-[#737688] uppercase mt-1">
                {tier.maxProjects} Projects / {tier.weeklyCredits.toLocaleString()} Credits/Week
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {tier.features.map((f) => (
                  <span
                    key={f}
                    className="font-[var(--font-terminal)] text-[9px] uppercase bg-black text-white px-1.5 py-0.5"
                  >
                    {f}
                  </span>
                ))}
              </div>
              {isCurrent && (
                <span className="font-[var(--font-terminal)] text-[10px] text-[#0055FF] uppercase mt-2 block">
                  Current Plan
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
