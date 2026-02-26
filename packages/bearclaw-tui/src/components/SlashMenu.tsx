import { useTheme, c } from "../lib/theme"

export interface SlashCommand {
  name: string
  description: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/exit", description: "Exit the TUI" },
  { name: "/quit", description: "Exit the TUI" },
  { name: "/new", description: "Start a new conversation" },
  { name: "/config", description: "Open configuration" },
  { name: "/sessions", description: "Browse chat sessions" },
  { name: "/agents", description: "Switch between agents" },
  { name: "/theme", description: "Cycle color theme" },
  { name: "/dashboard", description: "Real-time metrics dashboard" },
]

interface SlashMenuProps {
  filter: string
  selectedIndex: number
}

export function filterCommands(filter: string): SlashCommand[] {
  const lower = filter.toLowerCase()
  return SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(lower))
}

export function SlashMenu({ filter, selectedIndex }: SlashMenuProps) {
  const theme = useTheme()
  const filtered = filterCommands(filter)
  if (filtered.length === 0) return null

  return (
    <box
      flexDirection="column"
      width="100%"
      backgroundColor={c(theme.bgPanel)}
    >
      {filtered.map((cmd, i) => (
        <box
          key={cmd.name}
          paddingX={1}
          backgroundColor={i === selectedIndex ? c(theme.bgSelected) : c(theme.bgPanel)}
        >
          <text>
            <span fg={i === selectedIndex ? c(theme.accent) : c(theme.textDim)}>
              <strong>{cmd.name}</strong>
            </span>
            {"  "}
            <span fg={c(theme.textMuted)}>{cmd.description}</span>
          </text>
        </box>
      ))}
    </box>
  )
}
