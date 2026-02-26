import type { RefObject } from "react"
import type { ScrollBoxRenderable } from "@opentui/core"
import type { Message } from "../types"
import { useTheme, c, type Theme } from "../lib/theme"

interface MessageHistoryProps {
  messages: Message[]
  focused: boolean
  streamingContent: string
  scrollRef?: RefObject<ScrollBoxRenderable | null>
  onMouseScroll?: () => void
}

function roleColor(role: Message["role"], theme: Theme): string | undefined {
  switch (role) {
    case "user": return c(theme.user)
    case "assistant": return c(theme.assistant)
    case "system": return c(theme.system)
    case "tool": return c(theme.tool)
  }
}

function rolePrefix(role: Message["role"]): string {
  switch (role) {
    case "user": return "> You"
    case "assistant": return "  Assistant"
    case "system": return "  System"
    case "tool": return "  Tool"
  }
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp)
  const h = d.getHours().toString().padStart(2, "0")
  const m = d.getMinutes().toString().padStart(2, "0")
  const s = d.getSeconds().toString().padStart(2, "0")
  return `${h}:${m}:${s}`
}

export function MessageHistory({ messages, focused, streamingContent, scrollRef, onMouseScroll }: MessageHistoryProps) {
  const theme = useTheme()
  return (
    <box flexGrow={1} width="100%">
      <scrollbox
        ref={scrollRef}
        focused={focused}
        width="100%"
        height="100%"
        stickyScroll
        stickyStart="bottom"
        onMouseScroll={onMouseScroll}
      >
        {messages.map((msg, i) => {
          const prev = i > 0 ? messages[i - 1] : null
          const needsGap = prev != null && prev.role !== msg.role
          return (
            <>
              {needsGap && <box key={`gap-${msg.id}`} height={1} />}
              <box key={msg.id} paddingX={1}>
                <text>
                  <span fg={c(theme.textMuted)}>{formatTime(msg.timestamp)}</span>
                  {" "}
                  <span fg={roleColor(msg.role, theme)}>
                    <strong>{rolePrefix(msg.role)}:</strong>
                  </span>
                  {" "}{msg.content}
                </text>
              </box>
            </>
          )
        })}
        {streamingContent && (
          <box paddingX={1}>
            <text>
              <span fg={c(theme.textMuted)}>{formatTime(Date.now())}</span>
              {" "}
              <span fg={c(theme.assistant)}>
                <strong>  Assistant:</strong>
              </span>
              {" "}{streamingContent}<span fg={c(theme.textDim)}>{"\u258C"}</span>
            </text>
          </box>
        )}
        <box height={1} />
      </scrollbox>
    </box>
  )
}
