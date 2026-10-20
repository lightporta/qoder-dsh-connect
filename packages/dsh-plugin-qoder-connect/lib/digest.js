const MAX_TITLE = 200
const MAX_BODY = 64 * 1024
const MAX_TAGS = 10

export function normalizeLearning(input) {
  if (input === null || typeof input !== 'object') return { record: undefined, error: 'body must be a JSON object' }
  if (typeof input.title !== 'string' || input.title.trim().length === 0) return { record: undefined, error: 'title is required' }
  if (input.title.length > MAX_TITLE) return { record: undefined, error: `title too long (max ${MAX_TITLE} characters)` }
  if (typeof input.body !== 'string' || input.body.trim().length === 0) return { record: undefined, error: 'body is required' }
  if (input.body.length > MAX_BODY) return { record: undefined, error: `body too long (max ${MAX_BODY} characters)` }

  let tags = []
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags)) return { record: undefined, error: 'tags must be an array of strings' }
    if (input.tags.length > MAX_TAGS) return { record: undefined, error: `too many tags (max ${MAX_TAGS})` }
    if (!input.tags.every(tag => typeof tag === 'string' && tag.length <= 40)) {
      return { record: undefined, error: 'each tag must be a string of at most 40 characters' }
    }
    tags = input.tags.map(tag => tag.trim()).filter(tag => tag.length > 0)
  }

  const topic = input.topic === undefined ? 'general' : String(input.topic).slice(0, 80)
  const source = typeof input.source === 'string' ? input.source.slice(0, 200) : undefined

  return {
    record: {
      id: `learn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      at: Date.now(),
      topic,
      title: input.title.trim(),
      body: input.body,
      tags,
      ...(source !== undefined ? { source } : {}),
    },
    error: undefined,
  }
}

function stamp(at) {
  return at === undefined ? '—' : new Date(at).toISOString()
}

function inline(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/[`*_[\]<>|]/g, '').trim()
}

export function renderDigest({ runs, learnings, topic, results = false }) {
  const kept = topic === undefined ? learnings : learnings.filter(record => record.topic === topic)
  const lines = []
  lines.push('# Qoder × DeepSeek Harness 代理台账')
  lines.push('')
  lines.push(`生成时间：${stamp(Date.now())}`)
  lines.push(`子代理运行：${runs.length} 条 · 学习记录：${kept.length} 条`)
  lines.push('')

  lines.push('## 学习记录')
  lines.push('')
  if (kept.length === 0) lines.push('（暂无）')
  for (const record of kept.slice().reverse()) {
    lines.push(`### ${inline(record.title)}`)
    lines.push('')
    const meta = [`主题 ${inline(record.topic)}`, stamp(record.at)]
    if (Array.isArray(record.tags) && record.tags.length > 0) meta.push(`标签 ${record.tags.map(inline).join(', ')}`)
    if (record.source !== undefined) meta.push(`来源 ${inline(record.source)}`)
    lines.push(meta.join(' · '))
    lines.push('')
    lines.push(String(record.body ?? '').trimEnd())
    lines.push('')
  }

  lines.push('## 子代理运行')
  lines.push('')
  if (runs.length === 0) lines.push('（暂无）')
  for (const run of runs.slice().reverse()) {
    lines.push(`### ${inline(run.id)} · ${inline(run.status)}`)
    lines.push('')
    lines.push(`- 时间：${stamp(run.createdAt)} → ${stamp(run.finishedAt)}`)
    if (run.durationMs !== undefined) lines.push(`- 耗时：${run.durationMs} ms`)
    lines.push(`- 标签：${inline(run.label)}`)
    lines.push(`- 目录：\`${inline(run.cwd)}\``)
    if (run.sessionId !== undefined) lines.push(`- 会话：\`${inline(run.sessionId)}\``)
    if (run.detail !== undefined) lines.push(`- 终态：${inline(run.detail)}`)
    const counts = run.counts ?? {}
    lines.push(`- 事件 ${counts.events ?? 0} · 轮次 ${counts.turns ?? 0} · 步 ${counts.steps ?? 0} · 工具调用 ${counts.toolCalls ?? 0}（错误 ${counts.toolErrors ?? 0}）`)
    const usage = run.usage ?? {}
    if (usage.totalTokens !== undefined) {
      lines.push(`- tokens：输入 ${usage.inputTokens ?? 0} · 输出 ${usage.outputTokens ?? 0} · 合计 ${usage.totalTokens ?? 0}`)
    }
    lines.push('')
    lines.push('任务：')
    lines.push('')
    lines.push('```text')
    lines.push(String(run.task ?? '').slice(0, 4000))
    lines.push('```')
    if (results === true && run.result !== undefined) {
      lines.push('')
      lines.push('结果：')
      lines.push('')
      lines.push('```markdown')
      lines.push(String(run.result).slice(0, 32 * 1024))
      lines.push('```')
    }
    lines.push('')
  }

  return lines.join('\n')
}
