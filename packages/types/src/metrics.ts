export interface AutonomousRunMetrics {
  sessionId: string;
  projectId: string;
  startedAt: string;
  lastUpdatedAt: string;
  totalIterations: number;
  completedCount: number;
  failedCount: number;
  totalDurationMs: number;
  estimatedTokens: number;
  qaGatePasses: number;
  qaGateFailures: number;
  milestoneIndex: number;
}

export interface RunMetricsData {
  runs: AutonomousRunMetrics[];
}
