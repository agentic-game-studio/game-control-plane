/**
 * Progress percentage helpers used by heartbeat / per-iteration
 * progress emitters in chat.ts and llm-service.ts. Centralized so
 * the cap, base, and increment aren't drift-prone across the
 * chat/messages handler, the chat agent loop, and the LLM service.
 *
 * The UI progress bar renders 0-100%, but we deliberately cap the
 * upper bound (85% in the heartbeat case, 90% in the per-iteration
 * case) so the bar never reaches "100% done" before the LLM
 * actually finishes — a premature 100% causes the user to think
 * the request is complete when it's still streaming the final
 * tool result.
 */

/** Base percentage for heartbeat-driven progress (matches the
 *  starting fill on the bar). */
const HEARTBEAT_BASE_PCT = 10;

/** Upper cap for heartbeat-driven progress. The LLM completion
 *  itself takes the bar to 100%; heartbeat is the "LLM is alive"
 *  indicator and should never claim completion. */
const HEARTBEAT_CAP_PCT = 85;

/** Linear increment per heartbeat tick. Each chat.ts heartbeat
 *  fires every 2s, so this is ~1.5% per second — fast enough to
 *  feel responsive, slow enough that the bar doesn't reach the
 *  cap before the LLM responds. */
const HEARTBEAT_INCREMENT_PCT = 3;

/** Linear increment per LLM tool-loop iteration. The LLM service
 *  fires this faster (once per iteration), so the increment is
 *  smaller than the heartbeat case to keep the bar smooth. */
const TOOL_ITERATION_INCREMENT_PCT = 2;

/** Compute the heartbeat-driven progress percentage. The bar
 *  starts at HEARTBEAT_BASE_PCT and climbs by
 *  HEARTBEAT_INCREMENT_PCT per tick, capped at HEARTBEAT_CAP_PCT.
 *  Pass `count = 0` to read the base value alone. */
export function heartbeatProgressPct(count: number): number {
  return Math.min(HEARTBEAT_CAP_PCT, HEARTBEAT_BASE_PCT + count * HEARTBEAT_INCREMENT_PCT);
}

/** Compute the per-iteration progress percentage within the LLM
 *  tool loop. Lower increment + same cap as heartbeat so the
 *  two emitters produce a continuous bar rather than stepping
 *  when the producer switches from LLM to chat routing. */
export function toolIterationProgressPct(iteration: number): number {
  return Math.min(HEARTBEAT_CAP_PCT, HEARTBEAT_BASE_PCT + iteration * TOOL_ITERATION_INCREMENT_PCT);
}
