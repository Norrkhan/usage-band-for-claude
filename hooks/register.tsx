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

// Notification types that mean Claude is waiting on the person. The idle
// reminder is left out: the "done" chime already covered that moment.
const INPUT_NOTIFICATIONS = new Set(['permission_prompt', 'elicitation_dialog'])

const ALERT_TEXT = {
  done: 'Claude finished',
  input: 'Claude needs your input',
} as const

type Alert = keyof typeof ALERT_TEXT

// Each style is a folder under sounds/ holding done.wav and input.wav.
export const CHIME_STYLES = ['classic', 'soft', 'marimba', 'arcade', 'glass', 'pop'] as const
export type ChimeStyle = (typeof CHIME_STYLES)[number]

export function isChimeStyle(value: unknown): value is ChimeStyle {
  return CHIME_STYLES.includes(value as ChimeStyle)
}

// What the chimeStyle option can hold: a style, or a different one each time.
export type StyleChoice = ChimeStyle | 'random'

export function isStyleChoice(value: unknown): value is StyleChoice {
  return value === 'random' || isChimeStyle(value)
}

// Resolves a choice to a style; random never repeats the previous pick.
export function pickStyle(choice: StyleChoice, previous?: ChimeStyle, random: () => number = Math.random): ChimeStyle {
  if (choice !== 'random') return choice
  const pool = CHIME_STYLES.filter(style => style !== previous)
  return pool[Math.floor(random() * pool.length)] ?? pool[0]
}

export function chimeAsset(style: ChimeStyle, alert: Alert): string {
  return `sounds/${style}/${alert}.wav`
}
// chime: play the sound file where Claude Code runs. bell: notify through the
// terminal, which reaches your own machine over SSH. auto: bell over SSH or
// when there's no player, chime otherwise.
export type SoundMode = 'auto' | 'chime' | 'bell'
type Platform = 'darwin' | 'linux' | 'windows' | 'unknown'

// Tried in order on Linux: PulseAudio/PipeWire, PipeWire alone, then ALSA.
const LINUX_PLAYERS = ['paplay', 'pw-play', 'aplay']

let platform: Platform | undefined

async function detectPlatform($: EngineInterface): Promise<Platform> {
  if (platform !== undefined) return platform
  if ((await $.env.get('OS')) === 'Windows_NT') {
    platform = 'windows'
  } else {
    const uname = await $.process.run(['uname', '-s'], { timeoutMs: 5_000 }).catch(() => undefined)
    const name = uname?.stdout.trim()
    platform = name === 'Darwin' ? 'darwin' : name === 'Linux' ? 'linux' : 'unknown'
  }
  return platform
}

async function isOverSsh($: EngineInterface): Promise<boolean> {
  const [connection, tty] = await Promise.all([$.env.get('SSH_CONNECTION'), $.env.get('SSH_TTY')])
  return connection !== undefined || tty !== undefined
}

// Plays the file on the machine Claude Code runs on; false when nothing could.
async function playLocally($: EngineInterface, asset: string): Promise<boolean> {
  const os = await detectPlatform($)
  if (os === 'darwin') {
    await $.audio.play({ asset })
    return true
  }
  const path = `${$.plugin.root}/${asset}`
  if (os === 'windows') {
    const script = `(New-Object Media.SoundPlayer '${path.replaceAll("'", "''")}').PlaySync()`
    const { exitCode } = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', script], {
      timeoutMs: 10_000,
    })
    return exitCode === 0
  }
  if (os === 'linux') {
    for (const player of LINUX_PLAYERS) {
      const result = await $.process.run([player, path], { timeoutMs: 10_000 }).catch(() => undefined)
      if (result?.exitCode === 0) return true
    }
  }
  return false
}

async function ring($: EngineInterface, text: string): Promise<boolean> {
  const sent = await $.ui.notify(text, { title: 'Claude Code' }).catch(() => undefined)
  return sent?.isSent === true
}

async function deliver($: EngineInterface, alert: Alert, mode: SoundMode, style: ChimeStyle): Promise<void> {
  const asset = chimeAsset(style, alert)
  const text = ALERT_TEXT[alert]
  if (mode === 'bell' || (mode === 'auto' && (await isOverSsh($)))) {
    await ring($, text)
    return
  }
  const played = await playLocally($, asset).catch(() => false)
  if (!played && mode === 'auto') await ring($, text)
}

