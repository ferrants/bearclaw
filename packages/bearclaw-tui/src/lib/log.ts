import { appendFileSync } from "fs"
import { join } from "path"

const LOG_PATH = join(import.meta.dir, "../../debug.log")

export function log(...args: unknown[]) {
  const timestamp = new Date().toISOString()
  const msg = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")
  appendFileSync(LOG_PATH, `[${timestamp}] ${msg}\n`)
}
