#!/usr/bin/env bun
/**
 * Dump a full session timeline from raw session JSON files.
 * Shows user messages, assistant responses, tool calls (name + args + results),
 * and summary statistics.
 *
 * Usage:
 *   bun scripts/session-dump.ts <session-file>
 *   bun scripts/session-dump.ts <session-file> --json
 *   bun scripts/session-dump.ts <session-file> --tools-only
 *   bun scripts/session-dump.ts <session-file> --summary
 *   bun scripts/session-dump.ts --list [sessions-dir]
 *   bun scripts/session-dump.ts --latest [sessions-dir]
 *
 * Options:
 *   --json         Output raw JSON instead of formatted text
 *   --tools-only   Only show tool call entries (skip user/assistant text)
 *   --summary      Show session statistics only, no message timeline
 *   --list         List all available session files
 *   --latest       Dump the most recently modified session
 *   --no-color     Disable ANSI colors
 *   --max <n>      Show only the last N messages (default: all)
 */

import { readFileSync, readdirSync, statSync } from "fs"
import { join, resolve, basename } from "path"
import { homedir } from "os"

// --- Types matching bearclaw's Message ---
interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

interface Message {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
}

// --- CLI args ---
const args = process.argv.slice(2)
const flags = new Set(args.filter(a => a.startsWith("--")))
const positional = args.filter(a => !a.startsWith("--"))
const noColor = flags.has("--no-color") || !process.stdout.isTTY
const toolsOnly = flags.has("--tools-only")
const summaryOnly = flags.has("--summary")
const jsonOut = flags.has("--json")
const listMode = flags.has("--list")
const latestMode = flags.has("--latest")
const maxIdx = args.indexOf("--max")
const maxMessages = maxIdx >= 0 ? parseInt(args[maxIdx + 1], 10) : 0

// --- Colors ---
const c = {
  reset: noColor ? "" : "\x1b[0m",
  bold: noColor ? "" : "\x1b[1m",
  dim: noColor ? "" : "\x1b[2m",
  blue: noColor ? "" : "\x1b[34m",
  green: noColor ? "" : "\x1b[32m",
  yellow: noColor ? "" : "\x1b[33m",
  cyan: noColor ? "" : "\x1b[36m",
  magenta: noColor ? "" : "\x1b[35m",
  red: noColor ? "" : "\x1b[31m",
  gray: noColor ? "" : "\x1b[90m",
}

// --- Find sessions directory ---
function findSessionsDirs(): string[] {
  const dirs: string[] = []
  // Check common locations
  const candidates = [
    join(homedir(), ".bearclaw", "sessions"),
  ]
  // Also check agent dirs that might be passed
  for (const p of positional) {
    const resolved = resolve(p)
    try {
      const stat = statSync(resolved)
      if (stat.isDirectory()) {
        // Could be a sessions dir directly or an agent dir
        const sessDir = join(resolved, ".bearclaw", "sessions")
        try {
          statSync(sessDir)
          dirs.push(sessDir)
        } catch {
          // Maybe it IS the sessions dir
          const files = readdirSync(resolved).filter(f => f.endsWith(".json"))
          if (files.length > 0) dirs.push(resolved)
        }
      }
    } catch {}
  }
  for (const c of candidates) {
    try {
      statSync(c)
      if (!dirs.includes(c)) dirs.push(c)
    } catch {}
  }
  return dirs
}

function listSessions(dirs: string[]): Array<{ path: string; agentId: string; channel: string; chatId: string; modified: number; size: number }> {
  const results: Array<{ path: string; agentId: string; channel: string; chatId: string; modified: number; size: number }> = []
  const knownChannels = ["cli", "websocket", "scheduler", "gateway"]

  for (const dir of dirs) {
    let files: string[]
    try {
      files = readdirSync(dir).filter(f => f.endsWith(".json"))
    } catch {
      continue
    }
    for (const file of files) {
      const filePath = join(dir, file)
      const base = file.slice(0, -5)
      const parts = base.split("_")

      let channelIdx = -1
      for (let i = 0; i < parts.length; i++) {
        if (knownChannels.includes(parts[i])) {
          channelIdx = i
          break
        }
      }
      if (channelIdx < 1 || channelIdx >= parts.length - 1) continue

      const agentId = parts.slice(0, channelIdx).join("_")
      const channel = parts[channelIdx]
      const chatId = parts.slice(channelIdx + 1).join("_")

      try {
        const stat = statSync(filePath)
        results.push({ path: filePath, agentId, channel, chatId, modified: stat.mtimeMs, size: stat.size })
      } catch {}
    }
  }
  return results.sort((a, b) => b.modified - a.modified)
}

