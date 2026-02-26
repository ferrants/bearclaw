import { useRenderer } from "@opentui/react"
import { useTheme, c } from "../../lib/theme"
import { SparklineGraph } from "./SparklineGraph"
import { HorizontalBar } from "./HorizontalBar"
import { BarGraph } from "./BarGraph"
import type { DashboardState } from "../../hooks/useDashboardData"
import { computeCost, computeRate } from "../../hooks/useDashboardData"

interface DashboardProps {
  state: DashboardState
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

function Panel({ title, borderColor, children, ...props }: { title: string; borderColor?: string; children: React.ReactNode; [k: string]: any }) {
  const theme = useTheme()
  return (
    <box
      border={true}
      borderStyle="rounded"
      borderColor={borderColor ?? c(theme.textMuted)}
      title={` ${title} `}
      titleAlignment="left"
      flexDirection="column"
      paddingX={1}
      {...props}
    >
      {children}
    </box>
  )
}

export function Dashboard({ state }: DashboardProps) {
  const theme = useTheme()
  const renderer = useRenderer()
  const isWide = renderer.width >= 100

  const cost = computeCost(state)
  const rate = computeRate(state)

  // Panel inner widths: border (2) + paddingX (2) = 4 chars overhead per panel
  const sidePanelWidth = 28
  const leftPanelInner = renderer.width - sidePanelWidth - 4 // flexGrow panel inner width
  const fullPanelInner = renderer.width - 4 // full-width panel inner width

  // Build tool bar items sorted by count descending
  const toolItems = Object.entries(state.toolAggregates)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([name, agg]) => ({
      label: name,
      value: agg.count,
      extra: `avg ${formatDuration(agg.totalDurationMs / agg.count)}${agg.errors > 0 ? `  ${agg.errors}err` : ""}`,
      hasError: agg.errors > 0,
    }))

  // Recent completed tool events for activity feed
  const recentCompleted = state.recentToolEvents
    .filter((e) => e.status === "completed")
    .slice(-10)
    .reverse()

  // Agent list
  const agentList = Object.values(state.agents)

  // Current tokens/sec (last sample)
  const lastTokenRate = state.tokenRateSamples.length > 0 ? state.tokenRateSamples[state.tokenRateSamples.length - 1] : 0
  const lastWsIn = state.wsInRateSamples.length > 0 ? state.wsInRateSamples[state.wsInRateSamples.length - 1] : 0
  const lastWsOut = state.wsOutRateSamples.length > 0 ? state.wsOutRateSamples[state.wsOutRateSamples.length - 1] : 0

  // Sum for msg/min display
  const wsInPerMin = state.wsInRateSamples.slice(-60).reduce((a, b) => a + b, 0)
  const wsOutPerMin = state.wsOutRateSamples.slice(-60).reduce((a, b) => a + b, 0)

