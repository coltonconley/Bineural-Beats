import type { VoiceCue } from '../types'

interface VoiceManifest {
  [trackId: string]: string[]
}

export class VoiceCueEngine {
  private cues: VoiceCue[] = []
  private nextCueIndex = 0
  private enabled = true
  private volume = 0.71
  private trackId = ''

  // Web Audio graph
  private ctx: AudioContext | null = null
  private gainNode: GainNode | null = null
  private activeSource: AudioBufferSourceNode | null = null

  // Audio buffer cache (index -> AudioBuffer)
  private bufferCache = new Map<number, AudioBuffer>()
  private fetchPromises = new Map<number, Promise<AudioBuffer | null>>()
  private manifest: string[] = []
  private manifestLoaded = false

  // Fallback flag
  private useFallback = false

  init(
    ctx: AudioContext,
    destination: AudioNode,
    trackId: string,
    cues: VoiceCue[],
    options?: {
      volume?: number
      enabled?: boolean
    },
  ): void {
    this.ctx = ctx
    this.trackId = trackId
    this.cues = [...cues].sort((a, b) => a.time - b.time)
    this.nextCueIndex = 0
    this.volume = options?.volume ?? 0.71
    this.enabled = options?.enabled ?? true
    this.bufferCache = new Map()
    this.fetchPromises = new Map()
    this.manifest = []
    this.manifestLoaded = false
    this.useFallback = false

    // Create gain node for volume control
    this.gainNode = ctx.createGain()
    this.gainNode.gain.value = this.volume
    this.gainNode.connect(destination)

    // Load manifest and start prefetching
    this.loadManifest()
  }

  tick(elapsed: number): { shouldChime: boolean; cueText?: string } {
    if (this.nextCueIndex >= this.cues.length) {
      return { shouldChime: false }
    }

    let shouldChime = false
    let cueText: string | undefined

    while (this.nextCueIndex < this.cues.length && this.cues[this.nextCueIndex].time <= elapsed) {
      const cue = this.cues[this.nextCueIndex]
      const cueIndex = this.nextCueIndex
      this.nextCueIndex++

      if (cue.chime || cue.chimeOnly) {
        shouldChime = true
      }

      if (!cue.chimeOnly && cue.text) {
        cueText = cue.text
        if (this.enabled) {
          this.playAudio(cueIndex)
        }
      }
    }

    // Prefetch upcoming cues
    if (this.enabled && this.manifestLoaded) {
      this.prefetchAhead(this.nextCueIndex, 3)
    }

    return { shouldChime, cueText }
  }

  /** Get the most recent cue text at or before the given time (for seek/display) */
  getTextAtTime(time: number): string | undefined {
    let text: string | undefined
    for (const cue of this.cues) {
      if (cue.time > time) break
      if (!cue.chimeOnly && cue.text) {
        text = cue.text
      }
    }
    return text
  }

  pause(): void {
    this.stopActiveSource()
  }

  resume(): void {
    // Audio cues are short; we don't resume mid-cue
  }

  seek(time: number): void {
    this.stopActiveSource()

    // Binary search for the next cue at or after `time`
    let lo = 0
    let hi = this.cues.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.cues[mid].time < time) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    this.nextCueIndex = lo