// --- List mode ---
if (listMode) {
  const dirs = findSessionsDirs()
  if (dirs.length === 0) {
    console.error("No sessions directories found.")
    process.exit(1)
  }
  const sessions = listSessions(dirs)
  if (sessions.length === 0) {
    console.error("No session files found.")
    process.exit(1)
  }

  console.log(`${c.bold}Available sessions:${c.reset}\n`)
  for (const s of sessions) {
    const date = new Date(s.modified).toISOString().replace("T", " ").slice(0, 19)
    const sizeKb = (s.size / 1024).toFixed(1)
    console.log(`  ${c.cyan}${s.agentId}${c.reset} ${c.dim}|${c.reset} ${s.channel} ${c.dim}|${c.reset} ${s.chatId}`)
    console.log(`    ${c.dim}${date}  ${sizeKb}KB  ${s.path}${c.reset}`)
  }
  console.log(`\n${sessions.length} session(s) found.`)
  process.exit(0)
}

// --- Latest mode ---
if (latestMode) {
  const dirs = findSessionsDirs()
  const sessions = listSessions(dirs)
  if (sessions.length === 0) {
    console.error("No session files found.")
    process.exit(1)
  }
  positional.length = 0
  positional.push(sessions[0].path)
}

// --- Dump mode ---
if (positional.length === 0) {
  console.log("Usage:")
  console.log("  bun scripts/session-dump.ts <session-file>          # dump a session")
  console.log("  bun scripts/session-dump.ts <session-file> --json   # raw JSON output")
  console.log("  bun scripts/session-dump.ts <session-file> --tools-only")
  console.log("  bun scripts/session-dump.ts <session-file> --summary")
  console.log("  bun scripts/session-dump.ts --list [sessions-dir]   # list sessions")
  console.log("  bun scripts/session-dump.ts --latest [sessions-dir] # dump latest")
  process.exit(0)
}

const filePath = resolve(positional[0])
let messages: Message[]
try {
  messages = JSON.parse(readFileSync(filePath, "utf8"))
} catch (err) {
  console.error(`Failed to read ${filePath}: ${err}`)
  process.exit(1)
}

if (jsonOut) {
  console.log(JSON.stringify(messages, null, 2))
  process.exit(0)
}

// Apply --max
if (maxMessages > 0 && messages.length > maxMessages) {
  messages = messages.slice(-maxMessages)
}

// --- Statistics ---
const stats = {
  total: messages.length,
  system: 0,
  user: 0,
  assistant: 0,
  tool: 0,
  toolCalls: 0,
  uniqueTools: new Set<string>(),
  toolCallDetails: [] as Array<{ name: string; args: Record<string, unknown>; resultLength: number }>,
}

// Build a map of toolCallId -> tool result for pairing
const toolResults = new Map<string, string>()
for (const msg of messages) {
  stats[msg.role]++
  if (msg.role === "assistant" && msg.toolCalls) {
    stats.toolCalls += msg.toolCalls.length
    for (const tc of msg.toolCalls) {
      stats.uniqueTools.add(tc.name)
    }
  }
  if (msg.role === "tool" && msg.toolCallId) {
    toolResults.set(msg.toolCallId, msg.content)
  }
}

// Build tool call details
for (const msg of messages) {
  if (msg.role === "assistant" && msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      stats.toolCallDetails.push({
        name: tc.name,
        args: tc.arguments,
        resultLength: toolResults.get(tc.id)?.length ?? 0,
      })
    }
  }
}

