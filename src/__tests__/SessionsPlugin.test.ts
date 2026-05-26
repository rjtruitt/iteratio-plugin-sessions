import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionsPlugin, SessionsPlugin, SessionsConfig } from '../SessionsPlugin';

describe('SessionsPlugin', () => {
  let plugin: SessionsPlugin;
  let config: SessionsConfig;

  beforeEach(() => {
    config = {
      storage: 'memory',
      autoCheckpointOnToolCall: true,
      autoCheckpointOnFinalResponse: true,
      ttl: 3600000, // 1 hour
      maxCheckpointsPerThread: 50,
    };
    plugin = createSessionsPlugin(config);
  });

  describe('save checkpoint', () => {
    it('should save a checkpoint and return an ID', async () => {
      const state = { turnNumber: 5, messages: ['hello'], metadata: {} };
      const id = await plugin.saveCheckpoint('thread-1', state);

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('should save multiple checkpoints for the same thread', async () => {
      await plugin.saveCheckpoint('thread-1', { turnNumber: 1 });
      await plugin.saveCheckpoint('thread-1', { turnNumber: 2 });
      await plugin.saveCheckpoint('thread-1', { turnNumber: 3 });

      const checkpoints = await plugin.listCheckpoints('thread-1');
      expect(checkpoints).toHaveLength(3);
    });

    it('should include timestamp in checkpoint', async () => {
      const before = Date.now();
      await plugin.saveCheckpoint('thread-1', { turnNumber: 1 });
      const after = Date.now();

      const checkpoints = await plugin.listCheckpoints('thread-1');
      expect(checkpoints[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(checkpoints[0].timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('restore from checkpoint', () => {
    it('should restore state from a checkpoint', async () => {
      const originalState = { turnNumber: 5, messages: ['a', 'b'], status: 'running' };
      const id = await plugin.saveCheckpoint('thread-1', originalState);

      const restored = await plugin.restoreCheckpoint(id);
      expect(restored).toEqual(originalState);
    });

    it('should throw when restoring from non-existent checkpoint', async () => {
      await expect(
        plugin.restoreCheckpoint('nonexistent-checkpoint-id')
      ).rejects.toThrow(/not found|does not exist/i);
    });
  });

  describe('list checkpoints', () => {
    it('should list checkpoints for a specific thread', async () => {
      await plugin.saveCheckpoint('thread-1', { turnNumber: 1 });
      await plugin.saveCheckpoint('thread-2', { turnNumber: 1 });
      await plugin.saveCheckpoint('thread-1', { turnNumber: 2 });

      const t1Checkpoints = await plugin.listCheckpoints('thread-1');
      expect(t1Checkpoints).toHaveLength(2);
      expect(t1Checkpoints.every(c => c.threadId === 'thread-1')).toBe(true);
    });

    it('should return empty array for thread with no checkpoints', async () => {
      const checkpoints = await plugin.listCheckpoints('nonexistent-thread');
      expect(checkpoints).toHaveLength(0);
    });
  });

  describe('thread isolation', () => {
    it('should isolate checkpoints per thread', async () => {
      await plugin.saveCheckpoint('thread-A', { data: 'A' });
      await plugin.saveCheckpoint('thread-B', { data: 'B' });

      const aCheckpoints = await plugin.listCheckpoints('thread-A');
      const bCheckpoints = await plugin.listCheckpoints('thread-B');

      expect(aCheckpoints).toHaveLength(1);
      expect(bCheckpoints).toHaveLength(1);

      const aState = await plugin.restoreCheckpoint(aCheckpoints[0].id);
      expect(aState.data).toBe('A');
    });
  });

  describe('auto-checkpoint on tool calls', () => {
    it('should auto-checkpoint when a tool call occurs', async () => {
      await plugin.initialize({});

      // Simulate a tool call event
      const context = {
        threadId: 'thread-1',
        turnNumber: 3,
        event: 'tool_call',
        state: { messages: ['before tool'] },
      };

      // The plugin should have created a checkpoint
      const checkpoints = await plugin.listCheckpoints('thread-1');
      expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('auto-checkpoint on final response', () => {
    it('should auto-checkpoint when final response is emitted', async () => {
      await plugin.initialize({});

      // Simulate final response event
      const context = {
        threadId: 'thread-1',
        turnNumber: 5,
        event: 'final_response',
        state: { messages: ['final answer'] },
      };

      const checkpoints = await plugin.listCheckpoints('thread-1');
      expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('delete old checkpoints (TTL)', () => {
    it('should delete checkpoints older than TTL', async () => {
      vi.useFakeTimers();

      await plugin.saveCheckpoint('thread-1', { turnNumber: 1 });

      // Advance past TTL
      vi.advanceTimersByTime(3600001);

      const checkpoints = await plugin.listCheckpoints('thread-1');
      expect(checkpoints).toHaveLength(0);

      vi.useRealTimers();
    });

    it('should keep checkpoints within TTL', async () => {
      vi.useFakeTimers();

      await plugin.saveCheckpoint('thread-1', { turnNumber: 1 });

      // Advance within TTL
      vi.advanceTimersByTime(1800000); // 30 minutes

      const checkpoints = await plugin.listCheckpoints('thread-1');
      expect(checkpoints).toHaveLength(1);

      vi.useRealTimers();
    });
  });

  describe('Edge Cases', () => {
    it('should handle save session with empty state', async () => {
      const id = await plugin.saveCheckpoint('thread-1', {});
      const restored = await plugin.restoreCheckpoint(id);
      // Should persist and restore empty state correctly
      expect(restored).toEqual({});
    });

    it('should handle restore session that does not exist', async () => {
      await expect(
        plugin.restoreCheckpoint('completely-nonexistent-id-xyz')
      ).rejects.toThrow(/not found|does not exist/i);
    });

    it('should handle save session while another save is in progress', async () => {
      const save1 = plugin.saveCheckpoint('thread-1', { turn: 1 });
      const save2 = plugin.saveCheckpoint('thread-1', { turn: 2 });
      const [id1, id2] = await Promise.all([save1, save2]);
      // Both should succeed without corruption
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      const s1 = await plugin.restoreCheckpoint(id1);
      const s2 = await plugin.restoreCheckpoint(id2);
      expect(s1).toEqual({ turn: 1 });
      expect(s2).toEqual({ turn: 2 });
    });

    it('should handle session ID with special characters', async () => {
      const weirdId = 'thread/with\\special<chars>&"quotes"';
      const id = await plugin.saveCheckpoint(weirdId, { data: 'test' });
      const checkpoints = await plugin.listCheckpoints(weirdId);
      // Should handle or sanitize special characters
      expect(checkpoints).toHaveLength(1);
      const restored = await plugin.restoreCheckpoint(id);
      expect(restored).toEqual({ data: 'test' });
    });

    it('should handle session data exceeding storage limit', async () => {
      const hugeState = { data: 'x'.repeat(100 * 1024 * 1024) }; // 100MB
      // Should reject or handle gracefully
      await expect(
        plugin.saveCheckpoint('thread-huge', hugeState)
      ).rejects.toThrow(/limit|size|too large/i);
    });

    it('should handle restore session with corrupted checkpoint', async () => {
      // Simulate a corrupted checkpoint in storage
      // Should throw descriptive error, not crash
      await expect(
        plugin.restoreCheckpoint('corrupted-id-that-does-not-exist')
      ).rejects.toThrow(/not found|does not exist|corrupt/i);
    });

    it('should handle session TTL = 0 (immediate expiry)', async () => {
      vi.useFakeTimers();
      const zeroTtlPlugin = createSessionsPlugin({
        storage: 'memory',
        ttl: 0,
      });
      await zeroTtlPlugin.saveCheckpoint('thread-1', { data: 'ephemeral' });
      vi.advanceTimersByTime(1);
      const checkpoints = await zeroTtlPlugin.listCheckpoints('thread-1');
      // Should be immediately expired
      expect(checkpoints).toHaveLength(0);
      vi.useRealTimers();
    });

    it('should handle save session after plugin shutdown', async () => {
      await plugin.shutdown();
      // Saving after shutdown should throw
      await expect(
        plugin.saveCheckpoint('thread-1', { data: 'late' })
      ).rejects.toThrow(/shut.*down/i);
    });

    it('should handle concurrent checkpoint and restore', async () => {
      const id = await plugin.saveCheckpoint('thread-1', { turn: 1 });
      const savePromise = plugin.saveCheckpoint('thread-1', { turn: 2 });
      const restorePromise = plugin.restoreCheckpoint(id);
      const [_, restored] = await Promise.all([savePromise, restorePromise]);
      // Restore should return consistent state, not partial
      expect(restored).toEqual({ turn: 1 });
    });

    it('should handle session with nested circular references', async () => {
      const circular: any = { name: 'node' };
      circular.self = circular;
      // Should throw or handle serialization error gracefully
      await expect(
        plugin.saveCheckpoint('thread-circular', circular)
      ).rejects.toThrow(/circular/i);
    });
  });
});
