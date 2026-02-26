import { useRef, useCallback, useEffect } from "react"
import type { WsServerMessage, WsClientMessage, ConnectionStatus } from "../types"

interface UseWebSocketOptions {
  token: string | null
  onMessage: (msg: WsServerMessage) => void
  onStatusChange: (status: ConnectionStatus) => void
  onError: (message: string) => void
}

export function useWebSocket({ token, onMessage, onStatusChange, onError }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMessageRef = useRef(onMessage)
  const onStatusChangeRef = useRef(onStatusChange)
  const onErrorRef = useRef(onError)
  const hadConnectionRef = useRef(false)

  // Keep refs current to avoid stale closures
  onMessageRef.current = onMessage
  onStatusChangeRef.current = onStatusChange
  onErrorRef.current = onError

  useEffect(() => {
    if (!token) return

    function connect() {
      onStatusChangeRef.current(hadConnectionRef.current ? "reconnecting" : "connecting")
      const base = (process.env.BEARCLAW_URL || "ws://localhost:3000").replace(/\/$/, "")
      const ws = new WebSocket(`${base}/ws?token=${token}`)
      wsRef.current = ws

      ws.addEventListener("open", () => {
        hadConnectionRef.current = true
        onStatusChangeRef.current("connected")
      })

      ws.addEventListener("message", (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as WsServerMessage
          onMessageRef.current(msg)
        } catch {
          // ignore malformed messages
        }
      })

      ws.addEventListener("close", (event) => {
        wsRef.current = null
        if (event.code === 1008 || event.code === 4001) {
          // Auth failure — don't reconnect
          onStatusChangeRef.current("disconnected")
          onErrorRef.current(`Authentication failed (${event.code}): ${event.reason || "invalid or expired token"}`)
          return
        }
        if (event.reason) {
          onErrorRef.current(`Connection closed: ${event.reason}`)
        }
        onStatusChangeRef.current(hadConnectionRef.current ? "reconnecting" : "connecting")
        reconnectTimerRef.current = setTimeout(connect, 3000)
      })

      ws.addEventListener("error", () => {
        if (!hadConnectionRef.current) {
          const base = process.env.BEARCLAW_URL || "ws://localhost:3000"
          onErrorRef.current(`Cannot connect to BearClaw daemon at ${base} — is it running?`)
        }
        // close event will fire after error, triggering reconnect
      })
    }

    connect()

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [token])

  const send = useCallback((msg: WsClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  return { send }
}
