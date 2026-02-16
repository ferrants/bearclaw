import type { SecurityPolicy } from '../security/policy.js';
import type { PolicyEngine } from '../security/policy-engine.js';
import type { ApprovalManager } from '../security/approvals.js';
import type { InlineAllowStore } from '../security/inline-allow.js';
import type { AgentConfig } from '../config/schema.js';
import type { LLMProvider } from '../providers/types.js';

export interface ToolResult {
  forLLM: string;
  forUser?: string;
  silent?: boolean;
  isError: boolean;
  async: boolean;
  error?: Error;
}

export function toolResult(forLLM: string): ToolResult {
  return { forLLM, isError: false, async: false };
}

export function silentResult(forLLM: string): ToolResult {
  return { forLLM, silent: true, isError: false, async: false };
}

export function asyncResult(forLLM: string): ToolResult {
  return { forLLM, isError: false, async: true };
}

export function errorResult(message: string): ToolResult {
  return { forLLM: message, isError: true, async: false };
}

export function userResult(content: string): ToolResult {
  return { forLLM: content, forUser: content, isError: false, async: false };
}

// Forward reference types to avoid circular deps
export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): string[];
  execute(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult>;
  toProviderDefs(): Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
}

export interface ToolHookRegistry {
  runBefore(toolName: string, args: Record<string, unknown>, ctx: ToolContext): Promise<{ proceed: boolean; args: Record<string, unknown> }>;
  runAfter(toolName: string, args: Record<string, unknown>, result: ToolResult, ctx: ToolContext): Promise<void>;
  flush(timeoutMs?: number): Promise<void>;
}

export interface ToolContext {
  signal: AbortSignal;
  channel?: string;
  chatId?: string;
  onUpdate?: (partial: string) => void;
  policy: SecurityPolicy;
  policyEngine: PolicyEngine;
  approvalManager: ApprovalManager;
  inlineAllowStore: InlineAllowStore;
  toolRegistry: ToolRegistry;
  hooks: ToolHookRegistry;
  agentConfigs: Record<string, AgentConfig>;
  currentAgentConfig: AgentConfig;
  providerFactory: (providerName: string) => LLMProvider;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}
