import { useTheme, c } from "../../lib/theme"

interface HorizontalBarProps {
  value: number // 0 to 1
  width: number
  filledColor?: string | undefined
  emptyColor?: string | undefined
  label?: string
}

export function HorizontalBar({ value, width, filledColor, emptyColor, label }: HorizontalBarProps) {
  const theme = useTheme()
  const clamped = Math.max(0, Math.min(1, value))
  const filled = Math.round(clamped * width)
  const empty = width - filled
  const pct = Math.round(clamped * 100)

  // Heat-mapped fill color when no explicit filledColor
  const autoColor = filledColor ?? (
    clamped <= 0.5 ? c(theme.success) :
    clamped <= 0.8 ? c(theme.warning) :
    c(theme.error)
  )

  return (
    <text>
      <span fg={autoColor}>{"█".repeat(filled)}</span>
      <span fg={emptyColor ?? c(theme.textMuted)}>{"▓".repeat(empty)}</span>
      {label && <span fg={c(theme.textDim)}> {label}</span>}
      <span fg={c(theme.textDim)}> {pct}%</span>
    </text>
  )
}
