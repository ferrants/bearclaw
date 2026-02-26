import { useTheme, c } from "../../lib/theme"

// Braille character encoding: U+2800 base
// Dot positions in a 2x4 grid per character:
// [0,0]=0x01  [1,0]=0x08
// [0,1]=0x02  [1,1]=0x10
// [0,2]=0x04  [1,2]=0x20
// [0,3]=0x40  [1,3]=0x80
const DOT_BITS = [
  [0x01, 0x02, 0x04, 0x40], // column 0, rows 0-3
  [0x08, 0x10, 0x20, 0x80], // column 1, rows 0-3
]

interface SparklineGraphProps {
  data: number[]
  width: number
  height: number // in braille rows (each row = 4 dots high)
  color: string | undefined
  dimColor?: string | undefined
  label?: string
  currentValue?: string
}

export function SparklineGraph({ data, width, height, color, dimColor, label, currentValue }: SparklineGraphProps) {
  const theme = useTheme()
  const totalDotRows = height * 4
  const bottomColor = dimColor ?? c(theme.textDim)

  if (data.length === 0) {
    const emptyLine = String.fromCharCode(0x2800).repeat(width)
    return (
      <box flexDirection="column">
        {Array.from({ length: height }, (_, r) => (
          <text key={r}>
            <span fg={c(theme.textMuted)}>{emptyLine}</span>
            {r === 0 && label && <span fg={color}> {label}</span>}
            {r === 0 && currentValue && <span fg={c(theme.text)}> {currentValue}</span>}
          </text>
        ))}
      </box>
    )
  }

  // Downsample data to fit width (each braille char = 2 columns of data)
  const samples = downsample(data, width)
  const max = Math.max(...samples, 1)

  // Build a grid: grid[dotRow][col] = true if dot should be set
  // dotRow 0 = top, dotRow (totalDotRows-1) = bottom
  const grid: boolean[][] = Array.from({ length: totalDotRows }, () =>
    Array(width * 2).fill(false)
  )

  for (let i = 0; i < samples.length; i++) {
    const barHeight = Math.round((samples[i] / max) * totalDotRows)
    for (let r = 0; r < barHeight; r++) {
      const dotRow = totalDotRows - 1 - r
      grid[dotRow][i] = true
    }
  }

  // Render braille characters
  const lines: string[] = []
  for (let charRow = 0; charRow < height; charRow++) {
    let line = ""
    for (let charCol = 0; charCol < width; charCol++) {
      let code = 0x2800
      for (let col = 0; col < 2; col++) {
        for (let row = 0; row < 4; row++) {
          const gridCol = charCol * 2 + col
          const gridRow = charRow * 4 + row
          if (gridCol < width * 2 && gridRow < totalDotRows && grid[gridRow][gridCol]) {
            code |= DOT_BITS[col][row]
          }
        }
      }
      line += String.fromCharCode(code)
    }
    lines.push(line)
  }

  // Build the value overlay for the first row
  const valueStr = currentValue ? ` ${currentValue}` : ""
  const labelStr = label ? ` ${label}` : ""
  const overlayStr = labelStr + valueStr

  return (
    <box flexDirection="column">
      {lines.map((line, i) => {
        // Two-tone gradient: top rows use color, bottom rows use dimColor (when height > 1)
        const lineColor = (height > 1 && i >= Math.ceil(height / 2)) ? bottomColor : color
        if (i === 0 && overlayStr) {
          // Overlay value right-aligned on first braille row — trim braille to make room
          const overlayLen = overlayStr.length
          const brailleToShow = Math.max(0, line.length - overlayLen)
          return (
            <text key={i}>
              <span fg={lineColor}>{line.slice(0, brailleToShow)}</span>
              {label && <span fg={color}>{labelStr}</span>}
              {currentValue && <span fg={c(theme.text)}>{valueStr}</span>}
            </text>
          )
        }
        return (
          <text key={i}>
            <span fg={lineColor}>{line}</span>
          </text>
        )
      })}
    </box>
  )
}

function downsample(data: number[], targetLen: number): number[] {
  // We need targetLen * 2 grid columns, but each sample = 1 grid column
  const needed = targetLen * 2
  if (data.length <= needed) {
    // Pad with zeros on the left
    const padded = Array(needed - data.length).fill(0)
    return [...padded, ...data]
  }
  // Average groups
  const result: number[] = []
  const ratio = data.length / needed
  for (let i = 0; i < needed; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.floor((i + 1) * ratio)
    let sum = 0
    for (let j = start; j < end; j++) sum += data[j]
    result.push(sum / (end - start))
  }
  return result
}
