import { createContext, useContext } from "react"

export interface Theme {
  name: string
  bg: string
  bgPanel: string
  bgSelected: string
  bgBar: string
  bgWarningPanel: string
  text: string
  textDim: string
  textMuted: string
  accent: string
  accentSecondary: string
  info: string
  success: string
  warning: string
  error: string
  user: string
  assistant: string
  system: string
  tool: string
}

export const THEME_NAMES = ["tokyo-night", "catppuccin", "inferno", "forest", "amethyst", "plain"] as const

export const THEMES: Record<string, Theme> = {
  "tokyo-night": {
    name: "tokyo-night",
    bg: "",
    bgPanel: "#1a1b26",
    bgSelected: "#333366",
    bgBar: "#333333",
    bgWarningPanel: "#442200",
    text: "#cccccc",
    textDim: "#888888",
    textMuted: "#555555",
    accent: "#7aa2f7",
    accentSecondary: "#bb9af7",
    info: "#00ffff",
    success: "#44dd88",
    warning: "#ffcc00",
    error: "#ff5555",
    user: "#00ccff",
    assistant: "#44dd88",
    system: "#888888",
    tool: "#cc88ff",
  },
  catppuccin: {
    name: "catppuccin",
    bg: "",
    bgPanel: "#1e1e2e",
    bgSelected: "#45475a",
    bgBar: "#313244",
    bgWarningPanel: "#45301a",
    text: "#cdd6f4",
    textDim: "#a6adc8",
    textMuted: "#6c7086",
    accent: "#89b4fa",
    accentSecondary: "#cba6f7",
    info: "#89dceb",
    success: "#a6e3a1",
    warning: "#f9e2af",
    error: "#f38ba8",
    user: "#89dceb",
    assistant: "#a6e3a1",
    system: "#a6adc8",
    tool: "#cba6f7",
  },
  inferno: {
    name: "inferno",
    bg: "",
    bgPanel: "#1a0a0a",
    bgSelected: "#442222",
    bgBar: "#331111",
    bgWarningPanel: "#442200",
    text: "#eeccbb",
    textDim: "#aa7766",
    textMuted: "#664433",
    accent: "#ff6633",
    accentSecondary: "#ffaa33",
    info: "#ffcc44",
    success: "#ff8833",
    warning: "#ffaa00",
    error: "#ff3333",
    user: "#ffcc44",
    assistant: "#ff8833",
    system: "#aa7766",
    tool: "#ffaa33",
  },
  forest: {
    name: "forest",
    bg: "",
    bgPanel: "#0a1a0a",
    bgSelected: "#1a3322",
    bgBar: "#112211",
    bgWarningPanel: "#2a3300",
    text: "#bbddbb",
    textDim: "#77aa77",
    textMuted: "#446644",
    accent: "#44ff88",
    accentSecondary: "#88ddaa",
    info: "#66ffcc",
    success: "#33ff66",
    warning: "#aadd44",
    error: "#dd6644",
    user: "#66ffcc",
    assistant: "#33ff66",
    system: "#77aa77",
    tool: "#88ddaa",
  },
  amethyst: {
    name: "amethyst",
    bg: "",
    bgPanel: "#140a1e",
    bgSelected: "#332255",
    bgBar: "#221133",
    bgWarningPanel: "#332200",
    text: "#ddccee",
    textDim: "#9977bb",
    textMuted: "#664488",
    accent: "#bb77ff",
    accentSecondary: "#dd99ff",
    info: "#cc88ff",
    success: "#aa66ee",
    warning: "#ddaa66",
    error: "#ff6688",
    user: "#cc88ff",
    assistant: "#aa66ee",
    system: "#9977bb",
    tool: "#dd99ff",
  },
  plain: {
    name: "plain",
    bg: "",
    bgPanel: "",
    bgSelected: "",
    bgBar: "",
    bgWarningPanel: "",
    text: "",
    textDim: "",
    textMuted: "",
    accent: "",
    accentSecondary: "",
    info: "",
    success: "",
    warning: "",
    error: "",
    user: "",
    assistant: "",
    system: "",
    tool: "",
  },
}

export const ThemeContext = createContext<Theme>(THEMES["tokyo-night"])

export function useTheme(): Theme {
  return useContext(ThemeContext)
}

export function loadThemeName(): string {
  const env = process.env.BEARCLAW_THEME
  if (env && THEMES[env]) return env
  return "tokyo-night"
}

export function nextThemeName(current: string): string {
  const idx = THEME_NAMES.indexOf(current as typeof THEME_NAMES[number])
  if (idx === -1) return THEME_NAMES[0]
  return THEME_NAMES[(idx + 1) % THEME_NAMES.length]
}

/** Return the color or undefined if empty (so OpenTUI uses terminal default) */
export function c(color: string): string | undefined {
  return color || undefined
}
