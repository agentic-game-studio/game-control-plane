export type GameEngine = "Unity" | "Unreal" | "Godot";

export interface CreditBalance {
  current: number;
  burnRatePerHour: number;
  estimatedDepletionDays: number;
}

export interface SettingsConfig {
  targetEngine: GameEngine;
  assetModel: string;
  externalApiKey?: string;
  webhookUrl?: string;
  creditBalance: CreditBalance;
}
