// NOTE: Keep in sync with packages/bearclaw-tui/src/ws-protocol.ts
// Client → Server messages
export interface ClientMessage_Message {
  type: 'message';
  id: string;
  message: string;
  chatId?: string;
  agentId?: string;
}

export interface ClientMessage_ApprovalResponse {
  type: 'approval_response';
  requestId: string;
  approved: boolean;
  allow?: 'once' | 'session' | 'day' | 'always';
  deny?: 'always';
  reject?: boolean;
  feedback?: string;
}

export interface ClientMessage_QueryMentionables {
  type: 'query_mentionables';
  id: string;
  filter?: string;
}

export interface ClientMessage_ListChats {
  type: 'list_chats';
  id: string;
  channel?: string;
  agentId?: string;
}

export interface ClientMessage_GetChatHistory {
  type: 'get_chat_history';
  id: string;
  chatId: string;
  agentId?: string;
  channel?: string;
}

export interface ClientMessage_ListPendingApprovals {
  type: 'list_pending_approvals';
  id: string;
  chatId?: string;
  agentId?: string;
}

export interface ClientMessage_ListUserRules {
  type: 'list_user_rules';
  id: string;
}

export interface ClientMessage_RemoveUserRule {
  type: 'remove_user_rule';
  id: string;
  ruleId: string;
}

export interface ClientMessage_GetStats {
  type: 'get_stats';
  id: string;
}

export type ClientMessage =
  | ClientMessage_Message
  | ClientMessage_ApprovalResponse
  | ClientMessage_QueryMentionables
  | ClientMessage_ListChats
  | ClientMessage_GetChatHistory
  | ClientMessage_ListPendingApprovals
  | ClientMessage_ListUserRules
  | ClientMessage_RemoveUserRule
  | ClientMessage_GetStats;

// Server → Client messages
export interface ServerMessage_Token {
  type: 'token';
  chatId: string;
  agentId: string;
  token: string;
}

export interface ServerMessage_AgentResponse {
  type: 'agent_response';
  chatId: string;
  agentId: string;
  content: string;
  iterations: number;
  toolsUsed: string[];
}

export interface ServerMessage_ToolPending {
  type: 'tool_pending';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  agentId: string;
  chatId: string;
}

export interface ServerMessage_ApprovalNeeded {
  type: 'approval_needed';
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
  agentId: string;
  chatId: string;
}

export interface ServerMessage_ToolStarted {
  type: 'tool_started';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  agentId: string;
  chatId: string;
}

export interface ServerMessage_ToolCompleted {
  type: 'tool_completed';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  isError: boolean;
  durationMs: number;
  agentId: string;
  chatId: string;
}

export interface ServerMessage_Mentionables {
  type: 'mentionables';
  id: string;
  items: Mentionable[];
}

export interface ServerMessage_CommandResult {
  type: 'command_result';
  chatId: string;
  command: string;
  message: string;
  newChatId?: string;
}

export interface ServerMessage_ScheduleTriggered {
  type: 'schedule_triggered';
  chatId: string;
  agentId: string;
  message: string;
  schedule: string;
}

export interface ServerMessage_ChatList {
  type: 'chat_list';
  id: string;
  chats: Array<{
    agentId: string;
    channel: string;
    chatId: string;
    lastModified: number;
    messageCount: number;
  }>;
}

export interface ServerMessage_ChatHistory {
  type: 'chat_history';
  id: string;
  chatId: string;
  agentId: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
}

export interface ServerMessage_PendingApprovals {
  type: 'pending_approvals';
  id: string;
  approvals: Array<{
    requestId: string;
    toolName: string;
    args: Record<string, unknown>;
    agentId: string;
    chatId: string;
    createdAt: number;
  }>;
}

export interface ServerMessage_UserRules {
  type: 'user_rules';
  id: string;
  rules: Array<{
    id: string;
    action: 'allow' | 'deny';
    toolName: string;
    agentId?: string;
    createdAt: string;
    createdBy: 'ws-approval' | 'cli';
  }>;
}

export interface ServerMessage_UserRuleRemoved {
  type: 'user_rule_removed';
  id: string;
  ruleId: string;
  success: boolean;
}

export interface ServerMessage_AgentStatus {
  type: 'agent_status';
  agentId: string;
  chatId: string;
  status: 'idle' | 'thinking' | 'tool_use';
  contextTokens: number;
  maxContextTokens: number;
}

export interface ServerMessage_Usage {
  type: 'usage';
  agentId: string;
  chatId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  model: string;
}

export interface ServerMessage_Stats {
  type: 'stats';
  id: string;
  uptimeSeconds: number;
  agents: Array<{
    agentId: string;
    status: 'idle' | 'thinking' | 'tool_use';
    activeChatId: string;
    contextTokens: number;
    maxContextTokens: number;
  }>;
  totalChatCount: number;
  totalMessages: number;
  pendingApprovals: number;
}

export interface ServerMessage_Error {
  type: 'error';
  id?: string;
  code: string;
  message: string;
}

export type ServerMessage =
  | ServerMessage_Token
  | ServerMessage_AgentResponse
  | ServerMessage_ToolPending
  | ServerMessage_ApprovalNeeded
  | ServerMessage_ToolStarted
  | ServerMessage_ToolCompleted
  | ServerMessage_Mentionables
  | ServerMessage_CommandResult
  | ServerMessage_ScheduleTriggered
  | ServerMessage_ChatList
  | ServerMessage_ChatHistory
  | ServerMessage_PendingApprovals
  | ServerMessage_UserRules
  | ServerMessage_UserRuleRemoved
  | ServerMessage_AgentStatus
  | ServerMessage_Usage
  | ServerMessage_Stats
  | ServerMessage_Error;

export interface Mentionable {
  type: 'agent' | 'team' | 'skill' | 'tool';
  name: string;
  description?: string;
  trigger?: string;
}
