import { useReducer } from "react"
import type { Message, AppMode, ConnectionStatus, ApprovalRequest, ChatSummary, Mentionable } from "../types"
import { loadThemeName, nextThemeName } from "../lib/theme"

export interface ChatState {
  messages: Message[]
  inputValue: string
  mode: AppMode
  connectionStatus: ConnectionStatus
  streamingContent: string
  pendingApproval: ApprovalRequest | null
  token: string | null
  apiKeyInput: string
  apiKeyError: string | null
  sessions: ChatSummary[]
  sessionIndex: number
  currentChatId: string | null
  sessionsSidebarOpen: boolean
  agents: Mentionable[]
  currentAgentId: string | null
  agentIndex: number
  themeName: string
}

export type ChatAction =
  | { type: "SET_INPUT"; value: string }
  | { type: "SET_MODE"; mode: AppMode }
  | { type: "SEND_MESSAGE" }
  | { type: "SET_CONNECTION_STATUS"; status: ConnectionStatus }
  | { type: "SET_TOKEN"; token: string }
  | { type: "SET_API_KEY_INPUT"; value: string }
  | { type: "SET_API_KEY_ERROR"; error: string }
  | { type: "STREAM_TOKEN"; text: string }
  | { type: "AGENT_RESPONSE"; content: string }
  | { type: "TOOL_PENDING"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "TOOL_STARTED"; toolCallId: string; toolName: string }
  | { type: "TOOL_COMPLETED"; toolCallId: string; toolName: string; durationMs: number; isError: boolean }
  | { type: "APPROVAL_NEEDED"; requestId: string; toolName: string; args: Record<string, unknown> }
  | { type: "APPROVAL_RESOLVED" }
  | { type: "APPROVAL_REJECTED" }
  | { type: "SCHEDULE_TRIGGERED"; schedule: string; agentId: string; message: string }
  | { type: "COMMAND_RESULT"; command: string; message: string }
  | { type: "WS_ERROR"; message: string }
  | { type: "SESSIONS_LOADED"; chats: ChatSummary[] }
  | { type: "SESSION_SELECT_MOVE"; delta: number }
  | { type: "SESSION_SELECTED"; chatId: string; agentId: string | null; messages: Message[] }
  | { type: "ADOPT_CHAT_ID"; chatId: string }
  | { type: "NEW_CHAT" }
  | { type: "TOGGLE_SESSIONS" }
  | { type: "CLOSE_SESSIONS" }
  | { type: "AGENTS_LOADED"; agents: Mentionable[] }
  | { type: "SET_AGENT"; agentId: string }
  | { type: "AGENT_SELECT_MOVE"; delta: number }
  | { type: "CYCLE_THEME" }

function summarizeArgs(toolName: string, args: Record<string, unknown>): string {
  // Pick the most useful arg to show inline
  const key =
    args.file_path ?? args.path ?? args.filePath ??
    args.command ?? args.cmd ??
    args.query ?? args.pattern ??
    args.url ?? args.name ?? args.message
  if (key != null) {
    const s = String(key)
    return s.length > 60 ? s.slice(0, 57) + "..." : s
  }
  const keys = Object.keys(args)
  if (keys.length === 0) return ""
  return keys.join(", ")
}

