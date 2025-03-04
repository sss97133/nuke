
import * as React from "react"
import { ToasterToast, State } from './types'
import { recentErrorMessages, dispatch, listeners, memoryState } from './toast-store'
import { genId } from './toast-utils'
import { ERROR_MESSAGE_DEBOUNCE_TIME } from './constants'

type Toast = Omit<ToasterToast, "id">

function toast({ ...props }: Toast) {
  // For error toasts, check if we've shown this recently
  if (props.variant === 'destructive' && props.description) {
    const errorMessage = String(props.description)
    
    // If this exact error was shown recently, don't show it again
    if (recentErrorMessages.has(errorMessage)) {
      return {
        id: '',
        dismiss: () => {},
        update: () => {},
      }
    }
    
    // Add this error to recent messages
    recentErrorMessages.add(errorMessage)
    
    // Remove from recent messages after debounce time
    setTimeout(() => {
      recentErrorMessages.delete(errorMessage)
    }, ERROR_MESSAGE_DEBOUNCE_TIME)
  }

  const id = genId()

  const update = (props: ToasterToast) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...props, id },
    })
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id })

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss()
      },
    },
  })

  return {
    id: id,
    dismiss,
    update,
  }
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState)

  React.useEffect(() => {
    listeners.push(setState)
    return () => {
      const index = listeners.indexOf(setState)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }, [state])

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  }
}

export { useToast, toast }
