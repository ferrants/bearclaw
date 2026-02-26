import type { InputRenderable } from "@opentui/core"
import type { Ref } from "react"
import { useTheme, c } from "../lib/theme"

interface ChatInputProps {
  inputRef?: Ref<InputRenderable>
  value: string
  onChange: (value: string) => void
  onInput?: (value: string) => void
  focused: boolean
}

export function ChatInput({ inputRef, value, onChange, onInput, focused }: ChatInputProps) {
  const theme = useTheme()
  return (
    <box
      height={3}
      width="100%"
      border
      borderStyle="rounded"
      borderColor={focused ? c(theme.accent) : c(theme.textMuted)}
      paddingX={1}
    >
      <input
        ref={inputRef}
        value={value}
        onChange={onChange}
        onInput={onInput}
        placeholder="Type a message... (Enter to send)"
        focused={focused}
        width="100%"
      />
    </box>
  )
}
