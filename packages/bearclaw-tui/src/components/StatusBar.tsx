import type { AppMode, ConnectionStatus } from "../types"
import { useTheme, c, type Theme } from "../lib/theme"

interface StatusBarProps {
  mode: AppMode
  messageCount: number
  connectionStatus: ConnectionStatus
  agentName?: string | null
  agentStatus?: "idle" | "thinking" | "tool_use"
}

function connectionColor(status: ConnectionStatus, theme: Theme): string | undefined {
  switch (status) {
    case "connected": return c(theme.success)
    case "connecting":
    case "reconnecting": return c(theme.warning)
    case "disconnected": return c(theme.error)
  }
}

function modeHints(mode: AppMode): string {
  switch (mode) {
    case "chat": return "Tab: scroll | Enter: send | /exit: quit"
    case "scrolling": return "Tab: chat | Esc: back"
    case "approval": return "Y/S/D/A: approve | N/!: deny | Esc: reject"
    case "sessions": return "Enter: select | N: new | Esc: back"
    case "setup": return "Enter API key to connect"
    case "dashboard": return "Esc: back to chat"
  }
}

export function StatusBar({ mode, messageCount, connectionStatus, agentName, agentStatus }: StatusBarProps) {
  const theme = useTheme()
  const statusLabel = agentStatusLabel(agentStatus)
  const statusColor = agentStatusColor(agentStatus, theme)
  return (
    <box height={1} width="100%" backgroundColor={c(theme.bgBar)} paddingX={1}>
      <text>
        <span fg={c(theme.info)}><strong>[{mode.toUpperCase()}]</strong></span>
        {" "}
        {agentName && <><span fg={c(theme.accentSecondary)}>@{agentName}</span>{" "}</>}
        {statusLabel && <><span fg={statusColor}>{statusLabel}</span>{" "}</>}
        <span fg={connectionColor(connectionStatus, theme)}>{connectionStatus.toUpperCase()}</span>
        {" "}Messages: {messageCount} | {modeHints(mode)}
      </text>
    </box>
  )
}

function agentStatusLabel(status?: "idle" | "thinking" | "tool_use"): string {
  if (!status) return ""
  if (status === "tool_use") return "WORKING"
  return status.toUpperCase()
}

function agentStatusColor(status: "idle" | "thinking" | "tool_use" | undefined, theme: Theme): string | undefined {
  if (!status) return undefined
  switch (status) {
    case "idle": return c(theme.textMuted)
    case "thinking": return c(theme.warning)
    case "tool_use": return c(theme.accent)
  }
}
