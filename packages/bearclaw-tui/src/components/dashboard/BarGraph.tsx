import { useTheme, c } from "../../lib/theme"

export interface BarItem {
  label: string
  value: number
  extra?: string
  hasError?: boolean
}

interface BarGraphProps {
  items: BarItem[]
  maxBarWidth: number
  barColor?: string | undefined
}

export function BarGraph({ items, maxBarWidth, barColor }: BarGraphProps) {
  const theme = useTheme()
  if (items.length === 0) {
    return <text><span fg={c(theme.textMuted)}>No data</span></text>
  }

  const maxVal = Math.max(...items.map((i) => i.value), 1)
  const maxLabelLen = Math.max(...items.map((i) => i.label.length))
  const baseColor = barColor ?? c(theme.accent)

  return (
    <box flexDirection="column">
      {items.map((item, idx) => {
        const barLen = Math.max(1, Math.round((item.value / maxVal) * maxBarWidth))
        const paddedLabel = item.label.padEnd(maxLabelLen)
        // Ranked color fade: top 2 full color, 2-3 dim, 4+ muted
        const color = idx < 2 ? baseColor : idx < 4 ? c(theme.textDim) : c(theme.textMuted)
        return (
          <text key={item.label}>
            <span fg={c(theme.textDim)}>{paddedLabel} </span>
            <span fg={color}>{"█".repeat(barLen)}</span>
            <span fg={c(theme.text)}> {item.value}</span>
            {item.extra && <span fg={item.hasError ? c(theme.error) : c(theme.textMuted)}>  {item.extra}</span>}
          </text>
        )
      })}
    </box>
  )
}
