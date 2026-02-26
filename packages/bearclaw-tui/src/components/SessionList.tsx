import type { ChatSummary, Mentionable } from "../types"
import { useTheme, c } from "../lib/theme"
import { log } from "../lib/log"

interface SessionListProps {
  sessions: ChatSummary[]
  selectedIndex: number
  focused: boolean
  agents: Mentionable[]
  currentAgentId: string | null
  agentIndex: number
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s
}

/** Strip common prefix shared by all agent names (e.g. "bearclaw-agent-") */
function shortAgentName(name: string, allNames: string[]): string {
  if (allNames.length < 2) return name
  let prefix = allNames[0]
  for (const n of allNames) {
    while (!n.startsWith(prefix)) {
      prefix = prefix.slice(0, -1)
    }
  }
  const lastSep = Math.max(prefix.lastIndexOf("-"), prefix.lastIndexOf("_"), prefix.lastIndexOf("/"))
  const stripLen = lastSep >= 0 ? lastSep + 1 : prefix.length
  const short = name.slice(stripLen)
  return short || name
}

/** Make a session label from channel + chatId */
function sessionLabel(session: ChatSummary): string {
  const { channel, chatId } = session
  const idSuffix = chatId.length > 12 ? chatId.slice(-8) : chatId
  if (channel === "websocket") return `ws:${idSuffix}`
  if (channel === "scheduler") return `sched:${idSuffix}`
  return truncate(chatId, 18)
}

export function SessionList({ sessions, selectedIndex, focused, agents, currentAgentId, agentIndex }: SessionListProps) {
  const theme = useTheme()
  const filteredSessions = currentAgentId
    ? sessions.filter(s => s.agentId === currentAgentId)
    : sessions
  const showAgentBar = agents.length > 1
  const allAgentNames = agents.map(a => a.name)

  log("[SessionList]", "render: totalSessions:", sessions.length, "filtered:", filteredSessions.length, "currentAgentId:", currentAgentId, "selectedIndex:", selectedIndex, "agentIndex:", agentIndex)
  if (filteredSessions.length > 0) {
    log("[SessionList]", "filtered chatIds:", filteredSessions.map(s => s.chatId).join(", "))
    log("[SessionList]", "filtered agentIds:", filteredSessions.map(s => s.agentId).join(", "))
  }
  if (sessions.length > 0) {
    const agentIds = [...new Set(sessions.map(s => s.agentId))]
    log("[SessionList]", "all agentIds in sessions:", agentIds.join(", "))
    log("[SessionList]", "agent names:", agents.map(a => a.name).join(", "))
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Agent switcher */}
      {showAgentBar && (
        <box height={1} width="100%" backgroundColor={c(theme.bgPanel)} paddingX={1}>
          <text>
            <span fg={c(theme.textMuted)}>{"\u25C0 "}</span>
            <span fg={c(theme.accentSecondary)}><strong>{shortAgentName(agents[agentIndex].name, allAgentNames)}</strong></span>
            <span fg={c(theme.textMuted)}>{" \u25B6"}</span>
            <span fg={c(theme.textMuted)}>{`  ${agentIndex + 1}/${agents.length}`}</span>
          </text>
        </box>
      )}

      {/* Divider */}
      <box height={1} width="100%" paddingX={1} backgroundColor={c(theme.bgPanel)}>
        <text>
          <span fg={c(theme.accent)}><strong>Sessions</strong></span>
          <span fg={c(theme.textMuted)}>{` (${filteredSessions.length})`}</span>
        </text>
      </box>

      {/* Session list */}
      {filteredSessions.length === 0 ? (
        <box flexGrow={1} paddingX={1} paddingY={1}>
          <text><span fg={c(theme.textMuted)}>No sessions yet.</span></text>
        </box>
      ) : (
        <box flexDirection="column" flexGrow={1} overflow="hidden">
          {filteredSessions.map((session, i) => {
            const selected = i === selectedIndex && focused
            const label = sessionLabel(session)
            const time = relativeTime(session.lastModified)
            const msgs = `${session.messageCount}m`
            return (
              <box
                key={session.chatId}
                paddingX={1}
                backgroundColor={selected ? c(theme.bgSelected) : undefined}
              >
                <text>
                  <span fg={selected ? c(theme.accent) : c(theme.text)}>
                    {selected ? "\u25B8 " : "  "}
                    {truncate(label, 16)}
                  </span>
                  {"  "}
                  <span fg={c(theme.textMuted)}>{msgs}</span>
                  {" "}
                  <span fg={c(theme.textMuted)}>{time}</span>
                </text>
              </box>
            )
          })}
        </box>
      )}

      {/* Footer hints */}
      <box height={1} width="100%" backgroundColor={c(theme.bgBar)} paddingX={1}>
        <text>
          <span fg={c(theme.textDim)}>
            {showAgentBar ? "\u25C0\u25B6 agent " : ""}
            {"\u21B5 open  N new  esc back"}
          </span>
        </text>
      </box>
    </box>
  )
}