    // Prefetch around new position
    if (this.manifestLoaded) {
      this.prefetchAhead(lo, 3)
    }
  }

  stop(): void {
    this.stopActiveSource()

    if (this.gainNode) {
      try {
        this.gainNode.disconnect()
      } catch { /* already disconnected */ }
      this.gainNode = null
    }

    this.cues = []
    this.nextCueIndex = 0
    this.bufferCache = new Map()
    this.fetchPromises = new Map()
    this.manifest = []
    this.manifestLoaded = false
    this.ctx = null
  }

  // ── Private helpers ─────────────────────────────────

  private async loadManifest(): Promise<void> {
    try {
      const base = import.meta.env.BASE_URL
      const res = await fetch(`${base}voice/manifest.json`)
      if (!res.ok) {
        console.warn('Voice manifest not found, falling back to Web Speech API')
        this.useFallback = true
        return
      }
      const data: VoiceManifest = await res.json()
      this.manifest = data[this.trackId] ?? []
      this.manifestLoaded = true

      if (this.manifest.length === 0) {
        console.warn(`No voice files for track "${this.trackId}", falling back to Web Speech API`)
        this.useFallback = true
        return
      }

      // Eagerly prefetch first 5 spoken cues
      this.prefetchAhead(0, 5)
    } catch {
      console.warn('Failed to load voice manifest, falling back to Web Speech API')
      this.useFallback = true
    }
  }

  /** Maps a cue index to the corresponding spoken-cue index (skipping chimeOnly cues) */
  private getSpokenIndex(cueIndex: number): number {
    let spokenIdx = 0
    for (let i = 0; i < cueIndex && i < this.cues.length; i++) {
      if (!this.cues[i].chimeOnly) {
        spokenIdx++
      }
    }
    return spokenIdx
  }

  private prefetchAhead(fromCueIndex: number, count: number): void {
    let prefetched = 0
    for (let i = fromCueIndex; i < this.cues.length && prefetched < count; i++) {
      if (!this.cues[i].chimeOnly && this.cues[i].text) {
        this.fetchBuffer(i)
        prefetched++
      }
    }
  }

  private async fetchBuffer(cueIndex: number): Promise<AudioBuffer | null> {
    if (this.bufferCache.has(cueIndex)) {
      return this.bufferCache.get(cueIndex)!
    }

    if (this.fetchPromises.has(cueIndex)) {
      return this.fetchPromises.get(cueIndex)!
    }

    const spokenIndex = this.getSpokenIndex(cueIndex)
    if (spokenIndex >= this.manifest.length) return null

    const filename = this.manifest[spokenIndex]
    const base = import.meta.env.BASE_URL
    const url = `${base}voice/${this.trackId}/${filename}`

    const promise = (async (): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(url)
        if (!res.ok) return null
        const arrayBuf = await res.arrayBuffer()
        if (!this.ctx) return null
        const audioBuffer = await this.ctx.decodeAudioData(arrayBuf)
        this.bufferCache.set(cueIndex, audioBuffer)
        return audioBuffer
      } catch {
        return null
      } finally {
        this.fetchPromises.delete(cueIndex)
      }
    })()

    this.fetchPromises.set(cueIndex, promise)
    return promise
  }

  private async playAudio(cueIndex: number): Promise<void> {
    if (!this.ctx || !this.gainNode) return

    // Stop any currently playing source
    this.stopActiveSource()

    if (this.useFallback || !this.manifestLoaded) {
      this.speakFallback(this.cues[cueIndex]?.text)
      return
    }

    const buffer = await this.fetchBuffer(cueIndex)
    if (!buffer) {
      // Fetch failed — try Web Speech API fallback for this cue
      this.speakFallback(this.cues[cueIndex]?.text)
      return
    }

    if (!this.ctx || !this.gainNode) return

    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.gainNode)
    source.onended = () => {
      if (this.activeSource === source) {
        this.activeSource = null
      }
    }
    this.activeSource = source
    source.start()
  }

  private stopActiveSource(): void {
    if (this.activeSource) {
      try {
        this.activeSource.stop()
      } catch { /* already stopped */ }
      this.activeSource = null
    }
  }

  /** Fallback: use Web Speech API if pre-generated audio is unavailable */
  private speakFallback(text?: string): void {
    if (!text || typeof speechSynthesis === 'undefined') return
    try {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 0.85
      utterance.pitch = 0.92
      utterance.volume = this.volume
      utterance.lang = 'en-US'
      speechSynthesis.speak(utterance)
    } catch { /* silent fail */ }
  }
}
