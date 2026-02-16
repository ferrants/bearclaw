import type { ScheduleRule } from '../config/schema.js';
import type { MessageBus } from '../bus/bus.js';
import { parseCron, nextCronTime } from './cron.js';
import { parseInterval } from './interval.js';
import type { CronFields } from './cron.js';
import { createLogger } from '../logging.js';

const log = createLogger('scheduler');

interface ParsedRule {
  rule: ScheduleRule;
  index: number;
  type: 'cron' | 'interval';
  cronFields?: CronFields;
  intervalMs?: number;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(resolve, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class Scheduler {
  private parsed: ParsedRule[];
  private bus: MessageBus;
  private signal: AbortSignal;

  constructor(rules: ScheduleRule[], bus: MessageBus, signal: AbortSignal) {
    this.bus = bus;
    this.signal = signal;
    this.parsed = rules.map((rule, index) => {
      // Validate: exactly one of cron/interval
      const hasCron = rule.cron !== undefined && rule.cron !== '';
      const hasInterval = rule.interval !== undefined && rule.interval !== '';

      if (hasCron && hasInterval) {
        throw new Error(`Schedule rule ${index}: cannot have both "cron" and "interval"`);
      }
      if (!hasCron && !hasInterval) {
        throw new Error(`Schedule rule ${index}: must have either "cron" or "interval"`);
      }
      if (!rule.message || rule.message.trim() === '') {
        throw new Error(`Schedule rule ${index}: "message" must not be empty`);
      }

      if (hasCron) {
        return {
          rule,
          index,
          type: 'cron' as const,
          cronFields: parseCron(rule.cron!),
        };
      } else {
        return {
          rule,
          index,
          type: 'interval' as const,
          intervalMs: parseInterval(rule.interval!),
        };
      }
    });
  }

  start(): void {
    for (const parsed of this.parsed) {
      this.runLoop(parsed);
    }
  }

  private async runLoop(parsed: ParsedRule): Promise<void> {
    const { rule, index } = parsed;

    try {
      while (!this.signal.aborted) {
        // Compute delay
        let delayMs: number;
        if (parsed.type === 'cron') {
          const now = new Date();
          const next = nextCronTime(parsed.cronFields!, now);
          delayMs = next.getTime() - now.getTime();
        } else {
          delayMs = parsed.intervalMs!;
        }

        await abortableSleep(delayMs, this.signal);

        // Publish synthetic inbound message
        const message = rule.agent
          ? `@${rule.agent} ${rule.message}`
          : rule.message;

        const timestamp = Date.now();
        this.bus.publishInbound({
          channel: 'scheduler',
          sender: 'scheduler',
          chatId: `schedule_${index}`,
          messageId: `sched_${index}_${timestamp}`,
          message,
          timestamp,
        });

        log.info('Scheduled message fired', { ruleIndex: index, message: rule.message });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return; // Normal shutdown
      }
      log.error('Scheduler loop error', { ruleIndex: index, error: String(err) });
    }
  }
}
