import { useCallback, useMemo } from 'react'

export function useHaptics() {
  const isSupported = useMemo(
    () => typeof navigator !== 'undefined' && 'vibrate' in navigator,
    [],
  )

  const pulse = useCallback(
    (ms: number) => {
      if (!isSupported) return
      try {
        navigator.vibrate(ms)
      } catch { /* silent */ }
    },
    [isSupported],
  )

  const pattern = useCallback(
    (durations: number[]) => {
      if (!isSupported) return
      try {
        navigator.vibrate(durations)
      } catch { /* silent */ }
    },
    [isSupported],
  )

  return { isSupported, pulse, pattern }
}