  if (isWide) {
    return (
      <box flexDirection="column" width="100%" height="100%" flexGrow={1}>
        {/* Row 1: Agent Activity + Agents */}
        <box flexDirection="row" width="100%">
          <Panel title="Agent Activity" borderColor={c(theme.accent)} flexGrow={1} paddingX={0}>
            <SparklineGraph
              data={state.tokenRateSamples}
              width={Math.max(10, leftPanelInner + 2)}
              height={2}
              color={c(theme.accent)}
              currentValue={`${lastTokenRate} tok/s`}
            />
          </Panel>
          <Panel title="Agents" borderColor={c(theme.accentSecondary)} width={28}>
            {agentList.length === 0 ? (
              <text><span fg={c(theme.textMuted)}>No agents</span></text>
            ) : (
              agentList.map((agent) => (
                <box key={agent.agentId} flexDirection="column">
                  <text>
                    <span fg={c(theme.accentSecondary)}>{agent.agentId}</span>
                    {"  "}
                    <span fg={c(theme.success)}>{agent.status}</span>
                  </text>
                  <box flexDirection="row">
                    <text><span fg={c(theme.textDim)}>ctx </span></text>
                    <HorizontalBar
                      value={agent.maxContextTokens > 0 ? agent.contextTokens / agent.maxContextTokens : 0}
                      width={12}
                    />
                  </box>
                </box>
              ))
            )}
          </Panel>
        </box>

        {/* Row 2: Cost + Tools */}
        <box flexDirection="row" width="100%">
          <Panel title="Cost" borderColor={c(theme.warning)} width={28}>
            {state.totalOutputTokens > 0 ? (
              <>
                <text><span fg={c(theme.text)}>Session: </span><span fg={c(theme.warning)}>${cost.toFixed(2)}</span></text>
                <text><span fg={c(theme.text)}>Rate: </span><span fg={c(theme.textDim)}>${rate.toFixed(3)}/min</span></text>
                <text><span fg={c(theme.text)}>In: </span><span fg={c(theme.textDim)}>{formatTokens(state.totalInputTokens)}</span>  <span fg={c(theme.text)}>Out: </span><span fg={c(theme.textDim)}>{formatTokens(state.totalOutputTokens)}</span></text>
                {state.model && <text><span fg={c(theme.textMuted)}>{state.model}</span></text>}
              </>
            ) : (
              <>
                <text><span fg={c(theme.text)}>Tokens: </span><span fg={c(theme.warning)}>{formatTokens(state.totalStreamTokens)}</span></text>
                <text><span fg={c(theme.text)}>Rate: </span><span fg={c(theme.textDim)}>{lastTokenRate}/sec</span></text>
                {state.model && <text><span fg={c(theme.textMuted)}>{state.model}</span></text>}
              </>
            )}
          </Panel>
          <Panel title="Tools" borderColor={c(theme.tool)} flexGrow={1}>
            <BarGraph
              items={toolItems}
              maxBarWidth={Math.max(5, leftPanelInner - 20)}
              barColor={c(theme.tool)}
            />
          </Panel>
        </box>

        {/* Row 3: Activity feed */}
        <Panel title="Activity" borderColor={c(theme.success)} flexGrow={1}>
          {recentCompleted.length === 0 ? (
            <text><span fg={c(theme.textMuted)}>No activity yet</span></text>
          ) : (
            recentCompleted.map((evt, idx) => {
              const time = new Date(evt.timestamp).toLocaleTimeString("en-US", { hour12: false })
              const icon = evt.isError ? "✗" : "✔"
              const iconColor = evt.isError ? c(theme.error) : c(theme.success)
              return (
                <box key={evt.toolCallId} backgroundColor={idx % 2 ? c(theme.bgBar) : undefined}>
                  <text>
                    <span fg={c(theme.textDim)}>{time}  </span>
                    <span fg={iconColor}>{icon}</span>
                    <span fg={c(theme.text)}> {evt.toolName}</span>
                    <span fg={c(theme.textMuted)}> ({formatDuration(evt.durationMs ?? 0)})</span>
                  </text>
                </box>
              )
            })
          )}
        </Panel>

        {/* Row 4: Network + Server */}
        <box flexDirection="row" width="100%">
          <Panel title="Network" borderColor={c(theme.info)} flexGrow={1} paddingX={0}>
            <SparklineGraph
              data={state.wsInRateSamples}
              width={Math.max(10, leftPanelInner + 2)}
              height={1}
              color={c(theme.info)}
              currentValue={`in: ${wsInPerMin} msg/min`}
            />
            <SparklineGraph
              data={state.wsOutRateSamples}
              width={Math.max(10, leftPanelInner + 2)}
              height={1}
              color={c(theme.accentSecondary)}
              currentValue={`out: ${wsOutPerMin} msg/min`}
            />
          </Panel>
          <Panel title="Server" borderColor={c(theme.success)} width={28}>
            {state.serverStats ? (
              <>
                <text><span fg={c(theme.text)}>Chats: </span><span fg={c(theme.accent)}>{state.serverStats.totalChatCount}</span></text>
                <text><span fg={c(theme.text)}>Messages: </span><span fg={c(theme.textDim)}>{state.serverStats.totalMessages}</span></text>
                <text><span fg={c(theme.text)}>Uptime: </span><span fg={c(theme.textDim)}>{formatUptime(state.serverStats.uptimeSeconds)}</span></text>
                {state.serverStats.pendingApprovals > 0 && (
                  <text><span fg={c(theme.warning)}>Pending: {state.serverStats.pendingApprovals}</span></text>
                )}
              </>
            ) : (
              <text><span fg={c(theme.textMuted)}>Waiting for stats...</span></text>
            )}
          </Panel>
        </box>
      </box>
    )
  }

