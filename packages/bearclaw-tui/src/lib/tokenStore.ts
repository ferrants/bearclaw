import { homedir } from "os"
import { join } from "path"
import { readFile, writeFile } from "fs/promises"

const TOKEN_PATH = join(homedir(), ".bearclaw-tui-token")

export async function loadToken(): Promise<string | null> {
  // Env var takes priority
  const envKey = process.env.BEARCLAW_API_KEY
  if (envKey) return envKey

  try {
    const text = (await readFile(TOKEN_PATH, "utf8")).trim()
    return text || null
  } catch {
    return null
  }
}

export async function saveToken(token: string): Promise<void> {
  await writeFile(TOKEN_PATH, token, "utf8")
}
