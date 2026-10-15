export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Segment = { text: string; color?: string; backgroundColor?: string; dim?: boolean; bold?: boolean }

export type Snapshot = {
  model: string
  effort?: string
  ultracode: 'on' | 'turn' | 'off'
  contextTokens?: number
  contextWindow: number
  contextPercent?: number
  limits: Limit[]
  startedAt: number
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band-for-claude': { snapshot: Snapshot | null; stepEffort: string | null; ultracodeTurn: boolean }
  }
}
