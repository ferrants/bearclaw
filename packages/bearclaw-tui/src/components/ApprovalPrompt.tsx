import type { ApprovalRequest } from "../types"
import { useTheme, c } from "../lib/theme"

interface ApprovalPromptProps {
  approval: ApprovalRequest
}

export function ApprovalPrompt({ approval }: ApprovalPromptProps) {
  const theme = useTheme()
  const argsSummary = formatArgsSummary(approval.args)
  const argLines = wrapText(argsSummary, 90)
  const visibleArgLines = argLines.slice(0, 2)
  const hasMoreArgs = argLines.length > visibleArgLines.length
  const height = 3 + visibleArgLines.length + (hasMoreArgs ? 1 : 0)

  return (
    <box height={height} width="100%" backgroundColor={c(theme.bgWarningPanel)} paddingX={1} flexDirection="column">
      <text>
        <span fg={c(theme.warning)}><strong>Approve tool:</strong></span>
        {" "}{approval.toolName}
      </text>
      {visibleArgLines.length > 0 && (
        <text>
          <span fg={c(theme.textMuted)}><strong>Args:</strong></span>
          {" "}{visibleArgLines[0]}
        </text>
      )}
      {visibleArgLines.length > 1 && (
        <text>
          <span fg={c(theme.textMuted)}>{"     "}</span>{visibleArgLines[1]}
        </text>
      )}
      {hasMoreArgs && (
        <text>
          <span fg={c(theme.textMuted)}>{"     "}\u2026</span>
        </text>
      )}
      <text>
        <span fg={c(theme.success)}><strong>[Y]</strong> Once</span>
        {"  "}
        <span fg={c(theme.success)}><strong>[S]</strong> Session</span>
        {"  "}
        <span fg={c(theme.success)}><strong>[D]</strong> Today</span>
        {"  "}
        <span fg={c(theme.success)}><strong>[A]</strong> Always</span>
      </text>
      <text>
        <span fg={c(theme.error)}><strong>[N]</strong> Deny</span>
        {"  "}
        <span fg={c(theme.error)}><strong>[!]</strong> Never</span>
        {"  "}
        <span fg={c(theme.error)}><strong>[Esc]</strong> Reject</span>
      </text>
    </box>
  )
}

function formatArgsSummary(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return ""

  const priority = ["command", "path", "url", "chatId", "agentId"]
  const ordered = [
    ...priority.flatMap((k) => entries.filter(([key]) => key === k)),
    ...entries.filter(([key]) => !priority.includes(key)),
  ]

  return ordered
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(", ")
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return truncate(value.replace(/\s+/g, " "), 120)
  try {
    return truncate(JSON.stringify(value), 120)
  } catch {
    return truncate(String(value), 120)
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s
}

function wrapText(text: string, maxLen: number): string[] {
  if (!text) return []
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    if (!current) {
      current = word
      continue
    }
    if ((current + " " + word).length <= maxLen) {
      current += " " + word
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}
