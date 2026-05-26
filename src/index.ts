/** Base plugin contract shared across all iteratio plugins. */
import type { Container } from 'inversify';

/** Context passed to lifecycle hooks. */
export interface TurnContext {
  turnNumber: number;
  messages: Array<{ role: string; content: string }>;
  state: Record<string, unknown>;
}

export interface IPlugin {
  name: string;
  version: string;
  initialize(container: Container): Promise<void>;
  shutdown(): Promise<void>;
}

/** Configuration for the sessions plugin. */
export interface SessionsConfig {
  backend?: 'memory' | 'file' | 'redis';
  maxCheckpoints?: number;
  autoCheckpoint?: boolean;
  interval?: number;
}

/** Metadata about a stored checkpoint (without the full state payload). */
export interface CheckpointInfo {
  id: string;
  threadId: string;
  timestamp: number;
  size: number;
  metadata?: Record<string, unknown>;
}

/**
 * Manages conversation checkpoints for pause/resume and crash recovery.
 * Stub implementation -- see SessionsPlugin.ts for the functional version.
 */
export class SessionsPlugin implements IPlugin {
  readonly name = 'sessions';
  readonly version = '0.1.0';

  /** Initialize the plugin with a dependency injection container. */
  initialize(container: Container): Promise<void> {
    throw new Error('TODO: Implement initialize');
  }

  /** Configure the sessions plugin with new settings at runtime. */
  configure(config: SessionsConfig): void {
    throw new Error('TODO: Implement configure');
  }

  /** Pre-turn lifecycle hook. */
  beforeTurn(ctx: TurnContext): Promise<void> {
    throw new Error('TODO: Implement beforeTurn');
  }

  /** Post-turn lifecycle hook. */
  afterTurn(ctx: TurnContext): Promise<void> {
    throw new Error('TODO: Implement afterTurn');
  }

  /** Shut down the plugin and release any resources. */
  shutdown(): Promise<void> {
    throw new Error('TODO: Implement shutdown');
  }

  /** Save a checkpoint for the given thread. Returns the checkpoint ID. */
  saveCheckpoint(threadId: string, state: Record<string, unknown>): Promise<string> {
    throw new Error('TODO: Implement saveCheckpoint');
  }

  /** Restore state from a previously saved checkpoint. */
  restoreCheckpoint(checkpointId: string): Promise<any> {
    throw new Error('TODO: Implement restoreCheckpoint');
  }

  /** List all checkpoints for a given thread. */
  listCheckpoints(threadId: string): Promise<CheckpointInfo[]> {
    throw new Error('TODO: Implement listCheckpoints');
  }

  /** Delete a checkpoint by ID. */
  deleteCheckpoint(checkpointId: string): Promise<void> {
    throw new Error('TODO: Implement deleteCheckpoint');
  }
}

/** Convenience factory for the sessions plugin stub. */
export function createSessionsPlugin(config?: SessionsConfig): SessionsPlugin {
  throw new Error('TODO: Implement createSessionsPlugin');
}

/**
 * Detects and recovers from crash states by locating valid checkpoints.
 * Stub implementation -- see CrashRecovery.ts for the functional version.
 */
export class CrashRecoveryManager {
  /** Attempt to recover from a crash by finding a valid checkpoint for the thread. */
  recoverFromCrash(threadId: string): Promise<{ recovered: boolean; checkpointId?: string; state?: Record<string, unknown> }> {
    throw new Error('TODO: Implement recoverFromCrash');
  }

  /** Get the most recent valid checkpoint for a thread, or null if none exists. */
  getLastValidCheckpoint(threadId: string): Promise<string | null> {
    throw new Error('TODO: Implement getLastValidCheckpoint');
  }

  /** Repair corrupted state by applying defaults from the schema. */
  repairState(state: Record<string, unknown>, schema: Record<string, unknown>): Record<string, unknown> {
    throw new Error('TODO: Implement repairState');
  }

  /** Decide whether to resume, retry, or abort after an interruption. */
  resumeOrRetry(context: { threadId: string; lastTurn: number; error?: Error }): Promise<{ action: 'resume' | 'retry' | 'abort'; fromCheckpoint?: string }> {
    throw new Error('TODO: Implement resumeOrRetry');
  }
}

/** Convenience factory for the crash recovery manager stub. */
export function createCrashRecoveryManager(store?: Record<string, unknown>): CrashRecoveryManager {
  throw new Error('TODO: Implement createCrashRecoveryManager');
}

/**
 * Serializes checkpoint state with integrity verification.
 * Stub implementation -- see Checkpoint.ts for the functional version.
 */
export class CheckpointSerializer {
  /** Serialize state into a string with checksum. */
  serialize(state: Record<string, unknown>): string {
    throw new Error('TODO: Implement serialize');
  }

  /** Deserialize a string back into state. */
  deserialize(data: string): Record<string, unknown> {
    throw new Error('TODO: Implement deserialize');
  }

  /** Verify the integrity of serialized checkpoint data via checksum. */
  verify(data: string): boolean {
    throw new Error('TODO: Implement verify');
  }

  /** Return the version of the serializer format. */
  getVersion(): number {
    throw new Error('TODO: Implement getVersion');
  }

  /** Migrate checkpoint data from one version to another. */
  migrate(data: string, fromVersion: number, toVersion: number): string {
    throw new Error('TODO: Implement migrate');
  }
}

/** Convenience factory for the checkpoint serializer stub. */
export function createCheckpointSerializer(): CheckpointSerializer {
  throw new Error('TODO: Implement createCheckpointSerializer');
}
