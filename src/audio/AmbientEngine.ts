import type { AmbientSoundType } from '../types'
import { ambientSounds } from './ambientSounds'

const MAX_CACHED_BUFFERS = 3

export class AmbientEngine {
  private source: AudioBufferSourceNode | null = null
  private gainNode: GainNode | null = null
  private ctx: AudioContext | null = null
  private destination: AudioNode | null = null
  currentSound: AmbientSoundType = 'none'
  private bufferCache = new Map<string, AudioBuffer>()
  private cacheOrder: string[] = []

  get isRunning(): boolean {
    return this.source !== null
  }

  async start(
    ctx: AudioContext,
    destination: AudioNode,
    sound: AmbientSoundType,
    volume: number,
  ): Promise<void> {
    if (sound === 'none') return

    this.ctx = ctx
    this.destination = destination
    this.currentSound = sound

    const buffer = await this.fetchBuffer(ctx, sound)
    if (!buffer) return

    this.source = ctx.createBufferSource()
    this.source.buffer = buffer
    this.source.loop = true

    this.gainNode = ctx.createGain()
    this.gainNode.gain.value = volume

    this.source.connect(this.gainNode)
    this.gainNode.connect(destination)
    this.source.start()
  }

  setVolume(volume: number): void {
    if (!this.gainNode || !this.ctx) return
    const now = this.ctx.currentTime
    this.gainNode.gain.cancelScheduledValues(now)
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(volume, now + 0.05)
  }

  fadeVolume(targetVolume: number, durationSec: number): void {
    if (!this.gainNode || !this.ctx) return
    const now = this.ctx.currentTime
    this.gainNode.gain.cancelScheduledValues(now)
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(targetVolume, now + durationSec)
  }

  stop(): void {
    try {
      this.source?.stop()
      this.source?.disconnect()
    } catch { /* already stopped */ }
    try {
      this.gainNode?.disconnect()
    } catch { /* */ }
    this.source = null
    this.gainNode = null
    this.ctx = null
    this.destination = null
    this.currentSound = 'none'
  }

  /** Crossfade to a different ambient sound mid-session */
  async switchSound(sound: AmbientSoundType, volume: number): Promise<void> {
    if (!this.ctx || !this.destination) return

    if (sound === 'none') {
      this.fadeVolume(0, 1)
      setTimeout(() => this.stop(), 1100)
      return
    }

    const ctx = this.ctx
    const destination = this.destination

    // Fade out current sound
    if (this.isRunning) {
      this.fadeVolume(0, 1)
      const oldSource = this.source
      const oldGain = this.gainNode
      setTimeout(() => {
        try {
          oldSource?.stop()
          oldSource?.disconnect()
        } catch { /* */ }
        try {
          oldGain?.disconnect()
        } catch { /* */ }
      }, 1100)
    }

    // Reset refs before starting new sound
    this.source = null
    this.gainNode = null

    // Small delay for crossfade overlap
    await new Promise((r) => setTimeout(r, 200))

    // Ensure context is still valid (session might have stopped)
    if ((ctx.state as string) === 'closed') return

    this.ctx = ctx
    this.destination = destination
    this.currentSound = sound

    const buffer = await this.fetchBuffer(ctx, sound)
    if (!buffer || (ctx.state as string) === 'closed') return

    this.source = ctx.createBufferSource()
    this.source.buffer = buffer
    this.source.loop = true

    this.gainNode = ctx.createGain()
    this.gainNode.gain.value = 0

    this.source.connect(this.gainNode)
    this.gainNode.connect(destination)
    this.source.start()

    // Fade in new sound
    this.fadeVolume(volume, 1)
  }

  private async fetchBuffer(
    ctx: AudioContext,
    sound: AmbientSoundType,
  ): Promise<AudioBuffer | null> {
    const meta = ambientSounds.find((s) => s.id === sound)
    if (!meta) return null

    const cacheKey = meta.filename

    // Return cached buffer if available
    if (this.bufferCache.has(cacheKey)) {
      return this.bufferCache.get(cacheKey)!
    }

    try {
      const response = await fetch(`/ambient/${meta.filename}`)
      if (!response.ok) {
        console.warn(`Failed to fetch ambient sound: ${meta.filename}`)
        return null
      }
      const arrayBuffer = await response.arrayBuffer()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)

      // Cache with eviction
      this.bufferCache.set(cacheKey, audioBuffer)
      this.cacheOrder.push(cacheKey)
      while (this.cacheOrder.length > MAX_CACHED_BUFFERS) {
        const evicted = this.cacheOrder.shift()!
        this.bufferCache.delete(evicted)
      }

      return audioBuffer
    } catch (err) {
      console.warn('Error loading ambient sound:', err)
      return null
    }
  }
}
