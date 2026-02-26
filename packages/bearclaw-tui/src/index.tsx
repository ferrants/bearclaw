import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { App } from "./App"

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  useMouse: false,
})

createRoot(renderer).render(<App />)
