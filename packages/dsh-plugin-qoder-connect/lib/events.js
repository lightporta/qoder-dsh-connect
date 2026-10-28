const MAX_LINE_CHARS = 400
const MAX_INPUT_CHARS = 200

export function createAggregate() {
  return {
    eventCount: 0,
    turns: 0,
    steps: 0,
    toolCalls: 0,
    toolErrors: 0,
    textChars: 0,
    thinkingChars: 0,
    sessionId: undefined,
    finalText: undefined,
    endReason: undefined,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 0 },
  }
}

function oneLine(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export function fold(aggregate, event) {
  aggregate.eventCount += 1
  if (event === null || typeof event !== 'object') return
  switch (event.type) {
    case 'session':
      if (typeof event.sessionId === 'string') aggregate.sessionId = event.sessionId
      return
    case 'status':
      if (event.phase === 'turn_start') aggregate.turns = Math.max(aggregate.turns, Number(event.turn) || 0)
      if (event.phase === 'step_start') aggregate.steps = Math.max(aggregate.steps, Number(event.step) || 0)
      if (event.phase === 'step_end' && event.usage !== null && typeof event.usage === 'object') {
        for (const key of Object.keys(aggregate.usage)) {
          const value = Number(event.usage[key])
          // The headless stream resets its usage counters after each step_end.
          if (Number.isFinite(value) && value >= 0) aggregate.usage[key] += value
        }
      }
      if (event.phase === 'turn_end' && event.reason !== undefined) aggregate.endReason = event.reason
      return
    case 'thinking':
      aggregate.thinkingChars += typeof event.text === 'string' ? event.text.length : 0
      return
    case 'text':
      aggregate.textChars += typeof event.text === 'string' ? event.text.length : 0
      return
    case 'tool_call':
      aggregate.toolCalls += 1
      return
    case 'tool_result':
      if (event.status === 'error') aggregate.toolErrors += 1
      return
    case 'final':
      if (typeof event.text === 'string') aggregate.finalText = event.text
      return
    default:
      return
  }
}

export function compact(event) {
  if (event === null || typeof event !== 'object') return oneLine(JSON.stringify(event), MAX_LINE_CHARS)
  switch (event.type) {
    case 'session':
      return `session ${event.sessionId ?? '?'}`
    case 'status': {
      const parts = [`status ${event.phase ?? '?'}`]
      if (event.turn !== undefined) parts.push(`turn=${event.turn}`)
      if (event.step !== undefined) parts.push(`step=${event.step}`)
      if (event.reason !== undefined) parts.push(`reason=${oneLine(JSON.stringify(event.reason), 80)}`)
      return parts.join(' ')
    }
    case 'thinking':
      return `thinking ${typeof event.text === 'string' ? event.text.length : 0} chars`
    case 'text':
      return `text ${oneLine(event.text, MAX_LINE_CHARS)}`
    case 'tool_call':
      return `tool ${event.tool ?? '?'} ${oneLine(JSON.stringify(event.input ?? {}), MAX_INPUT_CHARS)}`
    case 'tool_result':
      return `result ${event.status ?? '?'} ${oneLine(event.result ?? '', MAX_INPUT_CHARS)}`
    case 'final':
      return `final ${typeof event.text === 'string' ? event.text.length : 0} chars`
    default:
      return oneLine(JSON.stringify(event), MAX_LINE_CHARS)
  }
}
