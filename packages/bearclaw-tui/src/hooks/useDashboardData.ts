import { useReducer, useEffect, useRef } from "react"

const MAX_SAMPLES = 60
const MAX_TOOL_EVENTS = 100

export interface ToolEvent {
  toolCallId: string
  toolName: string
  timestamp: number
  durationMs?: number
  isError?: boolean
  status: "started" | "completed"
}

export interface ToolAggregate {
  count: number
  totalDurationMs: number
  errors: number
}

export interface AgentInfo {
  agentId: string
  status: string
  contextTokens: number
  maxContextTokens: number
}

export interface StatsAgent {
  agentId: string
  status: string
  activeChatId?: string
}

export interface ServerStats {
  uptimeSeconds: number
  agents: StatsAgent[]
  totalChatCount: number
  totalMessages: number
  pendingApprovals: number
}

export interface DashboardState {
  // Rolling rate samples (per-second snapshots)
  tokenRateSamples: number[]
  wsInRateSamples: number[]
  wsOutRateSamples: number[]

  // Tool tracking
  recentToolEvents: ToolEvent[]
  toolAggregates: Record<string, ToolAggregate>
  activeTools: Record<string, { toolName: string; startedAt: number }>

  // Token/cost totals (from usage events, if available)
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  model: string | null

  // Cumulative count of streaming token events (always available)
  totalStreamTokens: number

  // Agent info
  agents: Record<string, AgentInfo>

  // Server stats
  serverStats: ServerStats | null

  // Raw counters for rate calculation (reset each tick)
  _tokenCount: number
  _wsInCount: number
  _wsOutCount: number

  // Session start for rate calc
  _startTime: number
}

