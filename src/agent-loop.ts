import type { CareStore } from './store/store.js';
import type { Notifier } from './notify/notifier.js';
import { runAgentAll } from './domain/agent-runner.js';

interface Log {
  info(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export interface AgentLoopDeps {
  store: CareStore;
  notifier: Notifier;
  log: Log;
}

/**
 * The interval that gives the agent a chance to act.
 *
 * The word "chance" is deliberate. This does not decide to do anything - it decides
 * how often to let the policy look, and the policy decides whether anything is worth
 * doing. So the cadence here is not a safety parameter (the policy's fatigue and
 * quiet-hours arithmetic is), it is only responsiveness: check often enough that an
 * ageing gap is noticed within the hour, rarely enough that a quiet household costs
 * nothing.
 *
 * Off unless CARECIRCLE_AGENT_INTERVAL_MS is set, so tests, local runs, and CI never
 * grow a background timer by surprise. Production sets it.
 */
export function startAgentLoop(deps: AgentLoopDeps): () => void {
  const ms = Number(process.env['CARECIRCLE_AGENT_INTERVAL_MS'] ?? 0);
  if (!Number.isFinite(ms) || ms <= 0) {
    deps.log.info('agent loop disabled', { reason: 'CARECIRCLE_AGENT_INTERVAL_MS not set' });
    return () => {};
  }

  let running = false;
  const tick = async (): Promise<void> => {
    // Never let two passes overlap: a slow notifier must not stack ticks into a
    // burst of duplicate asks. Skipping is safe because the policy is idempotent
    // over the fatigue window.
    if (running) return;
    running = true;
    try {
      const runs = await runAgentAll(deps);
      const asked = runs.reduce((n, r) => n + r.performed.length, 0);
      if (asked > 0) deps.log.info('agent acted', { households: runs.length, asked });
    } catch (err) {
      // An agent that crashes the process is worse than an agent that misses a tick.
      deps.log.error('agent tick failed', { reason: (err as Error).message });
    } finally {
      running = false;
    }
  };

  deps.log.info('agent loop enabled', { intervalMs: ms });
  const handle = setInterval(() => { void tick(); }, ms);
  handle.unref?.(); // the loop must never hold the process open on its own
  return () => clearInterval(handle);
}