// --- Summary ---
function printSummary() {
  console.log(`${c.bold}Session Summary${c.reset}`)
  console.log(`${"─".repeat(50)}`)
  console.log(`  File:           ${c.dim}${filePath}${c.reset}`)
  console.log(`  Messages:       ${stats.total} total`)
  console.log(`    System:       ${stats.system}`)
  console.log(`    User:         ${stats.user}`)
  console.log(`    Assistant:    ${stats.assistant}`)
  console.log(`    Tool result:  ${stats.tool}`)
  console.log(`  Tool calls:     ${stats.toolCalls}`)
  console.log(`  Unique tools:   ${[...stats.uniqueTools].join(", ") || "(none)"}`)

  if (stats.toolCallDetails.length > 0) {
    // Tool usage breakdown
    const counts = new Map<string, number>()
    for (const d of stats.toolCallDetails) {
      counts.set(d.name, (counts.get(d.name) ?? 0) + 1)
    }
    console.log(`\n${c.bold}Tool Usage${c.reset}`)
    console.log(`${"─".repeat(50)}`)
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
    for (const [name, count] of sorted) {
      const bar = "█".repeat(Math.min(count, 30))
      console.log(`  ${c.yellow}${name.padEnd(20)}${c.reset} ${String(count).padStart(3)} ${c.dim}${bar}${c.reset}`)
    }
  }
}

if (summaryOnly) {
  printSummary()
  process.exit(0)
}

// --- Timeline ---
function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 3) + "..."
}

function indent(s: string, prefix: string): string {
  return s.split("\n").map(line => prefix + line).join("\n")
}

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return "(no args)"
  return entries.map(([k, v]) => {
    const val = typeof v === "string" ? truncate(v, 80) : JSON.stringify(v)
    return `${k}: ${val}`
  }).join(", ")
}

console.log(`${c.bold}Session Timeline${c.reset}  ${c.dim}${basename(filePath)}${c.reset}`)
console.log(`${"═".repeat(70)}\n`)

let msgNum = 0
for (const msg of messages) {
  msgNum++
  const num = `${c.dim}#${String(msgNum).padStart(3)}${c.reset}`

  if (msg.role === "system") {
    if (toolsOnly) continue
    const preview = truncate(msg.content.replace(/\n/g, " "), 100)
    console.log(`${num} ${c.magenta}SYSTEM${c.reset}  ${c.dim}${preview}${c.reset}`)
    console.log()
    continue
  }

  if (msg.role === "user") {
    if (toolsOnly) continue
    console.log(`${num} ${c.blue}${c.bold}USER${c.reset}`)
    console.log(indent(msg.content, `     ${c.dim}│${c.reset} `))
    console.log()
    continue
  }

  if (msg.role === "assistant") {
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      // Tool-calling turn
      for (const tc of msg.toolCalls) {
        console.log(`${num} ${c.yellow}TOOL CALL${c.reset}  ${c.bold}${tc.name}${c.reset}`)
        console.log(`     ${c.dim}id: ${tc.id}${c.reset}`)
        console.log(`     ${c.dim}args: ${formatArgs(tc.arguments)}${c.reset}`)

        // Show paired result
        const result = toolResults.get(tc.id)
        if (result !== undefined) {
          const lines = result.split("\n")
          const preview = lines.length > 10
            ? [...lines.slice(0, 8), `${c.dim}... (${lines.length - 8} more lines)${c.reset}`]
            : lines
          console.log(`     ${c.green}result${c.reset} (${result.length} chars):`)
          for (const line of preview) {
            console.log(`     ${c.dim}│${c.reset} ${line}`)
          }
        }
        console.log()
      }
      // If there's also text content alongside tool calls
      if (msg.content && msg.content.trim()) {
        if (!toolsOnly) {
          console.log(`     ${c.cyan}+ text:${c.reset} ${truncate(msg.content, 200)}`)
          console.log()
        }
      }
    } else {
      // Pure text response
      if (toolsOnly) continue
      console.log(`${num} ${c.green}${c.bold}ASSISTANT${c.reset}`)
      console.log(indent(msg.content, `     ${c.dim}│${c.reset} `))
      console.log()
    }
    continue
  }

  if (msg.role === "tool") {
    // Already shown inline with the tool call above; skip standalone display
    continue
  }
}

console.log(`${"═".repeat(70)}`)
printSummary()
