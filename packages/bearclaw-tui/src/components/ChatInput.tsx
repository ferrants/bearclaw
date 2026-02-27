import type { TextareaRenderable } from "@opentui/core"
import { useEffect, useRef } from "react"
import type { Ref } from "react"
import { useTheme, c } from "../lib/theme"

interface ChatInputProps {
  inputRef?: Ref<TextareaRenderable>
  value: string
  onChange: (value: string) => void
  onInput?: (value: string) => void
  onSubmit?: () => void
  focused: boolean
  maxWidth: number
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === "function") {
    ref(value)
  } else {
    (ref as { current: T | null }).current = value
  }
}

function estimateLines(text: string, maxWidth: number): number {
  if (!text) return 1
  const safeWidth = Math.max(10, maxWidth)
  return text.split("\n").reduce((sum, line) => {
    const len = line.length || 1
    return sum + Math.max(1, Math.ceil(len / safeWidth))
  }, 0)
}

export function ChatInput({ inputRef, value, onChange, onInput, onSubmit, focused, maxWidth }: ChatInputProps) {
  const theme = useTheme()
  const localRef = useRef<TextareaRenderable | null>(null)
  const internalChange = useRef(false)
  const lines = estimateLines(value, maxWidth - 4)
  const maxLines = 6
  const height = Math.min(maxLines, Math.max(1, lines)) + 2

  useEffect(() => {
    if (internalChange.current) {
      internalChange.current = false
      return
    }
    const node = localRef.current
    if (!node) return
    const current = node.plainText
    if (current !== value) {
      node.editBuffer.setText(value)
    }
  }, [value])

  return (
    <box
      height={height}
      width="100%"
      border
      borderStyle="rounded"
      borderColor={focused ? c(theme.accent) : c(theme.textMuted)}
      paddingX={1}
    >
      <textarea
        ref={(node) => {
          localRef.current = node
          assignRef(inputRef, node)
        }}
        onContentChange={() => {
          const text = localRef.current?.plainText ?? ""
          internalChange.current = true
          onChange(text)
          onInput?.(text)
        }}
        onSubmit={() => {
          onSubmit?.()
        }}
        keyBindings={[
          { name: "enter", action: "submit" },
          { name: "return", action: "submit" },
          { name: "linefeed", action: "submit" },
          // Shift+Enter for newline (works in Kitty without tmux)
          { name: "enter", shift: true, action: "newline" },
          { name: "return", shift: true, action: "newline" },
          { name: "linefeed", shift: true, action: "newline" },
          // Alt+Enter for newline (works through tmux)
          { name: "enter", meta: true, action: "newline" },
          { name: "return", meta: true, action: "newline" },
          { name: "linefeed", meta: true, action: "newline" },
        ]}
        wrapMode="word"
        placeholder="Type a message... (Enter to send, Alt+Enter for newline)"
        focused={focused}
        width="100%"
        height="100%"
      />
    </box>
  )
}
