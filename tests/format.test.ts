import { expect, test } from 'claude-code/testing'

import { bar, formatSpan, formatTokens, levelColor, lineSegments } from '../hooks/register'

test('formats token counts', async () => {
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(45_300)).toBe('45k')
  expect(formatTokens(1_000_000)).toBe('1.0M')
})

test('formats spans', async () => {
  expect(formatSpan(5 * 60_000)).toBe('5m')
  expect(formatSpan((2 * 60 + 7) * 60_000)).toBe('2h07m')
  expect(formatSpan((3 * 24 + 4) * 3_600_000)).toBe('3d4h')
})

test('colors by how close to the limit', async () => {
  expect(levelColor(20)).toBe('success')
  expect(levelColor(70)).toBe('warning')
  expect(levelColor(90)).toBe('error')
})

test('draws a bar of the given width, clamped past 100%', async () => {
  expect(bar(25, 8, '█', '░').map(s => s.text)).toEqual(['██', '░░░░░░'])
  expect(bar(130, 4, '█', '░').map(s => s.text).join('')).toBe('████')
})

test('draws the whole line without a cost', async () => {
  const now = Date.parse('2026-10-15T12:00:00Z')
  const text = lineSegments(
    {
      model: 'claude-opus-5-5',
      effort: 'high',
      ultracode: 'off',
      contextTokens: 45_300,
      contextWindow: 200_000,
      contextPercent: 23,
      limits: [
        { kind: 'five_hour', percentUsed: 41.5, resetsAt: '2026-10-15T14:13:00Z' },
        { kind: 'seven_day', percentUsed: 12, resetsAt: '2026-10-18T16:00:00Z' },
      ],
      startedAt: now - 25 * 60_000,
      now,
    },
    140,
  )
    .map(s => s.text)
    .join('')
  expect(text).toBe(
    '◆ opus-5-5 ⚡high ultracode off   ctx █████░░░░░░░░░░░░░░░ 23% 45k/200k   ' +
      '5h ▰▰▰▰▱▱▱▱▱▱ 42% ↻ 2h13m   7d ▰▱▱▱▱▱▱▱▱▱ 12% ↻ 3d4h   ⏱ 25m',
  )
  expect(text.includes('$')).toBe(false)
})

test('highlights ultracode when it is on', async () => {
  const base = {
    model: 'claude-opus-5-5',
    contextWindow: 200_000,
    limits: [],
    startedAt: 0,
    now: 0,
  }
  const on = lineSegments({ ...base, ultracode: 'on' }, 140)
  expect(on.find(s => s.text === ' ULTRACODE ')?.backgroundColor).toBe('planMode')
  const turn = lineSegments({ ...base, ultracode: 'turn' }, 140)
  expect(turn.some(s => s.text.includes('this prompt'))).toBe(true)
  expect(lineSegments(base as never, 140).some(s => s.text.includes('⚡'))).toBe(false)
})
