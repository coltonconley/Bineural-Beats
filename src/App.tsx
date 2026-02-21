import { useState, useCallback, useRef, useEffect } from 'react'
import type { SessionPreset, SessionOptions, MoodRating } from './types'
import { useAudioEngine } from './hooks/useAudioEngine'
import { useWakeLock } from './hooks/useWakeLock'
import { useSessionHistory } from './hooks/useSessionHistory'
import { Onboarding } from './components/Onboarding'
import { PresetList } from './components/PresetList'
import { SessionSetup } from './components/SessionSetup'
import { Player } from './components/Player'

type View = 'discover' | 'setup' | 'countdown' | 'session'

function App() {
  const [view, setView] = useState<View>('discover')
  const [selectedPreset, setSelectedPreset] = useState<SessionPreset | null>(null)
  const [countdownNum, setCountdownNum] = useState(3)
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      return !localStorage.getItem('onboarding_complete')
    } catch {
      return true
    }
  })

  const audio = useAudioEngine()
  const wakeLock = useWakeLock()
  const history = useSessionHistory()
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval>>(null)
  const [lastCompletedSessionId, setLastCompletedSessionId] = useState<string | null>(null)

  // Clean up countdown interval on unmount
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current)
      }
    }
  }, [])

  const handlePresetSelect = useCallback((preset: SessionPreset) => {
    setSelectedPreset(preset)
    setView('setup')
  }, [])

  const handleSetupClose = useCallback(() => {
    setSelectedPreset(null)
    setView('discover')
  }, [])

  const handleBeginSession = useCallback(
    async (preset: SessionPreset, options: SessionOptions) => {
      setView('countdown')
      setCountdownNum(3)

      // 3-2-1 countdown
      await new Promise<void>((resolve) => {
        let count = 3
        const interval = setInterval(() => {
          count--
          if (count <= 0) {
            clearInterval(interval)
            countdownIntervalRef.current = null
            resolve()
          } else {
            setCountdownNum(count)
          }
        }, 900)
        countdownIntervalRef.current = interval
      })

      try {
        await audio.startSession(preset, {
          isochronicEnabled: options.isochronicEnabled,
          breathingGuideEnabled: options.breathingGuideEnabled,
          volume: options.volume,
        })
        await wakeLock.request()
        setView('session')
      } catch (err) {
        console.error('Failed to start session:', err)
        setView('discover')
      }
    },
    [audio, wakeLock],
  )

  const handleStopSession = useCallback(() => {
    audio.stop()
    wakeLock.release()
    setSelectedPreset(null)
    setView('discover')
  }, [audio, wakeLock])

  const handleSessionComplete = useCallback(() => {
    wakeLock.release()
    if (audio.state.activePreset) {
      const session = history.addSession({
        presetId: audio.state.activePreset.id,
        presetName: audio.state.activePreset.name,
        category: audio.state.activePreset.category,
        durationSeconds: Math.round(audio.state.elapsed),
        completedAt: new Date().toISOString(),
        completedFull: true,
      })
      setLastCompletedSessionId(session.id)
    }
  }, [wakeLock, audio.state, history])

  const handleMoodSelect = useCallback(
    (mood: MoodRating) => {
      if (lastCompletedSessionId) {
        history.updateSessionMood(lastCompletedSessionId, mood)
      }
    },
    [lastCompletedSessionId, history],
  )

  const handleOnboardingComplete = useCallback(() => {
    try {
      localStorage.setItem('onboarding_complete', 'true')
    } catch { /* */ }
    setShowOnboarding(false)
  }, [])

  if (showOnboarding) {
    return <Onboarding onComplete={handleOnboardingComplete} />
  }

  if (view === 'countdown') {
    return (
      <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'var(--color-bg-deep)' }}>
        <span key={countdownNum} className="animate-countdown text-8xl font-light text-white/80">
          {countdownNum}
        </span>
      </div>
    )
  }

  if (view === 'session' && audio.state.activePreset) {
    return (
      <Player
        state={audio.state}
        onPause={audio.pause}
        onResume={audio.resume}
        onStop={handleStopSession}
        onVolumeChange={audio.setVolume}
        onToggleIsochronic={audio.toggleIsochronic}
        onToggleBreathingGuide={audio.toggleBreathingGuide}
        onComplete={handleSessionComplete}
        onMoodSelect={handleMoodSelect}
        stats={history.stats}
        hapticEnabled={history.preferences.hapticEnabled}
        getAnalyser={audio.getAnalyser}
      />
    )
  }

  return (
    <div className="min-h-dvh" style={{ background: 'var(--color-bg-deep)' }}>
      <PresetList
        onSelect={handlePresetSelect}
        stats={history.stats}
        favorites={history.preferences.favorites}
        onToggleFavorite={history.toggleFavorite}
      />

      {view === 'setup' && selectedPreset && (
        <SessionSetup
          preset={selectedPreset}
          onClose={handleSetupClose}
          onBegin={handleBeginSession}
        />
      )}
    </div>
  )
}

export default App