export type DashboardAction =
  | { type: "TOKEN_RECEIVED" }
  | { type: "WS_IN" }
  | { type: "WS_OUT" }
  | { type: "TOOL_STARTED"; toolCallId: string; toolName: string }
  | { type: "TOOL_COMPLETED"; toolCallId: string; toolName: string; durationMs: number; isError: boolean }
  | { type: "AGENT_STATUS"; agentId: string; status: string; contextTokens?: number; maxContextTokens?: number }
  | { type: "USAGE"; model: string; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
  | { type: "STATS"; uptimeSeconds: number; agents: StatsAgent[]; totalChatCount: number; totalMessages: number; pendingApprovals: number }
  | { type: "TICK" }

function initialState(): DashboardState {
  return {
    tokenRateSamples: [],
    wsInRateSamples: [],
    wsOutRateSamples: [],
    recentToolEvents: [],
    toolAggregates: {},
    activeTools: {},
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    model: null,
    totalStreamTokens: 0,
    agents: {},
    serverStats: null,
    _tokenCount: 0,
    _wsInCount: 0,
    _wsOutCount: 0,
    _startTime: Date.now(),
  }
}

function pushSample(arr: number[], value: number): number[] {
  const next = [...arr, value]
  if (next.length > MAX_SAMPLES) next.shift()
  return next
}

function reducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case "TOKEN_RECEIVED":
      return { ...state, _tokenCount: state._tokenCount + 1, totalStreamTokens: state.totalStreamTokens + 1 }

    case "WS_IN":
      return { ...state, _wsInCount: state._wsInCount + 1 }

    case "WS_OUT":
      return { ...state, _wsOutCount: state._wsOutCount + 1 }

    case "TOOL_STARTED": {
      const event: ToolEvent = {
        toolCallId: action.toolCallId,
        toolName: action.toolName,
        timestamp: Date.now(),
        status: "started",
      }
      const events = [...state.recentToolEvents, event].slice(-MAX_TOOL_EVENTS)
      const activeTools = { ...state.activeTools, [action.toolCallId]: { toolName: action.toolName, startedAt: Date.now() } }
      return { ...state, recentToolEvents: events, activeTools }
    }

    case "TOOL_COMPLETED": {
      const event: ToolEvent = {
        toolCallId: action.toolCallId,
        toolName: action.toolName,
        timestamp: Date.now(),
        durationMs: action.durationMs,
        isError: action.isError,
        status: "completed",
      }
      const events = [...state.recentToolEvents, event].slice(-MAX_TOOL_EVENTS)

      const agg = state.toolAggregates[action.toolName] ?? { count: 0, totalDurationMs: 0, errors: 0 }
      const toolAggregates = {
        ...state.toolAggregates,
        [action.toolName]: {
          count: agg.count + 1,
          totalDurationMs: agg.totalDurationMs + action.durationMs,
          errors: agg.errors + (action.isError ? 1 : 0),
        },
      }

      const { [action.toolCallId]: _, ...activeTools } = state.activeTools
      return { ...state, recentToolEvents: events, toolAggregates, activeTools }
    }

    case "AGENT_STATUS":
      return {
        ...state,
        agents: {
          ...state.agents,
          [action.agentId]: {
            agentId: action.agentId,
            status: action.status,
            contextTokens: action.contextTokens ?? state.agents[action.agentId]?.contextTokens ?? 0,
            maxContextTokens: action.maxContextTokens ?? state.agents[action.agentId]?.maxContextTokens ?? 200000,
          },
        },
      }

    case "USAGE":
      return {
        ...state,
        model: action.model,
        totalInputTokens: state.totalInputTokens + action.inputTokens,
        totalOutputTokens: state.totalOutputTokens + action.outputTokens,
        totalCacheReadTokens: state.totalCacheReadTokens + (action.cacheReadTokens ?? 0),
        totalCacheWriteTokens: state.totalCacheWriteTokens + (action.cacheWriteTokens ?? 0),
      }

    case "STATS": {
      // Update agents from stats response
      const agentsFromStats: Record<string, AgentInfo> = { ...state.agents }
      for (const a of action.agents) {
        agentsFromStats[a.agentId] = {
          agentId: a.agentId,
          status: a.status,
          contextTokens: agentsFromStats[a.agentId]?.contextTokens ?? 0,
          maxContextTokens: agentsFromStats[a.agentId]?.maxContextTokens ?? 200000,
        }
      }
      return {
        ...state,
        agents: agentsFromStats,
        serverStats: {
          uptimeSeconds: action.uptimeSeconds,
          agents: action.agents,
          totalChatCount: action.totalChatCount,
          totalMessages: action.totalMessages,
          pendingApprovals: action.pendingApprovals,
        },
      }
    }

    case "TICK":
      return {
        ...state,
        tokenRateSamples: pushSample(state.tokenRateSamples, state._tokenCount),
        wsInRateSamples: pushSample(state.wsInRateSamples, state._wsInCount),
        wsOutRateSamples: pushSample(state.wsOutRateSamples, state._wsOutCount),
        _tokenCount: 0,
        _wsInCount: 0,
        _wsOutCount: 0,
      }

    default:
      return state
  }
}

// Model pricing per million tokens (approximate)
const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-opus-4-6": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-haiku-4-5": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
}

export function computeCost(state: DashboardState): number {
  const pricing = (state.model ? MODEL_PRICING[state.model] : null) ?? MODEL_PRICING["claude-sonnet-4-6"]
  return (
    (state.totalInputTokens / 1_000_000) * pricing.input +
    (state.totalOutputTokens / 1_000_000) * pricing.output +
    (state.totalCacheReadTokens / 1_000_000) * pricing.cacheRead +
    (state.totalCacheWriteTokens / 1_000_000) * pricing.cacheWrite
  )
}

export function computeRate(state: DashboardState): number {
  const elapsed = (Date.now() - state._startTime) / 60_000 // minutes
  if (elapsed < 0.1) return 0
  return computeCost(state) / elapsed
}

export function useDashboardData() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      dispatch({ type: "TICK" })
    }, 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  return { dashState: state, dashDispatch: dispatch }
}
