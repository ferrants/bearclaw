# Multi-Agent Orchestration

BearClaw supports multiple agents working together through team-based routing, mention-based handoffs, and conversation tracking with fan-out/fan-in aggregation.

## Message Routing

When a message arrives in the daemon, it goes through the router (`src/orchestrator/router.ts`):

### Direct Agent Routing

Prefix a message with `@agent_name` to route it to a specific agent:

```
@coder Fix the bug in auth.ts
```

### Team Routing

Prefix with `@team_name` to route to a team. The message goes to the team's leader agent first:

```
@engineering Review the PR for the new feature
```

### Default Routing

Messages without a prefix go to the `default` agent.

## Teams

Teams are configured in `bearclaw.jsonc`:

```json
{
  "teams": {
    "engineering": {
      "name": "engineering",
      "agents": ["architect", "coder", "reviewer"],
      "leaderAgent": "architect"
    }
  }
}
```

The **leader agent** receives the initial message and coordinates the team. It can delegate to team members using mention syntax.

## Mention Syntax

Agents delegate work to other agents using mention tags in their responses:

```
[@coder: Implement the auth middleware based on the design above]
```

### Multiple Agents

Comma-separated agents share the same message:

```
[@coder,reviewer: Here's the implementation plan. Coder, implement it. Reviewer, prepare review criteria.]
```

### Shared Context

Text outside mention tags becomes shared context, prepended to each directed message:

```
We're refactoring the auth system to use JWT tokens.

[@coder: Implement the token generation and validation]
[@reviewer: Review the existing auth code for migration risks]
```

Both agents receive the shared context paragraph along with their directed message.

### Validation

Mentions are validated against the list of known agents. If the current context is a team conversation, mentions are additionally validated against team membership.

## Conversation Tracking

The `ConversationTracker` (`src/orchestrator/conversation.ts`) manages multi-agent conversations using the pending counter pattern:

### Fan-Out / Fan-In

```
User message arrives
     │
     ▼
Leader agent processes
     │
     ▼
Leader mentions 3 agents
     │
     ├──► Agent A processes ──► branchComplete()
     ├──► Agent B processes ──► branchComplete()
     └──► Agent C processes ──► branchComplete()
                                      │
                                      ▼ (pending === 0)
                                 Aggregate responses
                                      │
                                      ▼
                                 Send to user
```

1. **`create(convId, ...)`** — Creates a new conversation with a completion callback
2. **`fanOut(convId, count)`** — Increments the pending counter by `count`
3. **`branchComplete(convId, agentId, content)`** — Records an agent's response and decrements the pending counter
4. When `pending === 0`, all responses are aggregated and the completion callback fires

### Timeout Reaper

A reaper runs every 60 seconds and sweeps conversations that have been open longer than `MAX_CONVERSATION_DURATION_MS` (10 minutes). Timed-out conversations are completed with partial aggregation — responses received so far are included, with a note about agents that didn't respond.

## Example: Team Workflow

### Configuration

```json
{
  "agents": {
    "architect": {
      "name": "architect",
      "provider": "anthropic",
      "model": "claude-sonnet-4-5-20250929",
      "systemPromptFiles": ["prompts/architect.md"]
    },
    "coder": {
      "name": "coder",
      "provider": "openai",
      "model": "gpt-4o",
      "systemPromptFiles": ["prompts/coder.md"]
    },
    "reviewer": {
      "name": "reviewer",
      "provider": "anthropic",
      "systemPromptFiles": ["prompts/reviewer.md"]
    }
  },
  "teams": {
    "dev": {
      "name": "dev",
      "agents": ["architect", "coder", "reviewer"],
      "leaderAgent": "architect"
    }
  }
}
```

### Flow

1. User sends: `@dev Add input validation to the API`
2. Router identifies team `dev`, routes to leader `architect`
3. Architect analyzes the request and responds with mentions:
   ```
   [@coder: Add Zod validation schemas to all API endpoints in src/routes/]
   [@reviewer: Review current input handling for security vulnerabilities]
   ```
4. Conversation tracker fans out to 2 agents
5. Both agents process their tasks in parallel
6. As each agent completes, `branchComplete()` is called
7. When both are done (pending === 0), responses are aggregated and sent to the user

## Agent Isolation

Each agent in a multi-agent conversation:
- Has its own session history
- Uses its own provider and model
- Runs through the full security pipeline (policy engine, rate limiting, etc.)
- Cannot directly spawn other agents (spawn tool is restricted in subagent contexts)

Communication between agents happens only through the mention/message system, maintaining clear boundaries.
