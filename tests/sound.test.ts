import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code/testing'

const TURN = { answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as const

// Stands in for the engine's player and records what the plugin asked to play.
function recordPlays(on: On, clockStep = 5_000): string[] {
  const played: string[] = []
  on('audio.play', (_, e) => {
    if (e.clip.asset !== undefined) played.push(e.clip.asset)
    return { value: undefined }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: {} }))
  on('classic.Notification', () => ({}))
  let now = 0
  // Each look at the clock moves it on by `clockStep`.
  on('clock.now', () => ({ value: (now += clockStep) }))
  return played
}

async function settle(): Promise<void> {
  // Plays are fired without waiting; let them land.
  await new Promise(resolve => setTimeout(resolve, 0))
}

test('chimes when the main loop finishes a turn', async ($, on) => {
  const played = recordPlays(on)
  await $.turn.complete(TURN)
  await settle()
  expect(played).toEqual(['sounds/done.wav'])
})

test('stays quiet for interrupted turns and subagents', async ($, on) => {
  const played = recordPlays(on)
  await $.turn.complete({ ...TURN, reason: 'aborted', isAborted: true })
  await $.turn.complete({ ...TURN, agentId: 'a1' })
  await settle()
  expect(played).toEqual([])
})

test('chimes when Claude asks or waits for a permission, once per moment', async ($, on) => {
  const played = recordPlays(on, 100)
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' })
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' })
  await $.classic.Notification({ message: 'Claude is waiting', notification_type: 'idle_prompt' })
  await settle()
  expect(played).toEqual(['sounds/input.wav'])
})

test('sounds can be turned off', { options: { soundOnDone: false, soundOnInput: false } }, async ($, on) => {
  const played = recordPlays(on)
  await $.turn.complete(TURN)
  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' })
  await settle()
  expect(played).toEqual([])
})
