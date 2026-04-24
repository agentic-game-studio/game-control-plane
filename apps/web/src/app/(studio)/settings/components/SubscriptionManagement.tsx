"use client";

import { TIER_DEFINITIONS, type SettingsConfig } from "@game-studio/types";

interface SubscriptionManagementProps {
  settings: SettingsConfig;
  onUpgradeTier: (tier: SettingsConfig["tier"]) => void | Promise<unknown>;
  onToggleAutoRenew: (value: boolean) => void | Promise<unknown>;
}

export function SubscriptionManagement({
  settings,
  onUpgradeTier,
  onToggleAutoRenew,
}: SubscriptionManagementProps) {
  const currentTier = TIER_DEFINITIONS.find((t) => t.id === settings.tier);

  const resetDate = new Date(settings.credits.subscription.resetAt).toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    }
  ).toUpperCase();

  return (
    <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)]">
      <div className="border-b-2 border-black bg-black text-white p-3 flex items-center justify-between">
        <span className="font-[var(--font-terminal)] text-xs font-bold uppercase tracking-wider">
          Subscription Management
        </span>
      </div>
      <div className="p-4 flex flex-col gap-4">
        {/* Current Plan */}
        <div>
          <span className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest block mb-2">
            Current Plan
          </span>
          <div className="border-2 border-black bg-white p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-[var(--font-headline)] text-lg font-bold uppercase">
                  {currentTier?.name} Tier
                </h3>
                <span className="font-[var(--font-terminal)] text-[10px] text-[#737688] uppercase">
                  Next Billing: {resetDate}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-[var(--font-terminal)] text-[10px] uppercase text-[#737688]">
                  Auto-Renew:
                </span>
                <button
                  onClick={() => onToggleAutoRenew(!settings.autoRenew)}
                  className={`w-10 h-5 border-2 border-black relative transition-colors ${
                    settings.autoRenew ? "bg-[#0055FF]" : "bg-[#c3c5d9]"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-3.5 h-3.5 bg-white border border-black transition-all ${
                      settings.autoRenew ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Upgrade Plan */}
        <div>
          <span className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest block mb-2">
            Upgrade Plan
          </span>
          <div className="border-2 border-black bg-black p-3">
            <div className="grid grid-cols-4 gap-2">
              {TIER_DEFINITIONS.map((tier) => {
                const isCurrent = tier.id === settings.tier;
                return (
                  <div key={tier.id} className="flex flex-col gap-2 text-center">
                    {/* Tier Name */}
                    <span className="font-[var(--font-headline)] text-xs font-bold uppercase text-white">
                      {tier.name}
                    </span>
                    {/* Price */}
                    <span className="font-[var(--font-terminal)] text-[10px] text-[#737688] uppercase">
                      {tier.priceUsd === 0 ? "Free" : `$${tier.priceUsd}/mo`}
                    </span>
                    {/* Action Button */}
                    <button
                      onClick={() => !isCurrent && onUpgradeTier(tier.id)}
                      disabled={isCurrent}
                      className={`border-2 py-1.5 font-[var(--font-terminal)] text-[10px] font-bold uppercase transition-colors ${
                        isCurrent
                          ? "border-[#737688] bg-[#737688] text-white cursor-default"
                          : "border-white bg-black text-white hover:bg-white hover:text-black"
                      }`}
                    >
                      {isCurrent ? "Current" : tier.priceUsd === 0 ? "Select" : "Upgrade"}
                    </button>
                    {/* Projects */}
                    <span className="font-[var(--font-terminal)] text-[9px] text-white uppercase">
                      {tier.maxProjects} {tier.maxProjects === 1 ? "Project" : "Projects"}
                    </span>
                    {/* Credits */}
                    <span className="font-[var(--font-terminal)] text-[9px] text-[#737688] uppercase">
                      {tier.weeklyCredits.toLocaleString()} Credit/Week
                    </span>
                    {/* Features */}
                    {tier.features.slice(2).map((f) => (
                      <span
                        key={f}
                        className="font-[var(--font-terminal)] text-[9px] text-[#737688] uppercase"
                      >
                        {f.startsWith("Custom") || f.startsWith("Early") || f.startsWith("Special")
                          ? f
                          : `+${f}`}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