  // Narrow layout: single column stack
  return (
    <box flexDirection="column" width="100%" height="100%" flexGrow={1}>
      <Panel title="Agent Activity" borderColor={c(theme.accent)} paddingX={0}>
        <SparklineGraph
          data={state.tokenRateSamples}
          width={Math.max(10, renderer.width - 4)}
          height={2}
          color={c(theme.accent)}
          currentValue={`${lastTokenRate} tok/s`}
        />
      </Panel>

      <Panel title="Agents" borderColor={c(theme.accentSecondary)}>
        {agentList.length === 0 ? (
          <text><span fg={c(theme.textMuted)}>No agents</span></text>
        ) : (
          agentList.map((agent) => (
            <text key={agent.agentId}>
              <span fg={c(theme.accentSecondary)}>{agent.agentId}</span>
              {"  "}
              <span fg={c(theme.success)}>{agent.status}</span>
            </text>
          ))
        )}
      </Panel>

      <Panel title="Cost" borderColor={c(theme.warning)}>
        {state.totalOutputTokens > 0 ? (
          <text><span fg={c(theme.text)}>Session: </span><span fg={c(theme.warning)}>${cost.toFixed(2)}</span>  <span fg={c(theme.text)}>Rate: </span><span fg={c(theme.textDim)}>${rate.toFixed(3)}/min</span>  <span fg={c(theme.text)}>In: </span><span fg={c(theme.textDim)}>{formatTokens(state.totalInputTokens)}</span>  <span fg={c(theme.text)}>Out: </span><span fg={c(theme.textDim)}>{formatTokens(state.totalOutputTokens)}</span></text>
        ) : (
          <text><span fg={c(theme.text)}>Tokens: </span><span fg={c(theme.warning)}>{formatTokens(state.totalStreamTokens)}</span>  <span fg={c(theme.text)}>Rate: </span><span fg={c(theme.textDim)}>{lastTokenRate}/sec</span>{state.model && <>  <span fg={c(theme.textMuted)}>{state.model}</span></>}</text>
        )}
      </Panel>

      <Panel title="Tools" borderColor={c(theme.tool)}>
        <BarGraph
          items={toolItems}
          maxBarWidth={Math.max(5, renderer.width - 30)}
          barColor={c(theme.tool)}
        />
      </Panel>

      <Panel title="Activity" borderColor={c(theme.success)} flexGrow={1}>
        {recentCompleted.length === 0 ? (
          <text><span fg={c(theme.textMuted)}>No activity yet</span></text>
        ) : (
          recentCompleted.slice(0, 6).map((evt, idx) => {
            const time = new Date(evt.timestamp).toLocaleTimeString("en-US", { hour12: false })
            const icon = evt.isError ? "✗" : "✔"
            const iconColor = evt.isError ? c(theme.error) : c(theme.success)
            return (
              <box key={evt.toolCallId} backgroundColor={idx % 2 ? c(theme.bgBar) : undefined}>
                <text>
                  <span fg={c(theme.textDim)}>{time}  </span>
                  <span fg={iconColor}>{icon}</span>
                  <span fg={c(theme.text)}> {evt.toolName}</span>
                  <span fg={c(theme.textMuted)}> ({formatDuration(evt.durationMs ?? 0)})</span>
                </text>
              </box>
            )
          })
        )}
      </Panel>

      <Panel title="Network" borderColor={c(theme.info)} paddingX={0}>
        <text>
          <span fg={c(theme.info)}>in: {wsInPerMin} msg/min</span>
          {"  "}
          <span fg={c(theme.accentSecondary)}>out: {wsOutPerMin} msg/min</span>
        </text>
      </Panel>

      {state.serverStats && (
        <Panel title="Server" borderColor={c(theme.success)}>
          <text><span fg={c(theme.text)}>Chats: </span><span fg={c(theme.accent)}>{state.serverStats.totalChatCount}</span>  <span fg={c(theme.text)}>Msgs: </span><span fg={c(theme.textDim)}>{state.serverStats.totalMessages}</span>  <span fg={c(theme.text)}>Uptime: </span><span fg={c(theme.textDim)}>{formatUptime(state.serverStats.uptimeSeconds)}</span></text>
        </Panel>
      )}
    </box>
  )
}
