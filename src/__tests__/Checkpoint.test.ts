import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCheckpointSerializer, CheckpointSerializer, LoopState } from '../Checkpoint';

describe('Checkpoint', () => {
  let serializer: CheckpointSerializer;
  let sampleState: LoopState;

  beforeEach(() => {
    serializer = createCheckpointSerializer();
    sampleState = {
      turnNumber: 7,
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'Do something' },
        { role: 'assistant', content: 'Done.' },
      ],
      state: { taskComplete: true, counter: 42, results: ['a', 'b'] },
      metadata: {
        agentId: 'agent-007',
        startedAt: 1700000000000,
        model: 'claude-sonnet-4-20250514',
        customField: 'test',
      },
    };
  });

  describe('serialize complete loop state', () => {
    it('should serialize turnNumber correctly', () => {
      const data = serializer.serialize(sampleState);
      const restored = serializer.deserialize(data);

      expect(restored.turnNumber).toBe(7);
    });

    it('should serialize messages array', () => {
      const data = serializer.serialize(sampleState);
      const restored = serializer.deserialize(data);

      expect(restored.messages).toHaveLength(4);
      expect(restored.messages[0]).toEqual({ role: 'user', content: 'Hello' });
    });

    it('should serialize nested state objects', () => {
      const data = serializer.serialize(sampleState);
      const restored = serializer.deserialize(data);

      expect(restored.state.taskComplete).toBe(true);
      expect(restored.state.counter).toBe(42);
      expect(restored.state.results).toEqual(['a', 'b']);
    });

    it('should serialize metadata including custom fields', () => {
      const data = serializer.serialize(sampleState);
      const restored = serializer.deserialize(data);

      expect(restored.metadata.agentId).toBe('agent-007');
      expect(restored.metadata.model).toBe('claude-sonnet-4-20250514');
      expect(restored.metadata.customField).toBe('test');
    });

    it('should produce a string output', () => {
      const data = serializer.serialize(sampleState);

      expect(typeof data).toBe('string');
      expect(data.length).toBeGreaterThan(0);
    });
  });

  describe('restore serialized state', () => {
    it('should restore identical state from serialized data', () => {
      const data = serializer.serialize(sampleState);
      const restored = serializer.deserialize(data);

      expect(restored).toEqual(sampleState);
    });

    it('should handle empty messages array', () => {
      const emptyMsgState = { ...sampleState, messages: [] };
      const data = serializer.serialize(emptyMsgState);
      const restored = serializer.deserialize(data);

      expect(restored.messages).toEqual([]);
    });

    it('should handle empty state object', () => {
      const emptyState = { ...sampleState, state: {} };
      const data = serializer.serialize(emptyState);
      const restored = serializer.deserialize(data);

      expect(restored.state).toEqual({});
    });
  });

  describe('cross-machine restore', () => {
    it('should restore a checkpoint created on a different machine', () => {
      // Serialize on "machine A" (the data is just a string)
      const data = serializer.serialize(sampleState);

      // Create a fresh serializer (simulating "machine B")
      const serializerB = createCheckpointSerializer();
      const restored = serializerB.deserialize(data);

      expect(restored).toEqual(sampleState);
    });

    it('should be platform-independent (no machine-specific artifacts)', () => {
      const data = serializer.serialize(sampleState);

      // Should not contain file paths or platform-specific info
      expect(data).not.toMatch(/\/Users\/|C:\\|\/home\//);
    });
  });

  describe('checkpoint integrity', () => {
    it('should detect corrupted data', () => {
      const data = serializer.serialize(sampleState);
      const corrupted = data.slice(0, Math.floor(data.length / 2)); // truncate

      expect(serializer.verify(corrupted)).toBe(false);
    });

    it('should verify valid data', () => {
      const data = serializer.serialize(sampleState);

      expect(serializer.verify(data)).toBe(true);
    });

    it('should detect tampered data', () => {
      const data = serializer.serialize(sampleState);
      const tampered = data.replace('agent-007', 'agent-HACKED');

      expect(serializer.verify(tampered)).toBe(false);
    });
  });

  describe('checkpoint versioning', () => {
    it('should include version in serialized output', () => {
      const version = serializer.getVersion();
      expect(typeof version).toBe('number');
      expect(version).toBeGreaterThan(0);
    });

    it('should migrate from older version to current', () => {
      // Simulate a v1 checkpoint format
      const v1Data = JSON.stringify({
        version: 1,
        turn: 5, // v1 used "turn" instead of "turnNumber"
        msgs: [{ role: 'user', content: 'hi' }],
        state: {},
        meta: { agentId: 'old-agent' },
      });

      const migrated = serializer.migrate(v1Data, 1, serializer.getVersion());
      const restored = serializer.deserialize(migrated);

      expect(restored.turnNumber).toBe(5);
      expect(restored.messages).toHaveLength(1);
      expect(restored.metadata.agentId).toBe('old-agent');
    });

    it('should throw when migrating from unsupported version', () => {
      expect(() =>
        serializer.migrate('{}', 999, serializer.getVersion())
      ).toThrow(/unsupported.*version|cannot migrate/i);
    });
  });
});
