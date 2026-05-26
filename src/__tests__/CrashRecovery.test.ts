import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCrashRecoveryManager, CrashRecoveryManager, InterruptedContext, RecoveryResult } from '../CrashRecovery';

describe('CrashRecovery', () => {
  let recovery: CrashRecoveryManager;
  let mockCheckpointStore: any;

  beforeEach(() => {
    mockCheckpointStore = {
      checkpoints: new Map<string, any>(),
      getByThread: vi.fn().mockImplementation((threadId: string) => {
        return Array.from(mockCheckpointStore.checkpoints.values())
          .filter((c: any) => c.threadId === threadId)
          .sort((a: any, b: any) => b.timestamp - a.timestamp);
      }),
      get: vi.fn().mockImplementation((id: string) => {
        return mockCheckpointStore.checkpoints.get(id) || null;
      }),
    };

    // Add some test checkpoints
    mockCheckpointStore.checkpoints.set('cp-1', {
      id: 'cp-1',
      threadId: 'thread-1',
      turnNumber: 3,
      timestamp: 1000,
      state: { messages: ['a', 'b', 'c'], counter: 3 },
      valid: true,
    });
    mockCheckpointStore.checkpoints.set('cp-2', {
      id: 'cp-2',
      threadId: 'thread-1',
      turnNumber: 5,
      timestamp: 2000,
      state: { messages: ['a', 'b', 'c', 'd', 'e'], counter: 5 },
      valid: true,
    });
    mockCheckpointStore.checkpoints.set('cp-corrupted', {
      id: 'cp-corrupted',
      threadId: 'thread-1',
      turnNumber: 7,
      timestamp: 3000,
      state: null, // corrupted
      valid: false,
    });

    recovery = createCrashRecoveryManager(mockCheckpointStore);
  });

  describe('mid-turn crash recovery', () => {
    it('should restore from the last valid checkpoint', async () => {
      const result = await recovery.recoverFromCrash('thread-1');

      expect(result.success).toBe(true);
      expect(result.restoredState).toBeDefined();
      expect(result.checkpointId).toBe('cp-2'); // latest valid
    });

    it('should skip corrupted checkpoints and use previous valid one', async () => {
      // Make cp-2 also corrupted
      mockCheckpointStore.checkpoints.set('cp-2', {
        ...mockCheckpointStore.checkpoints.get('cp-2'),
        valid: false,
        state: null,
      });

      const result = await recovery.recoverFromCrash('thread-1');

      expect(result.success).toBe(true);
      expect(result.checkpointId).toBe('cp-1'); // falls back to earlier
    });

    it('should return failure when no valid checkpoints exist', async () => {
      const result = await recovery.recoverFromCrash('thread-no-checkpoints');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no.*checkpoint|not found/i);
    });
  });

  describe('partial state recovery', () => {
    it('should recover partial state when full state is unavailable', async () => {
      mockCheckpointStore.checkpoints.set('cp-partial', {
        id: 'cp-partial',
        threadId: 'thread-partial',
        turnNumber: 4,
        timestamp: 1500,
        state: { messages: ['a', 'b'], counter: undefined }, // partially corrupted
        valid: true,
      });

      const result = await recovery.recoverFromCrash('thread-partial');

      expect(result.success).toBe(true);
      expect(result.restoredState.messages).toEqual(['a', 'b']);
      expect(result.repaired).toBe(true);
    });
  });

  describe('state repair', () => {
    it('should fill missing fields with defaults', () => {
      const schema = {
        counter: { type: 'number', default: 0 },
        messages: { type: 'array', default: [] },
        status: { type: 'string', default: 'idle' },
      };

      const brokenState = { counter: 5 }; // missing messages, status
      const repaired = recovery.repairState(brokenState, schema);

      expect(repaired.counter).toBe(5); // existing value preserved
      expect(repaired.messages).toEqual([]); // filled with default
      expect(repaired.status).toBe('idle'); // filled with default
    });

    it('should not overwrite existing valid fields', () => {
      const schema = {
        counter: { type: 'number', default: 0 },
        name: { type: 'string', default: 'unknown' },
      };

      const state = { counter: 42, name: 'agent-1' };
      const repaired = recovery.repairState(state, schema);

      expect(repaired.counter).toBe(42);
      expect(repaired.name).toBe('agent-1');
    });

    it('should correct type mismatches', () => {
      const schema = {
        counter: { type: 'number', default: 0 },
        active: { type: 'boolean', default: false },
      };

      const state = { counter: 'not-a-number', active: 'yes' };
      const repaired = recovery.repairState(state, schema);

      expect(typeof repaired.counter).toBe('number');
      expect(typeof repaired.active).toBe('boolean');
    });
  });

  describe('recovery from corrupted checkpoint', () => {
    it('should skip corrupted checkpoint to previous valid one', async () => {
      const result = await recovery.recoverFromCrash('thread-1');

      // cp-corrupted is latest but invalid, should use cp-2
      expect(result.success).toBe(true);
      expect(result.checkpointId).toBe('cp-2');
    });

    it('should report which checkpoint was used after skipping', async () => {
      mockCheckpointStore.checkpoints.set('cp-2', {
        ...mockCheckpointStore.checkpoints.get('cp-2'),
        valid: false,
      });

      const result = await recovery.recoverFromCrash('thread-1');
      expect(result.checkpointId).toBe('cp-1');
    });
  });

  describe('tool execution interrupted', () => {
    it('should decide to retry when tool was interrupted mid-execution', async () => {
      const context: InterruptedContext = {
        threadId: 'thread-1',
        lastToolCall: { name: 'web_search', params: { query: 'test' }, startedAt: Date.now() - 5000 },
        lastCheckpointId: 'cp-2',
        crashTimestamp: Date.now(),
      };

      const decision = await recovery.resumeOrRetry(context);

      expect(decision.action).toBe('retry');
      expect(decision.fromCheckpoint).toBe('cp-2');
    });

    it('should decide to resume when crash was after tool completion', async () => {
      const context: InterruptedContext = {
        threadId: 'thread-1',
        lastToolCall: undefined, // no tool was running
        lastCheckpointId: 'cp-2',
        crashTimestamp: Date.now(),
      };

      const decision = await recovery.resumeOrRetry(context);

      expect(decision.action).toBe('resume');
    });

    it('should abort when no checkpoint available', async () => {
      const context: InterruptedContext = {
        threadId: 'thread-empty',
        lastCheckpointId: undefined,
        crashTimestamp: Date.now(),
      };

      const decision = await recovery.resumeOrRetry(context);

      expect(decision.action).toBe('abort');
      expect(decision.reason).toMatch(/no.*checkpoint/i);
    });

    it('should retry with idempotency guard for non-idempotent tools', async () => {
      const context: InterruptedContext = {
        threadId: 'thread-1',
        lastToolCall: { name: 'send_email', params: { to: 'user@test.com' }, startedAt: Date.now() - 1000 },
        lastCheckpointId: 'cp-2',
        crashTimestamp: Date.now(),
      };

      const decision = await recovery.resumeOrRetry(context);

      // For non-idempotent tools, should either skip or have a guard
      expect(['resume', 'retry']).toContain(decision.action);
      expect(decision.reason).toBeDefined();
    });
  });

  describe('getLastValidCheckpoint', () => {
    it('should return the most recent valid checkpoint ID', async () => {
      const id = await recovery.getLastValidCheckpoint('thread-1');
      expect(id).toBe('cp-2');
    });

    it('should return null when no valid checkpoints exist', async () => {
      const id = await recovery.getLastValidCheckpoint('thread-nonexistent');
      expect(id).toBeNull();
    });
  });

  describe('Adversarial: Recovery Attacks', () => {
    it('should not enter infinite recovery loop from corrupted checkpoint', async () => {
      // All checkpoints are corrupted in a way that causes recovery to retry endlessly
      mockCheckpointStore.checkpoints.clear();
      mockCheckpointStore.checkpoints.set('cp-loop', {
        id: 'cp-loop',
        threadId: 'thread-loop',
        turnNumber: 1,
        timestamp: 1000,
        state: { _corruptFlag: true }, // triggers re-recovery
        valid: true, // appears valid but causes recovery to restart
      });

      // Recovery should have a max-attempts guard
      // FAILS: no retry limit on recovery process
      const result = await recovery.recoverFromCrash('thread-loop');
      expect(result.success).toBe(false);
    });

    it('should safely handle checkpoint with payload designed to exploit deserialization', async () => {
      mockCheckpointStore.checkpoints.set('cp-exploit', {
        id: 'cp-exploit',
        threadId: 'thread-exploit',
        turnNumber: 2,
        timestamp: 2000,
        state: {
          __proto__: { isAdmin: true },
          constructor: { prototype: { isAdmin: true } },
          toString: 'not a function',
        },
        valid: true,
      });

      // Recovery should sanitize deserialized state (prototype pollution protection)
      // FAILS: no deserialization sanitization
      const result = await recovery.recoverFromCrash('thread-exploit');
      expect(result.restoredState?.__proto__?.isAdmin).toBeUndefined();
    });

    it('should abort recovery that takes longer than next crash interval', async () => {
      mockCheckpointStore.checkpoints.set('cp-slow', {
        id: 'cp-slow',
        threadId: 'thread-slow',
        turnNumber: 5,
        timestamp: 5000,
        state: { data: 'x'.repeat(10000) }, // large state slows recovery
        valid: true,
      });

      // If recovery takes too long, it should timeout rather than block indefinitely
      // FAILS: no recovery timeout
      const start = Date.now();
      const result = await recovery.recoverFromCrash('thread-slow');
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(5000); // must complete within 5s
    });

    it('should reject checkpoint from a forged/untrusted source', async () => {
      mockCheckpointStore.checkpoints.set('cp-forged', {
        id: 'cp-forged',
        threadId: 'thread-1',
        turnNumber: 99,
        timestamp: 99999,
        state: { injected: true, messages: ['forged message'] },
        valid: true,
        signature: 'invalid-signature', // forged
        source: 'untrusted-machine',
      });

      // Recovery should verify checkpoint integrity (signature/source)
      // FAILS: no checkpoint authentication
      const result = await recovery.recoverFromCrash('thread-1');
      expect(result.checkpointId).not.toBe('cp-forged');
    });

    it('should reject recovery with state so large it exceeds memory', async () => {
      // Simulate a checkpoint with massive state reference
      const hugeState = { data: 'x'.repeat(100 * 1024 * 1024) }; // 100MB
      mockCheckpointStore.checkpoints.set('cp-huge', {
        id: 'cp-huge',
        threadId: 'thread-huge',
        turnNumber: 1,
        timestamp: 1000,
        state: hugeState,
        valid: true,
      });

      // Recovery should check state size before loading
      // FAILS: no size validation on checkpoint state
      const result = await recovery.recoverFromCrash('thread-huge');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/size|memory|too large/i);
    });

    it('should handle concurrent recovery attempts on same session', async () => {
      // Two processes attempt recovery simultaneously on same thread
      const recovery1 = recovery.recoverFromCrash('thread-1');
      const recovery2 = recovery.recoverFromCrash('thread-1');

      const results = await Promise.allSettled([recovery1, recovery2]);

      // Only one recovery should succeed; the other should detect the lock
      // FAILS: no distributed lock on recovery
      const successes = results
        .filter(r => r.status === 'fulfilled')
        .map(r => (r as PromiseFulfilledResult<RecoveryResult>).value)
        .filter(r => r.success);

      expect(successes.length).toBe(1);
    });

    it('should handle recovery that partially succeeds then fails (half-restored state)', async () => {
      // Simulate partial restoration: some fields restored, then error mid-way
      mockCheckpointStore.checkpoints.set('cp-partial-fail', {
        id: 'cp-partial-fail',
        threadId: 'thread-partial-fail',
        turnNumber: 3,
        timestamp: 3000,
        state: { messages: ['a', 'b'], counter: 3, metadata: { nested: true } },
        valid: true,
        _simulatePartialFailure: true, // test flag
      });

      const result = await recovery.recoverFromCrash('thread-partial-fail');

      // On partial failure, should roll back to clean state (not leave half-restored)
      // FAILS: no transactional recovery with rollback
      expect(result.success).toBe(false);
      expect(result.restoredState).toBeUndefined();
    });

    it('should handle crash during recovery (double fault)', async () => {
      // The recovery process itself crashes midway
      mockCheckpointStore.get.mockImplementation((id: string) => {
        if (id === 'cp-2') {
          throw new Error('Storage I/O error during recovery');
        }
        return mockCheckpointStore.checkpoints.get(id) || null;
      });

      // Should gracefully handle the double-fault without corrupting state
      // FAILS: no double-fault handling
      const result = await recovery.recoverFromCrash('thread-1');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/recovery.*failed|storage.*error/i);
    });
  });
});
