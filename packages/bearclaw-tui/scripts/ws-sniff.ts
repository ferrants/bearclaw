#!/usr/bin/env bun
/**
 * Connect to BearClaw WS and log all messages.
 * Usage: bun scripts/ws-sniff.ts [--filter <type>] [--duration <seconds>]
 *
 * Examples:
 *   bun scripts/ws-sniff.ts                     # log everything
 *   bun scripts/ws-sniff.ts --filter stats       # only stats messages
 *   bun scripts/ws-sniff.ts --filter tool        # tool_started + tool_completed
 *   bun scripts/ws-sniff.ts --duration 10        # run for 10 seconds then exit
 */
import { homedir } from "os"
import { join } from "path"

const args = process.argv.slice(2)
const filterIdx = args.indexOf("--filter")
const filter = filterIdx >= 0 ? args[filterIdx + 1] : null
const durIdx = args.indexOf("--duration")
const duration = durIdx >= 0 ? parseInt(args[durIdx + 1], 10) * 1000 : null

const tokenPath = join(homedir(), ".bearclaw-tui-token")
const token = process.env.BEARCLAW_API_KEY || await Bun.file(tokenPath).text().then(t => t.trim()).catch(() => "")
if (!token) {
  console.error("No token found. Set BEARCLAW_API_KEY or create ~/.bearclaw-tui-token")
  process.exit(1)
}

const base = (process.env.BEARCLAW_URL || "ws://localhost:3000").replace(/\/$/, "")
const url = `${base}/ws?token=${token}`
console.log(`Connecting to ${base}/ws ...`)

const ws = new WebSocket(url)
let count = 0

ws.addEventListener("open", () => {
  console.log("Connected!\n")
})

ws.addEventListener("message", (event) => {
  try {
    const msg = JSON.parse(String(event.data))
    if (filter && !msg.type?.includes(filter)) return
    count++
    const ts = new Date().toISOString().slice(11, 23)
    console.log(`[${ts}] ${msg.type}`)
    console.log(JSON.stringify(msg, null, 2))
    console.log()
  } catch {
    console.log("(unparseable)", String(event.data).slice(0, 200))
  }
})

ws.addEventListener("close", (e) => {
  console.log(`Disconnected: code=${e.code} reason=${e.reason}`)
  console.log(`Total messages received: ${count}`)
  process.exit(0)
})

ws.addEventListener("error", () => {
  console.error(`Failed to connect to ${base}`)
  process.exit(1)
})

if (duration) {
  setTimeout(() => {
    console.log(`\nDuration reached. Total messages: ${count}`)
    ws.close()
  }, duration)
}
