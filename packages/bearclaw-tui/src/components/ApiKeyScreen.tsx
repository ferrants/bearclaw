import type { MutableRefObject } from "react"
import type { ChatAction } from "../hooks/useChatState"
import { useTheme, c } from "../lib/theme"

interface ApiKeyScreenProps {
  value: string
  error: string | null
  dispatch: (action: ChatAction) => void
  onChangeRef: MutableRefObject<string>
}

export function ApiKeyScreen({ value, error, dispatch, onChangeRef }: ApiKeyScreenProps) {
  const theme = useTheme()
  return (
    <box flexDirection="column" width="100%" height="100%" justifyContent="center" alignItems="center">
      <box flexDirection="column" alignItems="center" gap={1}>
        <text><span fg={c(theme.user)}><strong>Bearclaw TUI — Setup</strong></span></text>
        <text> </text>
        <text>No API key found. Enter your BearClaw API key:</text>
        <text><span fg={c(theme.textDim)}>(or set BEARCLAW_API_KEY in .env)</span></text>
        <text> </text>
        <box border borderStyle="rounded" borderColor={c(theme.accent)} paddingX={1} width={50}>
          <input
            value={value}
            onChange={(v: string) => {
              onChangeRef.current = v
              dispatch({ type: "SET_API_KEY_INPUT", value: v })
            }}
            placeholder="your-api-key"
            focused
            width="100%"
          />
        </box>
        <text><span fg={c(theme.textDim)}>Press Enter to connect</span></text>
        {error && (
          <text><span fg={c(theme.error)}>{error}</span></text>
        )}
      </box>
    </box>
  )
}
