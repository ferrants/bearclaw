#!/usr/bin/env bun
/**
 * Send a single query to BearClaw WS and print the response.
 * Usage: bun scripts/ws-query.ts <type> [key=value ...]
 *
 * Examples:
 *   bun scripts/ws-query.ts get_stats
 *   bun scripts/ws-query.ts list_chats
 *   bun scripts/ws-query.ts query_mentionables
 *   bun scripts/ws-query.ts query_mentionables filter=agent
 */
import { homedir } from "os"
import { join } from "path"

const args = process.argv.slice(2)
if (args.length === 0) {
  console.log("Usage: bun scripts/ws-query.ts <type> [key=value ...]")
  console.log("\nExamples:")
  console.log("  bun scripts/ws-query.ts get_stats")
  console.log("  bun scripts/ws-query.ts list_chats")
  console.log("  bun scripts/ws-query.ts query_mentionables")
  process.exit(0)
}

const msgType = args[0]
const id = String(Date.now())
const payload: Record<string, any> = { type: msgType, id }
for (const arg of args.slice(1)) {
  const [k, v] = arg.split("=", 2)
  payload[k] = v
}

const tokenPath = join(homedir(), ".bearclaw-tui-token")
const token = process.env.BEARCLAW_API_KEY || await Bun.file(tokenPath).text().then(t => t.trim()).catch(() => "")
if (!token) {
  console.error("No token found. Set BEARCLAW_API_KEY or create ~/.bearclaw-tui-token")
  process.exit(1)
}

const base = (process.env.BEARCLAW_URL || "ws://localhost:3000").replace(/\/$/, "")
const ws = new WebSocket(`${base}/ws?token=${token}`)

ws.addEventListener("open", () => {
  console.log(`Sending: ${JSON.stringify(payload)}`)
  console.log()
  ws.send(JSON.stringify(payload))
})

ws.addEventListener("message", (event) => {
  try {
    const msg = JSON.parse(String(event.data))
    // Print the response matching our request id, or the first response of matching type
    if (msg.id === id || msg.type === msgType || msg.type === msgType.replace("get_", "")) {
      console.log(`Response (${msg.type}):`)
      console.log(JSON.stringify(msg, null, 2))
      ws.close()
    }
  } catch {}
})

ws.addEventListener("close", () => process.exit(0))
ws.addEventListener("error", () => {
  console.error(`Failed to connect to ${base}`)
  process.exit(1)
})

// Timeout after 5s
setTimeout(() => {
  console.error("Timeout waiting for response")
  ws.close()
}, 5000)
