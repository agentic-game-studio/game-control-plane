export type GameEngine = "Unity" | "Unreal" | "Godot";

export type SubscriptionTier = "novice" | "artisan" | "master" | "legend";

export interface TierInfo {
  id: SubscriptionTier;
  name: string;
  maxProjects: number;
  weeklyCredits: number;
  priceUsd: number;
  features: string[];
}

export const TIER_DEFINITIONS: TierInfo[] = [
  {
    id: "novice",
    name: "Novice",
    maxProjects: 1,
    weeklyCredits: 1000,
    priceUsd: 0,
    features: ["1 Project", "1,000 Credits/Week"],
  },
  {
    id: "artisan",
    name: "Artisan",
    maxProjects: 5,
    weeklyCredits: 10000,
    priceUsd: 29,
    features: ["5 Projects", "10,000 Credits/Week", "Custom Model"],
  },
  {
    id: "master",
    name: "Master",
    maxProjects: 10,
    weeklyCredits: 50000,
    priceUsd: 99,
    features: ["10 Projects", "50,000 Credits/Week", "Custom Model", "Early Access"],
  },
  {
    id: "legend",
    name: "Legend",
    maxProjects: 20,
    weeklyCredits: 150000,
    priceUsd: 299,
    features: ["20 Projects", "150,000 Credits/Week", "Custom Model", "Early Access", "Special Support"],
  },
];

export interface CreditPools {
  subscription: {
    current: number;
    weeklyAllowance: number;
    resetAt: string;
  };
  onTop: {
    current: number;
    totalPurchased: number;
  };
  burnRatePerHour: number;
}

export interface TopUpEntry {
  id: string;
  amount: number;
  timestamp: string;
}

export interface UsageLogEntry {
  id: string;
  taskName: string;
  creditsUsed: number;
  timestamp: string;
}

export interface SettingsConfig {
  targetEngine: GameEngine;
  assetModel: string;
  externalApiKey?: string;
  webhookUrl?: string;
  tier: SubscriptionTier;
  autoRenew: boolean;
  credits: CreditPools;
  topUpHistory: TopUpEntry[];
  usageLog: UsageLogEntry[];
}

export const DEFAULT_SETTINGS: SettingsConfig = {
  targetEngine: "Unity",
  assetModel: "Studio XYZ Optimized (Fast)",
  externalApiKey: "",
  webhookUrl: "",
  tier: "novice",
  autoRenew: true,
  credits: {
    subscription: {
      current: 1000,
      weeklyAllowance: 1000,
      resetAt: getNextResetDate(),
    },
    onTop: {
      current: 0,
      totalPurchased: 0,
    },
    burnRatePerHour: 120,
  },
  topUpHistory: [],
  usageLog: [],
};

function getNextResetDate(): string {
  const now = new Date();
  const next = new Date(now);
  next.setDate(now.getDate() + 7);
  next.setHours(0, 0, 0, 0);
  return next.toISOString();
}