function updateToolMessage(messages: Message[], toolCallId: string, content: string): Message[] {
  const id = `tool-${toolCallId}`
  const idx = messages.findIndex(m => m.id === id)
  if (idx === -1) return messages
  const updated = [...messages]
  updated[idx] = { ...updated[idx], content }
  return updated
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_INPUT":
      return { ...state, inputValue: action.value }

    case "SET_MODE":
      return { ...state, mode: action.mode }

    case "SEND_MESSAGE": {
      const text = state.inputValue.trim()
      if (!text) return state

      const userMsg: Message = {
        id: String(Date.now()),
        role: "user",
        content: text,
        timestamp: Date.now(),
      }

      return {
        ...state,
        messages: [...state.messages, userMsg],
        inputValue: "",
        mode: "chat",
      }
    }

    case "SET_CONNECTION_STATUS":
      return { ...state, connectionStatus: action.status }

    case "SET_TOKEN":
      return { ...state, token: action.token, mode: "chat", apiKeyInput: "", apiKeyError: null }

    case "SET_API_KEY_INPUT":
      return { ...state, apiKeyInput: action.value }

    case "SET_API_KEY_ERROR":
      return { ...state, apiKeyError: action.error }

    case "STREAM_TOKEN":
      return { ...state, streamingContent: state.streamingContent + action.text }

    case "AGENT_RESPONSE": {
      const assistantMsg: Message = {
        id: String(Date.now()),
        role: "assistant",
        content: action.content || state.streamingContent,
        timestamp: Date.now(),
      }
      return {
        ...state,
        messages: [...state.messages, assistantMsg],
        streamingContent: "",
      }
    }

    case "TOOL_PENDING": {
      const argSummary = summarizeArgs(action.toolName, action.args)
      const detail = argSummary ? ` ${argSummary}` : ""
      const msg: Message = {
        id: `tool-${action.toolCallId}`,
        role: "tool",
        content: `\u23f3 ${action.toolName}${detail}`,
        timestamp: Date.now(),
      }
      return { ...state, messages: [...state.messages, msg] }
    }

    case "TOOL_STARTED": {
      return { ...state, messages: updateToolMessage(state.messages, action.toolCallId, state.messages.find(m => m.id === `tool-${action.toolCallId}`)?.content.replace(/^\u23f3/, "\u25b6") ?? `\u25b6 ${action.toolName}`) }
    }

    case "TOOL_COMPLETED": {
      const existing = state.messages.find(m => m.id === `tool-${action.toolCallId}`)
      // Strip the status icon, keep tool name + args
      const base = existing?.content.replace(/^[\u23f3\u25b6] ?/, "") ?? action.toolName
      const suffix = action.isError ? " \u2718" : ` ${action.durationMs}ms`
      return { ...state, messages: updateToolMessage(state.messages, action.toolCallId, `\u2714 ${base} (${suffix.trim()})`) }
    }

    case "APPROVAL_NEEDED":
      return {
        ...state,
        pendingApproval: { requestId: action.requestId, toolName: action.toolName, args: action.args },
        mode: "approval",
      }

    case "APPROVAL_RESOLVED":
      return {
        ...state,
        pendingApproval: null,
        mode: "chat",
      }

    case "APPROVAL_REJECTED": {
      const rejectMsg: Message = {
        id: `reject-${Date.now()}`,
        role: "system",
        content: "What should we do instead?",
        timestamp: Date.now(),
      }
      return {
        ...state,
        pendingApproval: null,
        mode: "chat",
        messages: [...state.messages, rejectMsg],
      }
    }

    case "SCHEDULE_TRIGGERED": {
      const msg: Message = {
        id: `schedule-${Date.now()}`,
        role: "system",
        content: `Scheduled task (${action.schedule}) -> ${action.agentId}: ${action.message}`,
        timestamp: Date.now(),
      }
      return { ...state, messages: [...state.messages, msg] }
    }

    case "COMMAND_RESULT": {
      const msg: Message = {
        id: `cmd-${Date.now()}`,
        role: "system",
        content: `/${action.command}: ${action.message}`,
        timestamp: Date.now(),
      }
      return { ...state, messages: [...state.messages, msg] }
    }

    case "WS_ERROR": {
      const errMsg: Message = {
        id: `error-${Date.now()}`,
        role: "system",
        content: `Error: ${action.message}`,
        timestamp: Date.now(),
      }
      return { ...state, messages: [...state.messages, errMsg] }
    }

    case "SESSIONS_LOADED": {
      // Deduplicate by chatId (keep the most recently modified entry)
      const seen = new Map<string, ChatSummary>()
      for (const chat of action.chats) {
        const existing = seen.get(chat.chatId)
        if (!existing || chat.lastModified > existing.lastModified) {
          seen.set(chat.chatId, chat)
        }
      }
      const deduped = [...seen.values()]
      return { ...state, sessions: deduped, sessionIndex: 0, mode: "sessions", sessionsSidebarOpen: true }
    }

    case "SESSION_SELECT_MOVE": {
      const filtered = state.currentAgentId
        ? state.sessions.filter(s => s.agentId === state.currentAgentId)
        : state.sessions
      const len = filtered.length
      if (len === 0) return state
      const next = Math.max(0, Math.min(len - 1, state.sessionIndex + action.delta))
      return { ...state, sessionIndex: next }
    }

    case "SESSION_SELECTED": {
      const agentId = action.agentId ?? state.currentAgentId
      const agentIdx = state.agents.findIndex(a => a.name === agentId)
      return {
        ...state,
        messages: action.messages,
        currentChatId: action.chatId,
        currentAgentId: agentId,
        agentIndex: agentIdx >= 0 ? agentIdx : state.agentIndex,
        mode: "chat",
        streamingContent: "",
        sessionsSidebarOpen: false,
        pendingApproval: null,
      }
    }

    case "ADOPT_CHAT_ID":
      return { ...state, currentChatId: action.chatId }

    case "NEW_CHAT":
      return {
        ...state,
        messages: [{ id: "1", role: "system", content: "New conversation started.", timestamp: Date.now() }],
        currentChatId: null,
        mode: "chat",
        streamingContent: "",
        sessionsSidebarOpen: false,
        pendingApproval: null,
      }

    case "TOGGLE_SESSIONS":
      if (state.sessionsSidebarOpen) {
        return { ...state, sessionsSidebarOpen: false, mode: "chat" }
      }
      return { ...state, sessionsSidebarOpen: true, mode: "sessions" }

    case "CLOSE_SESSIONS":
      return { ...state, sessionsSidebarOpen: false, mode: "chat" }

    case "AGENTS_LOADED": {
      const currentId = state.currentAgentId ?? (action.agents.length > 0 ? action.agents[0].name : null)
      const idx = action.agents.findIndex(a => a.name === currentId)
      return { ...state, agents: action.agents, currentAgentId: currentId, agentIndex: idx >= 0 ? idx : 0 }
    }

    case "SET_AGENT": {
      const idx = state.agents.findIndex(a => a.name === action.agentId)
      return {
        ...state,
        currentAgentId: action.agentId,
        agentIndex: idx >= 0 ? idx : 0,
        messages: [{ id: "1", role: "system", content: `Switched to agent: ${action.agentId}`, timestamp: Date.now() }],
        currentChatId: null,
        streamingContent: "",
        pendingApproval: null,
      }
    }

    case "AGENT_SELECT_MOVE": {
      const len = state.agents.length
      if (len === 0) return state
      const next = Math.max(0, Math.min(len - 1, state.agentIndex + action.delta))
      const agentId = state.agents[next].name
      return { ...state, agentIndex: next, currentAgentId: agentId, sessionIndex: 0 }
    }

    case "CYCLE_THEME":
      return { ...state, themeName: nextThemeName(state.themeName) }

    default:
      return state
  }
}

const INITIAL_STATE: ChatState = {
  messages: [
    { id: "1", role: "system", content: "Welcome to Bearclaw. Connecting...", timestamp: Date.now() },
  ],
  inputValue: "",
  mode: "setup",
  connectionStatus: "disconnected",
  streamingContent: "",
  pendingApproval: null,
  token: null,
  apiKeyInput: "",
  apiKeyError: null,
  sessions: [],
  sessionIndex: 0,
  currentChatId: null,
  sessionsSidebarOpen: false,
  agents: [],
  currentAgentId: null,
  agentIndex: 0,
  themeName: loadThemeName(),
}

export function useChatState() {
  const [state, dispatch] = useReducer(chatReducer, INITIAL_STATE)
  return { state, dispatch }
}
