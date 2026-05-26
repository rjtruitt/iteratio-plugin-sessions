# iteratio-plugin-sessions

Session persistence plugin for iteratio.

## Install

```
npm install iteratio-plugin-sessions
```

## What It Does

Saves and restores agent conversations. Records the full transcript (JSONL), tracks file changes via shadow git, and maintains a session index. Supports replay, rollback, conflict detection between concurrent sessions, and merging completed work.

## Usage

```typescript
import { AgentLoop } from 'iteratio';
import { SessionPlugin } from 'iteratio-plugin-sessions';

const sessions = SessionPlugin.builder()
  .directory('./sessions')
  .shadowGitDir('.sessions-git')
  .autoCommit('after-turn')
  .autoIndex()
  .build();

const loop = AgentLoop.builder()
  .withLLM(llm)
  .withPlugin(sessions)
  .build();

const session = await sessions.startSession({ projectPath: process.cwd() });
await loop.runTurn('Refactor the code');
await sessions.closeSession(session.id);

// Later
await sessions.replay(session.id);
```

## License

MIT
