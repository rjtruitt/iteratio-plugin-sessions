/**
 * Checkpoint serialization with checksum verification and version migration.
 * Ensures checkpoint integrity across storage backends.
 */

/** Contract for serializing, verifying, and migrating checkpoint data. */
export interface CheckpointSerializer {
  serialize(state: LoopState): string;
  deserialize(data: string): LoopState;
  verify(data: string): boolean;
  getVersion(): number;
  migrate(data: string, fromVersion: number, toVersion: number): string;
}

/** Complete snapshot of an agent loop's state at a point in time. */
export interface LoopState {
  turnNumber: number;
  messages: Array<{ role: string; content: string }>;
  state: Record<string, unknown>;
  metadata: {
    agentId: string;
    startedAt: number;
    model: string;
    [key: string]: unknown;
  };
}

/**
 * Factory that creates a checkpoint serializer using JSON envelope format
 * with a 32-bit hash checksum for tamper detection.
 */
export function createCheckpointSerializer(): CheckpointSerializer {
  const CURRENT_VERSION = 2;

  function computeChecksum(payload: string): string {
    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
      const char = payload.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  return {
    /** Serialize a LoopState into a JSON envelope with checksum. */
    serialize(state: LoopState): string {
      const payload = JSON.stringify({
        version: CURRENT_VERSION,
        turnNumber: state.turnNumber,
        messages: state.messages,
        state: state.state,
        metadata: state.metadata,
      });
      const checksum = computeChecksum(payload);
      return JSON.stringify({ payload, checksum });
    },

    /** Deserialize a JSON envelope back into a LoopState. */
    deserialize(data: string): LoopState {
      const envelope = JSON.parse(data);
      const inner = JSON.parse(envelope.payload);
      return {
        turnNumber: inner.turnNumber,
        messages: inner.messages,
        state: inner.state,
        metadata: inner.metadata,
      };
    },

    /** Verify the checksum of a serialized checkpoint. */
    verify(data: string): boolean {
      try {
        const envelope = JSON.parse(data);
        if (!envelope.payload || !envelope.checksum) return false;
        const expectedChecksum = computeChecksum(envelope.payload);
        return expectedChecksum === envelope.checksum;
      } catch {
        return false;
      }
    },

    /** Return the current serializer version. */
    getVersion(): number {
      return CURRENT_VERSION;
    },

    /** Migrate checkpoint data between format versions. */
    migrate(data: string, fromVersion: number, toVersion: number): string {
      if (fromVersion >= toVersion) {
        throw new Error(`Cannot migrate from version ${fromVersion} to ${toVersion}`);
      }
      if (fromVersion !== 1 || toVersion !== CURRENT_VERSION) {
        throw new Error(`Unsupported version migration: cannot migrate from v${fromVersion} to v${toVersion}`);
      }

      const v1 = JSON.parse(data);
      const migratedState: LoopState = {
        turnNumber: v1.turn ?? v1.turnNumber ?? 0,
        messages: v1.msgs ?? v1.messages ?? [],
        state: v1.state ?? {},
        metadata: {
          agentId: v1.meta?.agentId ?? v1.metadata?.agentId ?? 'unknown',
          startedAt: v1.meta?.startedAt ?? v1.metadata?.startedAt ?? 0,
          model: v1.meta?.model ?? v1.metadata?.model ?? 'unknown',
          ...(v1.meta ?? v1.metadata ?? {}),
        },
      };

      const serializer = createCheckpointSerializer();
      return serializer.serialize(migratedState);
    },
  };
}