// A question can raise both a tool call and a notification; alert once.
let lastAlertAt = -Infinity

// The last style random played, so the next one differs.
let lastRandomStyle: ChimeStyle | undefined

function resolveStyle(choice: StyleChoice): ChimeStyle {
  const style = pickStyle(choice, lastRandomStyle)
  if (choice === 'random') lastRandomStyle = style
  return style
}

async function alertPerson($: EngineInterface, alert: Alert, mode: SoundMode, choice: StyleChoice): Promise<void> {
  const now = await $.clock.now()
  if (now - lastAlertAt < 1_500) return
  lastAlertAt = now
  const style = resolveStyle(choice)
  // Playing resolves when the clip ends; don't hold the turn for it.
  void deliver($, alert, mode, style).catch(() => undefined)
}

const NO_PLAYER = 'No audio player was found on the machine Claude Code runs on.'

// Plays a style's two chimes one after the other; false when nothing could.
async function playStyle($: EngineInterface, style: ChimeStyle): Promise<boolean> {
  return (
    (await playLocally($, chimeAsset(style, 'done')).catch(() => false)) &&
    (await playLocally($, chimeAsset(style, 'input')).catch(() => false))
  )
}

// /chimes <style>: one style's two chimes.
async function preview($: EngineInterface, choice: StyleChoice): Promise<string> {
  const style = resolveStyle(choice)
  if (!(await playStyle($, style))) return NO_PLAYER
  const which = choice === 'random' ? `"${style}" (picked at random)` : `"${style}"`
  return `Played ${which}: finished, then needs input. Pick a style with chimeStyle in /config.`
}

// /chimes all: every style in order, a short pause between them.
async function previewAll($: EngineInterface): Promise<string> {
  for (const [i, style] of CHIME_STYLES.entries()) {
    if (i > 0) await $.clock.sleep(400)
    if (!(await playStyle($, style))) return NO_PLAYER
  }
  return `Played every style in order: ${CHIME_STYLES.join(', ')}. Pick one with chimeStyle in /config.`
}

export const register: Register = (on, options) => {
  let tick: { cancel: () => void } | undefined
  const soundMode: SoundMode = options.soundMode === 'chime' || options.soundMode === 'bell' ? options.soundMode : 'auto'
  const chimeStyle: StyleChoice = isStyleChoice(options.chimeStyle) ? options.chimeStyle : 'classic'

  const showBand = options.showBand !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'chimes',
      description: 'Hear a chime style (the current one when no style is given)',
      argumentHint: `[${CHIME_STYLES.join('|')}|random|all]`,
    })
    const result = await next(e)
    if (showBand) {
      await refresh($)
      tick?.cancel()
      // Keep the reset countdowns current while idle.
      tick = $.clock.every(60_000, () => refresh($))
    }
    return result
  })

  on('command.run', { command: 'chimes' }, async ($, e) => {
    const asked = e.args.trim().toLowerCase()
    if (asked === '') return { text: await preview($, chimeStyle) }
    if (asked === 'all') return { text: await previewAll($) }
    if (!isStyleChoice(asked)) {
      return { text: `No style "${asked}". Try one of: ${CHIME_STYLES.join(', ')}, random or all.` }
    }
    return { text: await preview($, asked) }
  })

  if (options.soundOnDone !== false) {
    on('turn.complete', async ($, e, next) => {
      const result = await next(e)
      // Only the main loop's end, and not when the person interrupted it.
      if (e.agentId === undefined && e.reason !== 'aborted') {
        await alertPerson($, 'done', soundMode, chimeStyle)
      }
      return result
    })
  }

  if (options.soundOnInput !== false) {
    on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
      await alertPerson($, 'input', soundMode, chimeStyle)
      return next(e)
    })

    on('classic.Notification', async ($, e, next) => {
      if (INPUT_NOTIFICATIONS.has(e.notification_type)) {
        await alertPerson($, 'input', soundMode, chimeStyle)
      }
      return next(e)
    })
  }

  if (!showBand) return

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
