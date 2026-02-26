import type {
  ClientMessage,
  ServerMessage,
  Mentionable as WsMentionable,
} from "@bearclaw/shared/ws-protocol"

export interface Message {
  id: string
  role: "user" | "assistant" | "system" | "tool"
  content: string
  timestamp: number
  streaming?: boolean
}

export type AppMode = "chat" | "scrolling" | "approval" | "setup" | "sessions" | "dashboard"

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"

export interface ChatSummary {
  chatId: string
  agentId: string
  channel: string
  lastModified: number
  messageCount: number
}

export type Mentionable = WsMentionable

export type WsServerMessage = ServerMessage

export type WsClientMessage = ClientMessage

// Approval request stored in state
export interface ApprovalRequest {
  requestId: string
  toolName: string
  args: Record<string, unknown>
}
