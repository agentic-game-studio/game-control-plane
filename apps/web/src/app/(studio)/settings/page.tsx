"use client";

import { useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { DataLoader } from "@/components/DataLoader";
import { CreditPools } from "./components/CreditPools";
import { SubscriptionManagement } from "./components/SubscriptionManagement";
import { TopUpHistory } from "./components/TopUpHistory";
import { UsageLog } from "./components/UsageLog";
import { InsertCoinModal } from "./components/InsertCoinModal";

export default function SettingsPage() {
  const {
    data,
    loading,
    error,
    retry,
    updateSettings,
    topUp,
    upgradeTier,
  } = useSettings();

  const [isInsertCoinOpen, setIsInsertCoinOpen] = useState(false);

  return (
    <div className="flex flex-col h-full p-8 gap-6">
      {/* Header */}
      <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 border-2 border-black bg-black flex items-center justify-center text-white">
            <span className="material-symbols-outlined">account_balance_wallet</span>
          </div>
          <div>
            <h1 className="font-[var(--font-terminal)] text-xl font-bold uppercase tracking-widest">
              CREDIT LEDGER
            </h1>
            <span className="font-[var(--font-terminal)] text-xs text-[#737688] uppercase">
              {loading
                ? "BILLING AND SUBSCRIPTION MANAGEMENT // Initializing..."
                : error
                  ? "BILLING AND SUBSCRIPTION MANAGEMENT // Connection Lost"
                  : "BILLING AND SUBSCRIPTION MANAGEMENT // Online"}
            </span>
          </div>
        </div>
      </div>

      <DataLoader loading={loading} error={error} onRetry={retry}>
        <div className="flex-1 flex flex-col gap-6">
          {/* Row 1: Credit + Subscription */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <CreditPools
              credits={data.credits}
              onInsertCoin={() => setIsInsertCoinOpen(true)}
            />
            <SubscriptionManagement
              settings={data}
              onUpgradeTier={upgradeTier}
              onToggleAutoRenew={(value) => updateSettings({ autoRenew: value })}
            />
          </div>

          {/* Row 2: History + Usage */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <TopUpHistory entries={data.topUpHistory} />
            <UsageLog entries={data.usageLog} />
          </div>
        </div>
      </DataLoader>

      {/* Modals */}
      <InsertCoinModal
        isOpen={isInsertCoinOpen}
        onClose={() => setIsInsertCoinOpen(false)}
        onSubmit={topUp}
      />
    </div>
  );
}
