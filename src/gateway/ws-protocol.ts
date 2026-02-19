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
}

export interface ClientMessage_QueryMentionables {
  type: 'query_mentionables';
  id: string;
  filter?: string;
}

export type ClientMessage =
  | ClientMessage_Message
  | ClientMessage_ApprovalResponse
  | ClientMessage_QueryMentionables;

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
  | ServerMessage_Error;

export interface Mentionable {
  type: 'agent' | 'team' | 'skill' | 'tool';
  name: string;
  description?: string;
  trigger?: string;
}
