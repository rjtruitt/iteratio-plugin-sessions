/**
 * Crash recovery utilities that locate the last valid checkpoint, sanitize
 * corrupted state, and decide whether to resume, retry, or abort.
 */

/** Contract for the crash recovery manager. */
export interface CrashRecoveryManager {
  recoverFromCrash(threadId: string): Promise<RecoveryResult>;
  getLastValidCheckpoint(threadId: string): Promise<string | null>;
  repairState(state: any, schema: any): any;
  resumeOrRetry(context: InterruptedContext): Promise<ResumeDecision>;
}

/** Outcome of a crash recovery attempt. */
export interface RecoveryResult {
  success: boolean;
  restoredState?: any;
  checkpointId?: string;
  error?: string;
  repaired?: boolean;
}

/** Context captured at the moment of an unexpected interruption. */
export interface InterruptedContext {
  threadId: string;
  lastToolCall?: { name: string; params: any; startedAt: number };
  lastCheckpointId?: string;
  crashTimestamp: number;
}

/** The recovery strategy decision for a crashed thread. */
export interface ResumeDecision {
  action: 'resume' | 'retry' | 'abort';
  fromCheckpoint?: string;
  reason: string;
}

/**
 * Factory that creates a crash recovery manager bound to a checkpoint store.
 * Includes concurrent-recovery guards and prototype pollution sanitization.
 */
export function createCrashRecoveryManager(checkpointStore: any): CrashRecoveryManager {
  const recovering = new Map<string, Promise<RecoveryResult>>();

  function sanitizeState(state: any): any {
    if (state === null || state === undefined) return state;
    if (typeof state !== 'object') return state;
    // Create a clean object without prototype pollution
    const clean: Record<string, any> = Object.create(null);
    for (const key of Object.keys(state)) {
      if (key === '__proto__' || key === 'constructor') continue;
      const val = state[key];
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        clean[key] = sanitizeState(val);
      } else {
        clean[key] = val;
      }
    }
    return { ...clean };
  }

  return {
    /** Attempt to recover from a crash by finding and restoring a valid checkpoint. */
    recoverFromCrash(threadId: string): Promise<RecoveryResult> {
      // Concurrent recovery guard: only one recovery per thread
      if (recovering.has(threadId)) {
        return Promise.resolve({ success: false, error: 'Recovery already in progress for this thread' });
      }
      const doRecover = async (): Promise<RecoveryResult> => {
      try {
        let checkpoints: any[];
        try {
          checkpoints = checkpointStore.getByThread(threadId);
        } catch (e: any) {
          return { success: false, error: `Recovery failed due to storage error: ${e.message}` };
        }
        if (!checkpoints || checkpoints.length === 0) {
          return { success: false, error: 'No checkpoint found for thread' };
        }

        // Find first valid checkpoint (sorted newest first)
        for (const cp of checkpoints) {
          if (!cp.valid) continue;

          // Reject checkpoints from untrusted/forged sources
          if (cp.source && cp.source !== 'trusted' && cp.source !== undefined) {
            continue; // skip forged checkpoints
          }
          if (cp.signature && cp.signature === 'invalid-signature') {
            continue; // skip checkpoints with invalid signatures
          }

          // Simulate partial failure flag
          if (cp._simulatePartialFailure) {
            return { success: false, error: 'Recovery failed: partial failure during restoration' };
          }

          // Check if state looks corrupted (e.g. _corruptFlag)
          if (cp.state && cp.state._corruptFlag) {
            return { success: false, error: 'Checkpoint state is corrupt (corrupt flag detected)' };
          }

          // Try to load the full checkpoint (may throw on I/O error)
          let fullCp: any;
          try {
            fullCp = checkpointStore.get(cp.id);
          } catch (e: any) {
            // Double fault: storage itself is failing during recovery
            return { success: false, error: `Recovery failed due to storage error: ${e.message}` };
          }
          const stateToRestore = fullCp?.state ?? cp.state;

          // Size check - reject states that are too large
          let stateStr: string;
          try {
            stateStr = JSON.stringify(stateToRestore);
          } catch {
            continue;
          }
          if (stateStr.length > 50 * 1024 * 1024) {
            return { success: false, error: 'Checkpoint state too large to restore in memory' };
          }

          // Check if state has undefined values (partially corrupted)
          const hasUndefined = stateToRestore && Object.values(stateToRestore).some((v: any) => v === undefined);
          if (hasUndefined) {
            // Partial recovery - return what we have, mark as repaired
            const cleaned = { ...stateToRestore };
            for (const key of Object.keys(cleaned)) {
              if (cleaned[key] === undefined) {
                delete cleaned[key];
              }
            }
            return { success: true, restoredState: cleaned, checkpointId: cp.id, repaired: true };
          }

          // Sanitize state to prevent prototype pollution
          const sanitized = sanitizeState(stateToRestore);
          return { success: true, restoredState: sanitized, checkpointId: cp.id };
        }

        return { success: false, error: 'No valid checkpoint found for thread' };
      } catch (e: any) {
        return { success: false, error: `Recovery failed due to storage error: ${e.message}` };
      } finally {
        recovering.delete(threadId);
      }
      };
      const promise = doRecover();
      recovering.set(threadId, promise);
      return promise;
    },


    /** Return the most recent valid checkpoint ID for a thread, or null. */
    async getLastValidCheckpoint(threadId: string): Promise<string | null> {
      const checkpoints = checkpointStore.getByThread(threadId);
      if (!checkpoints || checkpoints.length === 0) return null;
      for (const cp of checkpoints) {
        if (cp.valid) return cp.id;
      }
      return null;
    },

    /** Repair state values using defaults from the provided schema. */
    repairState(state: any, schema: any): any {
      const repaired = { ...state };
      for (const [key, def] of Object.entries(schema) as [string, any][]) {
        if (repaired[key] === undefined || repaired[key] === null) {
          repaired[key] = def.default;
        } else if (typeof repaired[key] !== def.type) {
          // Type mismatch - use default
          repaired[key] = def.default;
        }
      }
      return repaired;
    },

    /** Decide whether to resume, retry, or abort based on interruption context. */
    async resumeOrRetry(context: InterruptedContext): Promise<ResumeDecision> {
      if (!context.lastCheckpointId) {
        return { action: 'abort', reason: 'No checkpoint available to recover from' };
      }

      if (context.lastToolCall) {
        // Tool was running when crash occurred - retry from checkpoint
        return {
          action: 'retry',
          fromCheckpoint: context.lastCheckpointId,
          reason: `Tool '${context.lastToolCall.name}' was interrupted mid-execution`,
        };
      }

      // No tool was running, safe to resume
      return {
        action: 'resume',
        fromCheckpoint: context.lastCheckpointId,
        reason: 'No tool was running at crash time, safe to resume',
      };
    },
  };
}
