import { State, Action } from './types'
import { reducer } from './reducer'

export const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

// Keep track of recent error messages to prevent duplicates
export const recentErrorMessages = new Set<string>()

export const listeners: Array<(state: State) => void> = []

export let memoryState: State = { toasts: [] }

export function dispatch(action: Action) {
  memoryState = reducer(memoryState, action)
  listeners.forEach((listener) => {
    listener(memoryState)
  })
}
