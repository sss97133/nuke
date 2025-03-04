
export const TOAST_LIMIT = 3
export const TOAST_REMOVE_DELAY = 10000 // 10 seconds
export const ERROR_MESSAGE_DEBOUNCE_TIME = 5000 // 5 seconds

export const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const
