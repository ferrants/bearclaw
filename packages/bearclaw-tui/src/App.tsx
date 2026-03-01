import { useEffect, useCallback, useRef, useState } from "react"
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useKeyboard, useRenderer } from "@opentui/react"
import { useChatState } from "./hooks/useChatState"
import { useWebSocket } from "./hooks/useWebSocket"
import { useDashboardData } from "./hooks/useDashboardData"
import { loadToken, saveToken } from "./lib/tokenStore"
import { MessageHistory } from "./components/MessageHistory"
import { StatusBar } from "./components/StatusBar"
import { ChatInput } from "./components/ChatInput"
import { ApiKeyScreen } from "./components/ApiKeyScreen"
import { ApprovalPrompt } from "./components/ApprovalPrompt"
import { SlashMenu, filterCommands } from "./components/SlashMenu"
import { SessionList } from "./components/SessionList"
import { Dashboard } from "./components/dashboard/Dashboard"
import type { WsServerMessage, Message, Mentionable } from "./types"
import { log } from "./lib/log"
import { ThemeContext, THEMES } from "./lib/theme"

export function App() {
  const renderer = useRenderer()
  const { state, dispatch } = useChatState()
  const { dashState, dashDispatch } = useDashboardData()
  const { messages, inputValue, mode, connectionStatus, streamingContent, pendingApproval, token, apiKeyInput, apiKeyError, sessions, sessionIndex, currentChatId, sessionsSidebarOpen, agents, currentAgentId, agentIndex, themeName } = state
  const theme = THEMES[themeName] ?? THEMES["tokyo-night"]

  // Refs updated synchronously in onInput so useKeyboard always has current data
  const inputValueRef = useRef(inputValue)
  const apiKeyInputRef = useRef(apiKeyInput)
  const chatInputRef = useRef<TextareaRenderable>(null)
  const scrollBoxRef = useRef<ScrollBoxRenderable>(null)
  const currentChatIdRef = useRef(currentChatId)
  currentChatIdRef.current = currentChatId
  const autoLoadChatsRef = useRef(false)
  const sendRef = useRef<(msg: any) => void>(() => {})

  // Slash menu state — driven by the live ref, not React state
  const [slashFilter, setSlashFilter] = useState("")
  const [slashMenuIndex, setSlashMenuIndex] = useState(0)
  const slashMenuVisible = slashFilter.startsWith("/") && filterCommands(slashFilter).length > 0

  // Load saved token on mount
  useEffect(() => {
    loadToken().then((saved) => {
      if (saved) {
        dispatch({ type: "SET_TOKEN", token: saved })
      }
    })
  }, [])

  const handleWsMessage = useCallback((msg: WsServerMessage) => {
    log("[ws:recv]", msg.type, msg.type === "token" ? "(streaming)" : JSON.stringify(msg).slice(0, 500))

    // Feed ALL messages to dashboard (before chat filtering)
    dashDispatch({ type: "WS_IN" })
    if (msg.type === "token") dashDispatch({ type: "TOKEN_RECEIVED" })
    if (msg.type === "tool_started") dashDispatch({ type: "TOOL_STARTED", toolCallId: msg.toolCallId, toolName: msg.toolName })
    if (msg.type === "tool_completed") dashDispatch({ type: "TOOL_COMPLETED", toolCallId: msg.toolCallId, toolName: msg.toolName, durationMs: msg.durationMs, isError: msg.isError })
    if (msg.type === "agent_status") {
      dashDispatch({ type: "AGENT_STATUS", agentId: msg.agentId, status: msg.status, contextTokens: msg.contextTokens, maxContextTokens: msg.maxContextTokens })
      dispatch({ type: "AGENT_STATUS", agentId: msg.agentId, status: msg.status, contextTokens: msg.contextTokens, maxContextTokens: msg.maxContextTokens })
    }
    if (msg.type === "usage") dashDispatch({ type: "USAGE", model: msg.model, inputTokens: msg.inputTokens, outputTokens: msg.outputTokens, cacheReadTokens: msg.cacheReadTokens, cacheWriteTokens: msg.cacheWriteTokens })
    if (msg.type === "stats") dashDispatch({ type: "STATS", uptimeSeconds: msg.uptimeSeconds, agents: msg.agents, totalChatCount: msg.totalChatCount, totalMessages: msg.totalMessages, pendingApprovals: msg.pendingApprovals })

    // Filter chat-specific messages to only show ones for the active chatId
    const isBroadcast = msg.type !== "chat_history" && msg.type !== "chat_list" && msg.type !== "mentionables" && msg.type !== "pending_approvals" && msg.type !== "user_rules" && msg.type !== "user_rule_removed" && msg.type !== "error"
    const msgChatId = (msg as any).chatId as string | undefined
    if (isBroadcast && msgChatId) {
      const activeChatId = currentChatIdRef.current
      log("[ws:filter]", "type:", msg.type, "msgChatId:", msgChatId, "activeChatId:", activeChatId)
      if (activeChatId === null) {
        log("[ws:filter]", "dropping (no active chat)")
        return
      } else if (msgChatId !== activeChatId) {
        log("[ws:filter]", "dropping (wrong chat)")
        return
      }
    } else if (isBroadcast && !msgChatId) {
      // Broadcast message with no chatId — can't filter, log it
      log("[ws:filter]", "WARNING: broadcast message with no chatId, type:", msg.type)
    }

    switch (msg.type) {
      case "token":
        dispatch({ type: "STREAM_TOKEN", text: msg.token })
        break
      case "agent_response":
        dispatch({ type: "AGENT_RESPONSE", content: msg.content })
        break
      case "tool_pending":
        dispatch({ type: "TOOL_PENDING", toolCallId: msg.toolCallId, toolName: msg.toolName, args: msg.args })
        break
      case "tool_started":
        dispatch({ type: "TOOL_STARTED", toolCallId: msg.toolCallId, toolName: msg.toolName })
        break
      case "tool_completed":
        dispatch({
          type: "TOOL_COMPLETED",
          toolCallId: msg.toolCallId,
          toolName: msg.toolName,
          durationMs: msg.durationMs,
          isError: msg.isError,
        })
        break
      case "approval_needed":
        dispatch({
          type: "APPROVAL_NEEDED",
          requestId: msg.requestId,
          toolName: msg.toolName,
          args: msg.args,
        })
        break
      case "schedule_triggered":
        dispatch({ type: "SCHEDULE_TRIGGERED", schedule: msg.schedule, agentId: msg.agentId, message: msg.message })
        break
      case "command_result":
        // Skip the /new command_result — the client handles new chats via create_chat
        if (msg.command === "new") break
        dispatch({ type: "COMMAND_RESULT", command: msg.command, message: msg.message })
        break
      case "chat_created":
        log("[ws:chat_created]", "chatId:", msg.chatId)
        dispatch({ type: "ADOPT_CHAT_ID", chatId: msg.chatId })
        currentChatIdRef.current = msg.chatId
        break
      case "notice":
        dispatch({ type: "NOTICE", level: msg.level, code: msg.code, message: msg.message })
        break
      case "chat_list":
        log("[sessions]", "received", msg.chats.length, "chats")
        if (autoLoadChatsRef.current && !currentChatIdRef.current) {
          dispatch({ type: "SESSIONS_RECEIVED", chats: msg.chats })
          const chats = msg.chats
          const filtered = currentAgentId
            ? chats.filter(c => c.agentId === currentAgentId)
            : chats
          const latest = filtered[0]
          if (latest) {
            sendRef.current({ type: "get_chat_history", id: String(Date.now()), chatId: latest.chatId, agentId: latest.agentId, channel: latest.channel })
          } else {
            // No existing chats — create a fresh one
            sendRef.current({ type: "create_chat", id: String(Date.now()) })
          }
          autoLoadChatsRef.current = false
        } else {
          dispatch({ type: "SESSIONS_LOADED", chats: msg.chats })
        }
        break
      case "mentionables": {
        const agentItems = msg.items.filter((item: Mentionable) => item.type === "agent")
        log("[agents]", "received", agentItems.length, "agents:", agentItems.map((a: Mentionable) => a.name).join(", "))
        dispatch({ type: "AGENTS_LOADED", agents: agentItems })
        break
      }
      case "chat_history": {
        log("[history]", "chatId:", msg.chatId, "raw message count:", msg.messages?.length ?? "undefined")
        if (msg.messages?.length > 0) {
          log("[history]", "first message sample:", JSON.stringify(msg.messages[0]).slice(0, 500))
          log("[history]", "last message sample:", JSON.stringify(msg.messages[msg.messages.length - 1]).slice(0, 500))
        }
        const loaded: Message[] = msg.messages.map((m, i) => {
          let content: string
          const raw = m.content as unknown
          if (typeof raw === "string") {
            content = raw
          } else if (Array.isArray(raw)) {
            content = raw
              .filter((block: any) => block?.type === "text" && block?.text)
              .map((block: any) => block.text as string)
              .join("\n")
          } else {
            content = String(raw ?? "")
          }
          if (i === 0 || i === msg.messages.length - 1) {
            log("[history]", `parsed msg[${i}]:`, "role:", m.role, "contentType:", typeof raw, Array.isArray(raw) ? `array[${raw.length}]` : "", "parsed length:", content.length)
          }
          return {
            id: `hist-${i}`,
            role: m.role as Message["role"],
            content,
            timestamp: Date.now(),
          }
        })
        log("[history]", "dispatching SESSION_SELECTED with", loaded.length, "messages,", loaded.filter(m => m.content.length > 0).length, "non-empty")
        dispatch({ type: "SESSION_SELECTED", chatId: msg.chatId, agentId: msg.agentId ?? null, messages: loaded })
        // Fetch any pending approvals for this chat
        sendRef.current({ type: "list_pending_approvals", id: String(Date.now()), chatId: msg.chatId })
        break
      }
      case "pending_approvals": {
        if (msg.approvals?.length > 0) {
          const first = msg.approvals[0]
          if (first.chatId === currentChatIdRef.current) {
            dispatch({ type: "APPROVAL_NEEDED", requestId: first.requestId, toolName: first.toolName, args: first.args })
          }
        }
        break
      }
      case "agent_status":
      case "usage":
      case "stats":
        // Handled by dashboard dispatch above
        break
      case "error":
        dispatch({ type: "WS_ERROR", message: msg.message })
        break
    }
  }, [])

  const { send } = useWebSocket({
    token,
    onMessage: handleWsMessage,
    onStatusChange: (status) => dispatch({ type: "SET_CONNECTION_STATUS", status }),
    onError: (message) => dispatch({ type: "WS_ERROR", message }),
  })
  // Wrap send to track outbound messages in dashboard
  const dashSend = useCallback((msg: any) => {
    dashDispatch({ type: "WS_OUT" })
    send(msg)
  }, [send])
  sendRef.current = dashSend

  // Poll get_stats while in dashboard mode
  useEffect(() => {
    if (mode !== "dashboard" || connectionStatus !== "connected") return
    // Initial request
    dashSend({ type: "get_stats", id: String(Date.now()) })
    const interval = setInterval(() => {
      dashSend({ type: "get_stats", id: String(Date.now()) })
    }, 5000)
    return () => clearInterval(interval)
  }, [mode, connectionStatus])

  // Fetch agents when connected
  useEffect(() => {
    if (connectionStatus === "connected") {
      log("[agents]", "sending query_mentionables")
      send({ type: "query_mentionables", id: String(Date.now()) })
      autoLoadChatsRef.current = true
      send({ type: "list_chats", id: String(Date.now()) })
    }
  }, [connectionStatus])

  // Called on every keystroke by the input component
  const handleInput = useCallback((v: string) => {
    inputValueRef.current = v
    setSlashFilter(v)
    setSlashMenuIndex(0)
  }, [])

  const handleSubmit = useCallback(() => {
    const currentInput = inputValueRef.current

    // If slash menu is showing, pick the selected command
    if (slashMenuVisible && mode === "chat") {
      const filtered = filterCommands(currentInput)
      if (filtered.length > 0) {
        const cmd = filtered[slashMenuIndex]
        dispatch({ type: "SET_INPUT", value: cmd.name })
        inputValueRef.current = cmd.name
        setSlashFilter("")
        setSlashMenuIndex(0)
        return
      }
    }

    if (mode !== "chat") return

    const text = currentInput.trim()
    if (!text) return

    if (text === "/exit" || text === "/quit" || text === ":q") {
      renderer.destroy()
      process.exit(0)
      return
    }
    if (text === "/new") {
      dispatch({ type: "NEW_CHAT" })
      const createPayload: any = { type: "create_chat", id: String(Date.now()) }
      if (currentAgentId) createPayload.agentId = currentAgentId
      send(createPayload)
      dispatch({ type: "SET_INPUT", value: "" })
      inputValueRef.current = ""
      setSlashFilter("")
      if (chatInputRef.current) {
        chatInputRef.current.editBuffer.setText("")
      }
      return
    }
    if (text === "/sessions" || text === "/agents") {
      send({ type: "list_chats", id: String(Date.now()) })
      dispatch({ type: "SET_INPUT", value: "" })
      inputValueRef.current = ""
      setSlashFilter("")
      if (chatInputRef.current) {
        chatInputRef.current.editBuffer.setText("")
      }
      return
    }
    if (text === "/theme") {
      dispatch({ type: "CYCLE_THEME" })
      dispatch({ type: "SET_INPUT", value: "" })
      inputValueRef.current = ""
      setSlashFilter("")
      if (chatInputRef.current) {
        chatInputRef.current.editBuffer.setText("")
      }
      return
    }
    if (text === "/dashboard") {
      dispatch({ type: "SET_MODE", mode: "dashboard" })
      dispatch({ type: "SET_INPUT", value: "" })
      inputValueRef.current = ""
      setSlashFilter("")
      if (chatInputRef.current) {
        chatInputRef.current.editBuffer.setText("")
      }
      return
    }

    const chatIdToSend = currentChatIdRef.current
    if (!chatIdToSend) {
      // No chatId yet — auto-create one before sending
      const createPayload: any = { type: "create_chat", id: String(Date.now()) }
      if (currentAgentId) createPayload.agentId = currentAgentId
      send(createPayload)
      // Queue the message to be sent after chat_created arrives
      const pendingText = text
      const checkInterval = setInterval(() => {
        if (currentChatIdRef.current) {
          clearInterval(checkInterval)
          const payload: any = { type: "message", id: String(Date.now()), message: pendingText, chatId: currentChatIdRef.current }
          if (currentAgentId) payload.agentId = currentAgentId
          send(payload)
        }
      }, 50)
      // Safety: clear after 5s
      setTimeout(() => clearInterval(checkInterval), 5000)
    } else {
      const msgPayload: any = { type: "message", id: String(Date.now()), message: text, chatId: chatIdToSend }
      if (currentAgentId) {
        msgPayload.agentId = currentAgentId
      }
      send(msgPayload)
    }
    dispatch({ type: "SEND_MESSAGE" })
    inputValueRef.current = ""
    setSlashFilter("")
    if (chatInputRef.current) {
      chatInputRef.current.editBuffer.setText("")
    }
  }, [currentAgentId, mode, renderer, send, slashMenuIndex, slashMenuVisible])

  useKeyboard((key) => {
    if (key.eventType === "release") return
    if (key.name === "enter" || key.name === "return") {
      log("[key]", "enter", { shift: key.shift, ctrl: key.ctrl, meta: key.meta, option: key.option, sequence: key.sequence, raw: key.raw })
    }
    // Ctrl+\ toggles sessions sidebar (\x1c is the raw char for ctrl+\)
    if (key.name === "\x1c") {
      if (sessionsSidebarOpen) {
        dispatch({ type: "CLOSE_SESSIONS" })
      } else {
        send({ type: "list_chats", id: String(Date.now()) })
      }
      return
    }

    if (key.name === "escape") {
      if (mode === "dashboard") {
        dispatch({ type: "SET_MODE", mode: "chat" })
        return
      }
      if (mode === "approval" && pendingApproval) {
        send({ type: "approval_response", requestId: pendingApproval.requestId, approved: false, reject: true })
        dispatch({ type: "APPROVAL_REJECTED" })
        return
      }
      if (mode === "sessions") {
        dispatch({ type: "CLOSE_SESSIONS" })
        return
      }
      if (slashMenuVisible) {
        setSlashFilter("")
        return
      }
      if (mode !== "chat") {
        dispatch({ type: "SET_MODE", mode: "chat" })
        if (mode === "scrolling" && scrollBoxRef.current) {
          scrollBoxRef.current.scrollTo(Infinity)
        }
      }
      return
    }

    // Sessions mode
    if (mode === "sessions") {
      if (key.name === "left") {
        dispatch({ type: "AGENT_SELECT_MOVE", delta: -1 })
        return
      }
      if (key.name === "right") {
        dispatch({ type: "AGENT_SELECT_MOVE", delta: 1 })
        return
      }
      if (key.name === "up") {
        dispatch({ type: "SESSION_SELECT_MOVE", delta: -1 })
        return
      }
      if (key.name === "down") {
        dispatch({ type: "SESSION_SELECT_MOVE", delta: 1 })
        return
      }
      if (key.name === "enter" || key.name === "return") {
        const filtered = currentAgentId
          ? sessions.filter(s => s.agentId === currentAgentId)
          : sessions
        const session = filtered[sessionIndex]
        if (session) {
          log("[sessions]", "selecting session:", session.chatId, "agentId:", session.agentId, "channel:", session.channel, "messageCount:", session.messageCount)
          send({ type: "get_chat_history", id: String(Date.now()), chatId: session.chatId, agentId: session.agentId, channel: session.channel })
        } else {
          log("[sessions]", "no session at index", sessionIndex, "of", filtered.length)
        }
        return
      }
      if (key.name === "n") {
        dispatch({ type: "NEW_CHAT" })
        const createPayload: any = { type: "create_chat", id: String(Date.now()) }
        if (currentAgentId) createPayload.agentId = currentAgentId
        send(createPayload)
        return
      }
      return
    }

    // Approval mode: Y/S/D/A to approve with scope, N/! to deny, Esc to reject
    if (mode === "approval" && pendingApproval) {
      if (key.name === "y") {
        send({ type: "approval_response", requestId: pendingApproval.requestId, approved: true, allow: "once" })
        dispatch({ type: "APPROVAL_RESOLVED" })
        return
      }
      if (key.name === "s") {
        send({ type: "approval_response", requestId: pendingApproval.requestId, approved: true, allow: "session" })
        dispatch({ type: "APPROVAL_RESOLVED" })
        return
      }
      if (key.name === "d") {
        send({ type: "approval_response", requestId: pendingApproval.requestId, approved: true, allow: "day" })
        dispatch({ type: "APPROVAL_RESOLVED" })
        return
      }
      if (key.name === "a") {
        send({ type: "approval_response", requestId: pendingApproval.requestId, approved: true, allow: "always" })
        dispatch({ type: "APPROVAL_RESOLVED" })
        return
      }
      if (key.name === "n") {
        send({ type: "approval_response", requestId: pendingApproval.requestId, approved: false })
        dispatch({ type: "APPROVAL_RESOLVED" })
        return
      }
      if (key.name === "!") {
        send({ type: "approval_response", requestId: pendingApproval.requestId, approved: false, deny: "always" })
        dispatch({ type: "APPROVAL_RESOLVED" })
        return
      }
      return
    }

    // Setup mode: handle Enter to submit API key (deferred so input flushes onChange first)
    if (mode === "setup") {
      if (key.name === "enter" || key.name === "return") {
        setTimeout(() => {
          const currentKey = apiKeyInputRef.current
          const trimmed = currentKey.trim()
          if (trimmed) {
            saveToken(trimmed).then(() => {
              dispatch({ type: "SET_TOKEN", token: trimmed })
            }).catch((err: any) => {
              dispatch({ type: "SET_API_KEY_ERROR", error: err.message ?? String(err) })
            })
          }
        }, 0)
      }
      return
    }

    if (key.name === "tab") {
      dispatch({ type: "SET_MODE", mode: mode === "chat" ? "scrolling" : "chat" })
      return
    }

    // Slash menu navigation
    if (slashMenuVisible && mode === "chat") {
      if (key.name === "up") {
        setSlashMenuIndex((i) => {
          const filtered = filterCommands(inputValueRef.current)
          return i > 0 ? i - 1 : filtered.length - 1
        })
        return
      }
      if (key.name === "down") {
        setSlashMenuIndex((i) => {
          const filtered = filterCommands(inputValueRef.current)
          return i < filtered.length - 1 ? i + 1 : 0
        })
        return
      }
      // Tab to accept the highlighted command
      // Enter to accept and submit would be handled below in the deferred handler
    }

    if (key.name === "enter" || key.name === "return") {
      if (mode === "chat") {
        return
      }
    }
  }, { release: true })

  // API key setup screen
  if (!token) {
    return (
      <ThemeContext.Provider value={theme}>
        <box flexDirection="column" width="100%" height="100%">
          <ApiKeyScreen value={apiKeyInput} error={apiKeyError} dispatch={dispatch} onChangeRef={apiKeyInputRef} />
          <StatusBar mode={mode} messageCount={0} connectionStatus={connectionStatus} />
        </box>
      </ThemeContext.Provider>
    )
  }

  // Dashboard mode
  if (mode === "dashboard") {
    return (
      <ThemeContext.Provider value={theme}>
        <box flexDirection="column" width="100%" height="100%">
          <Dashboard state={dashState} />
          <StatusBar
            mode={mode}
            messageCount={messages.length}
            connectionStatus={connectionStatus}
            agentName={currentAgentId}
            agentStatus={currentAgentId ? state.agentStatuses[currentAgentId]?.status : undefined}
          />
        </box>
      </ThemeContext.Provider>
    )
  }

  const isWide = renderer.width >= 100
  const showSidebar = sessionsSidebarOpen
  const sessionsFocused = mode === "sessions"
  // Narrow + sidebar open: hide chat, show sessions full-width
  const narrowOverlay = showSidebar && !isWide

  // Main chat UI
  return (
    <ThemeContext.Provider value={theme}>
    <box flexDirection="row" width="100%" height="100%">
      {showSidebar && (
        <box width={narrowOverlay ? "100%" : 30} height="100%">
          <SessionList sessions={sessions} selectedIndex={sessionIndex} focused={sessionsFocused} agents={agents} currentAgentId={currentAgentId} agentIndex={agentIndex} />
        </box>
      )}
      {!narrowOverlay && (
        <box flexDirection="column" flexGrow={1} height="100%">
          <MessageHistory
            messages={messages}
            focused={mode === "scrolling"}
            streamingContent={streamingContent}
            scrollRef={scrollBoxRef}
            onMouseScroll={() => {
              if (mode === "chat") {
                dispatch({ type: "SET_MODE", mode: "scrolling" })
              }
            }}
          />
          {pendingApproval && <ApprovalPrompt approval={pendingApproval} />}
          <StatusBar
            mode={mode}
            messageCount={messages.length}
            connectionStatus={connectionStatus}
            agentName={currentAgentId}
            agentStatus={currentAgentId ? state.agentStatuses[currentAgentId]?.status : undefined}
          />
          {slashMenuVisible && (
            <SlashMenu filter={slashFilter} selectedIndex={slashMenuIndex} />
          )}
          <ChatInput
            inputRef={chatInputRef}
            value={inputValue}
            onChange={(v) => {
              inputValueRef.current = v
              dispatch({ type: "SET_INPUT", value: v })
            }}
            onInput={handleInput}
            onSubmit={handleSubmit}
            focused={mode === "chat"}
            maxWidth={showSidebar ? renderer.width - 30 : renderer.width}
          />
        </box>
      )}
    </box>
    </ThemeContext.Provider>
  )
}
