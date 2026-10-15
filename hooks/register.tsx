import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit, Segment, Snapshot } from '../types'

const snapshot = atom({ plugin: 'usage-band-for-claude', key: 'snapshot' } as const, null)
// The effort the last main-loop request actually used, and whether the
// current prompt opted into ultracode with the keyword.
const stepEffort = atom({ plugin: 'usage-band-for-claude', key: 'stepEffort' } as const, null)
const ultracodeTurn = atom({ plugin: 'usage-band-for-claude', key: 'ultracodeTurn' } as const, false)

const EFFORT_COLORS: Record<string, string> = {
  low: 'inactive',
  medium: 'suggestion',
  high: 'success',
  xhigh: 'warning',
  max: 'error',
}

const LIMIT_NAMES: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: 'spend',
}

const GAP: Segment = { text: '   ' }

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

export function formatSpan(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${String(mins).padStart(2, '0')}m`
  return `${mins}m`
}

// Green while there's room, yellow when getting close, red near the limit.
export function levelColor(percent: number): string {
  if (percent >= 85) return 'error'
  if (percent >= 60) return 'warning'
  return 'success'
}

export function bar(percent: number, width: number, full: string, empty: string): Segment[] {
  const clamped = Math.min(100, Math.max(0, percent))
  const filled = Math.round((clamped / 100) * width)
  return [
    { text: full.repeat(filled), color: levelColor(percent) },
    { text: empty.repeat(width - filled), color: 'inactive' },
  ]
}

export function limitSegments(limit: Limit, now: number, width: number): Segment[] {
  const name = LIMIT_NAMES[limit.kind] ?? limit.kind
  const segments: Segment[] = [
    { text: `${name} `, dim: true },
    ...bar(limit.percentUsed, width, '▰', '▱'),
    { text: ` ${Math.round(limit.percentUsed)}%`, color: levelColor(limit.percentUsed), bold: true },
  ]
  const resetsAt = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
  if (!Number.isNaN(resetsAt)) {
    segments.push({ text: ` ↻ ${formatSpan(resetsAt - now)}`, color: 'suggestion' })
  }
  return segments
}

export function lineSegments(s: Snapshot, columns: number): Segment[] {
  // Narrow terminals get shorter bars so everything still fits on one row.
  const isNarrow = columns < 110
  const ctxWidth = isNarrow ? 10 : 20
  const limitWidth = isNarrow ? 5 : 10

  const percent = s.contextPercent ?? 0
  const used = s.contextTokens ?? 0
  const segments: Segment[] = [
    { text: `◆ ${s.model.replace(/^claude-/, '')}`, color: 'claude', bold: true },
  ]
  if (s.effort !== undefined) {
    segments.push(
      { text: ' ' },
      { text: `⚡${s.effort}`, color: EFFORT_COLORS[s.effort] ?? 'suggestion', bold: true },
    )
  }
  if (s.ultracode === 'off') {
    segments.push({ text: ' ' }, { text: 'ultracode off', dim: true })
  } else {
    const label = s.ultracode === 'turn' ? 'ULTRACODE (this prompt)' : 'ULTRACODE'
    segments.push({ text: ' ' }, { text: ` ${label} `, color: 'inverseText', backgroundColor: 'planMode', bold: true })
  }
  segments.push(
    GAP,
    { text: 'ctx ', dim: true },
    ...bar(percent, ctxWidth, '█', '░'),
    { text: ` ${percent}%`, color: levelColor(percent), bold: true },
    { text: ` ${formatTokens(used)}/${formatTokens(s.contextWindow)}`, dim: true },
  )

  for (const limit of s.limits) {
    segments.push(GAP, ...limitSegments(limit, s.now, limitWidth))
  }

  segments.push(GAP, { text: `⏱ ${formatSpan(s.now - s.startedAt)}`, dim: true })
  return segments.filter(seg => seg.text !== '')
}

async function refresh($: EngineInterface): Promise<void> {
  const [usage, model, now, settings, lastEffort, isUltracodeTurn] = await Promise.all([
    $.session.usage(),
    $.session.model(),
    $.clock.now(),
    $.settings.read(),
    read($, stepEffort),
    read($, ultracodeTurn),
  ])
  const configuredEffort = typeof settings.effortLevel === 'string' ? settings.effortLevel : undefined
  const next: Snapshot = {
    model,
    effort: lastEffort ?? configuredEffort,
    ultracode: settings.ultracode === true ? 'on' : isUltracodeTurn ? 'turn' : 'off',
    contextTokens: usage.context.tokens,
    contextWindow: usage.context.window,
    contextPercent: usage.context.percent,
    limits: usage.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
    startedAt: usage.startedAt,
    now,
  }
  await update($, snapshot, () => next)
}

export const register: Register = on => {
  let tick: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    tick?.cancel()
    // Keep the reset countdowns current while idle.
    tick = $.clock.every(60_000, () => refresh($))
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    // Never let the band get in the way of sending a prompt.
    await update($, ultracodeTurn, () => /\bultracode\b/i.test(e.text))
      .then(() => refresh($))
      .catch(() => undefined)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.effort !== undefined) {
      const effort = String(e.effort)
      await read($, stepEffort)
        .then(async last => {
          if (last === effort) return
          await update($, stepEffort, () => effort)
          await refresh($)
        })
        .catch(() => undefined)
    }
    return yield* next(e)
  })

  on('session.measure', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snapshot)
    if (e.props.hasSurvey || s === null) {
      return next(e)
    }

    const { Text } = $.ui.resolve(e)

    return (
      <Text wrap="truncate-end">
        {lineSegments(s, e.props.bodyColumns).map(seg => (
          <Text color={seg.color} backgroundColor={seg.backgroundColor} dimColor={seg.dim} weight={seg.bold ? 'bold' : undefined}>
            {seg.text}
          </Text>
        ))}
      </Text>
    )
  })
}
