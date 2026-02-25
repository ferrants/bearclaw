import { createLogger } from '../logging.js';

const log = createLogger('approval-bridge');

export type ApprovalMode = 'auto-approve' | 'auto-deny' | 'wait';

export interface ApprovalRequest {
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
  agentId: string;
  chatId: string;
  createdAt: number;
}

export interface ApprovalDecision {
  approved: boolean;
  rejected?: boolean;
  feedback?: string;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

let nextId = 0;

export class ApprovalBridge {
  private pending = new Map<string, PendingApproval>();
  private defaultTimeoutMs: number;
  private waitTimeoutMs: number;

  constructor(
    defaultTimeoutMs = 120_000,
    waitTimeoutMs = 600_000,
  ) {
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.waitTimeoutMs = waitTimeoutMs;
  }

  requestApproval(params: {
    toolName: string;
    args: Record<string, unknown>;
    agentId: string;
    chatId: string;
    hasClients: boolean;
  }): { requestId: string; decision: Promise<ApprovalDecision> } {
    const requestId = `apr_${Date.now()}_${++nextId}`;
    const timeoutMs = params.hasClients ? this.defaultTimeoutMs : this.waitTimeoutMs;

    const request: ApprovalRequest = {
      requestId,
      toolName: params.toolName,
      args: params.args,
      agentId: params.agentId,
      chatId: params.chatId,
      createdAt: Date.now(),
    };

    const decision = new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        log.warn('Approval timed out', { requestId, toolName: params.toolName });
        this.pending.delete(requestId);
        resolve({ approved: false });
      }, timeoutMs);

      this.pending.set(requestId, { request, resolve, timer });
    });

    log.info('Approval requested', { requestId, toolName: params.toolName, agentId: params.agentId });
    return { requestId, decision };
  }

  resolveApproval(requestId: string, decision: ApprovalDecision): ApprovalRequest | null {
    const entry = this.pending.get(requestId);
    if (!entry) {
      log.warn('Approval not found', { requestId });
      return null;
    }

    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve(decision);
    log.info('Approval resolved', { requestId, approved: decision.approved, rejected: decision.rejected });
    return entry.request;
  }

  listPending(): ApprovalRequest[] {
    return [...this.pending.values()].map(e => e.request);
  }

  clear(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ approved: false });
      this.pending.delete(id);
    }
  }
}
