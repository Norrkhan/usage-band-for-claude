import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code/testing'

import { CHIME_STYLES, pickStyle } from '../hooks/register'

const TURN = { answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as const
const PERMISSION = { message: 'Claude needs your permission', notification_type: 'permission_prompt' } as const
const CHIMES = {
  command: 'chimes',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

type Host = {
  os?: 'Darwin' | 'Linux' | 'Windows'
  env?: Record<string, string>
  // Linux players that are installed; the rest fail to start.
  players?: string[]
  // Whether the terminal has a notification channel.
  canNotify?: boolean
  // How far each look at the clock moves it on.
  clockStep?: number
}

// Stands in for the machine Claude Code runs on and records every sound it was
// asked for: `play:<asset>`, `run:<player>` or `notify:<text>`.
function fakeHost(on: On, host: Host = {}): string[] {
  const { os = 'Darwin', players = [], canNotify = true, clockStep = 5_000 } = host
  const env: Record<string, string> = { ...host.env, ...(os === 'Windows' ? { OS: 'Windows_NT' } : {}) }
  const heard: string[] = []
  on('audio.play', (_, e) => {
    if (e.clip.asset !== undefined) heard.push(`play:${e.clip.asset}`)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const [command] = e.argv
    if (command === 'uname') return { value: { exitCode: 0, stdout: `${os}\n`, stderr: '' } }
    if (command === 'powershell' || players.includes(command)) {
      heard.push(`run:${command}`)
      return { value: { exitCode: 0, stdout: '', stderr: '' } }
    }
    throw new Error(`${command}: not found`)
  })
  on('ui.notify', (_, e) => {
    if (!canNotify) return { value: { isSent: false, reason: 'no-channel' } }
    heard.push(`notify:${e.text}`)
    return { value: { isSent: true, channel: 'terminal_bell' } }
  })
  on('env.get', (_, e) => ({ value: env[e.name] }))
  let now = 0
  on('clock.now', () => ({ value: (now += clockStep) }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: {} }))
  on('classic.Notification', () => ({}))
  on('command.register', () => ({ value: { command: 'chimes' } }))
  on('clock.sleep', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return heard
}

async function settle(): Promise<void> {
  // Sounds are started without waiting; let them land.
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

test('chimes when the main loop finishes a turn', async ($, on) => {
  const heard = fakeHost(on)
  await $.turn.complete(TURN)
  await settle()
  expect(heard).toEqual(['play:sounds/classic/done.wav'])
})

test('stays quiet for interrupted turns and subagents', async ($, on) => {
  const heard = fakeHost(on)
  await $.turn.complete({ ...TURN, reason: 'aborted', isAborted: true })
  await $.turn.complete({ ...TURN, agentId: 'a1' })
  await settle()
  expect(heard).toEqual([])
})

test('chimes when Claude asks or waits for a permission, once per moment', async ($, on) => {
  const heard = fakeHost(on, { clockStep: 100 })
  await $.classic.Notification(PERMISSION)
  await $.classic.Notification(PERMISSION)
  await $.classic.Notification({ message: 'Claude is waiting', notification_type: 'idle_prompt' })
  await settle()
  expect(heard).toEqual(['play:sounds/classic/input.wav'])
})

test('sounds can be turned off', { options: { soundOnDone: false, soundOnInput: false } }, async ($, on) => {
  const heard = fakeHost(on)
  await $.turn.complete(TURN)
  await $.classic.Notification(PERMISSION)
  await settle()
  expect(heard).toEqual([])
})

test('plays through PowerShell on Windows', async ($, on) => {
  const heard = fakeHost(on, { os: 'Windows' })
  await $.turn.complete(TURN)
  await settle()
  expect(heard).toEqual(['run:powershell'])
})

test('plays with the first Linux player that is installed', async ($, on) => {
  const heard = fakeHost(on, { os: 'Linux', players: ['aplay'] })
  await $.turn.complete(TURN)
  await settle()
  expect(heard).toEqual(['run:aplay'])
})

test('notifies through the terminal on Linux with no player', async ($, on) => {
  const heard = fakeHost(on, { os: 'Linux' })
  await $.turn.complete(TURN)
  await settle()
  expect(heard).toEqual(['notify:Claude finished'])
})

test('notifies through the terminal over SSH instead of playing on the server', async ($, on) => {
  const heard = fakeHost(on, { os: 'Linux', players: ['paplay'], env: { SSH_CONNECTION: '10.0.0.2 51000 10.0.0.1 22' } })
  await $.classic.Notification(PERMISSION)
  await settle()
  expect(heard).toEqual(['notify:Claude needs your input'])
})

test('chime mode plays on the machine even over SSH', { options: { soundMode: 'chime' } }, async ($, on) => {
  const heard = fakeHost(on, { env: { SSH_TTY: '/dev/pts/0' } })
  await $.turn.complete(TURN)
  await settle()
  expect(heard).toEqual(['play:sounds/classic/done.wav'])
})

test('bell mode always notifies through the terminal', { options: { soundMode: 'bell' } }, async ($, on) => {
  const heard = fakeHost(on)
  await $.turn.complete(TURN)
  await settle()
  expect(heard).toEqual(['notify:Claude finished'])
})

test('plays the chime style picked in the options', { options: { chimeStyle: 'marimba' } }, async ($, on) => {
  const heard = fakeHost(on)
  await $.turn.complete(TURN)
  await $.classic.Notification(PERMISSION)
  await settle()
  expect(heard).toEqual(['play:sounds/marimba/done.wav', 'play:sounds/marimba/input.wav'])
})

test('/chimes plays the current style, or the one named', { options: { chimeStyle: 'soft' } }, async ($, on) => {
  const heard = fakeHost(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const current = await $.command.run({ ...CHIMES, args: '' })
  expect(current.text.includes('"soft"')).toBe(true)
  const named = await $.command.run({ ...CHIMES, args: ' Arcade ' })
  expect(named.text.includes('"arcade"')).toBe(true)
  expect(heard).toEqual([
    'play:sounds/soft/done.wav',
    'play:sounds/soft/input.wav',
    'play:sounds/arcade/done.wav',
    'play:sounds/arcade/input.wav',
  ])

  const unknown = await $.command.run({ ...CHIMES, args: 'kazoo' })
  expect(unknown.text.includes('classic, soft, marimba, arcade, glass, pop')).toBe(true)
})

test('random picks any style but never the one before', async () => {
  expect(pickStyle('glass', 'glass')).toBe('glass')
  expect(pickStyle('random', undefined, () => 0)).toBe('classic')
  expect(pickStyle('random', 'classic', () => 0)).toBe('soft')
  expect(pickStyle('random', 'pop', () => 0.999)).toBe('glass')
})

test('random plays a different style each time', { options: { chimeStyle: 'random' } }, async ($, on) => {
  const heard = fakeHost(on)
  for (let i = 0; i < 6; i++) await $.turn.complete(TURN)
  await settle()

  const styles = heard.map(sound => sound.split('/')[1])
  expect(styles.length).toBe(6)
  expect(styles.every(style => (CHIME_STYLES as readonly string[]).includes(style))).toBe(true)
  expect(styles.every((style, i) => i === 0 || style !== styles[i - 1])).toBe(true)
})

test('/chimes random names the style it picked', async ($, on) => {
  const heard = fakeHost(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const result = await $.command.run({ ...CHIMES, args: 'random' })
  const style = heard[0]?.split('/')[1]
  expect(result.text.includes(`"${style}" (picked at random)`)).toBe(true)
})

test('/chimes all plays every style once, in order', async ($, on) => {
  const heard = fakeHost(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const result = await $.command.run({ ...CHIMES, args: 'all' })
  expect(heard).toEqual(CHIME_STYLES.flatMap(style => [`play:sounds/${style}/done.wav`, `play:sounds/${style}/input.wav`]))
  expect(result.text.includes('classic, soft, marimba, arcade, glass, pop')).toBe(true)
})
