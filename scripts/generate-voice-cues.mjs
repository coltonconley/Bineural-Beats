/**
 * Generates neural TTS voice cue MP3 files for all guided meditation presets.
 *
 * Uses Microsoft's free neural TTS voices via the `node-edge-tts` npm package.
 * Generates one MP3 per spoken voice cue (skipping chimeOnly cues).
 * Output: public/voice/{trackId}/{000}.mp3 + public/voice/manifest.json
 *
 * Run: npm run generate:voice
 * Requires: npm install --save-dev node-edge-tts tsx
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { EdgeTTS } from 'node-edge-tts'

// tsx allows importing TypeScript source directly
import { guidedPresets } from '../src/guidedPresets.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = resolve(__dirname, '..', 'public')
const VOICE_DIR = resolve(PUBLIC_DIR, 'voice')

// TTS settings
const VOICE = 'en-US-AriaNeural'
const RATE = '-15%'   // Calm, slightly slower pace
const PITCH = '-5Hz'  // Slightly lower for soothing tone

async function synthesize(text, outputPath) {
  const tts = new EdgeTTS({
    voice: VOICE,
    lang: 'en-US',
    rate: RATE,
    pitch: PITCH,
    timeout: 30000,
  })
  await tts.ttsPromise(text, outputPath)
}

function hashText(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

function padIndex(i, width = 3) {
  return String(i).padStart(width, '0')
}

async function main() {
  console.log('Generating neural voice cues...\n')
  console.log(`Voice: ${VOICE}`)
  console.log(`Rate:  ${RATE}`)
  console.log(`Pitch: ${PITCH}\n`)

  // Ensure output directory exists
  mkdirSync(VOICE_DIR, { recursive: true })

  const manifest = {}
  let totalGenerated = 0
  let totalSkipped = 0

  for (const preset of guidedPresets) {
    const script = preset.guidanceScript
    if (!script || !script.voiceCues || script.voiceCues.length === 0) continue

    const trackId = preset.id
    const trackDir = resolve(VOICE_DIR, trackId)
    mkdirSync(trackDir, { recursive: true })

    // Sidecar file stores text hashes so we can skip unchanged cues
    const sidecarPath = resolve(trackDir, '.hashes.json')
    let existingHashes = {}
    if (existsSync(sidecarPath)) {
      try {
        existingHashes = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
      } catch { /* regenerate all */ }
    }

    // Filter to spoken cues only (skip chimeOnly)
    const spokenCues = script.voiceCues.filter(c => !c.chimeOnly && c.text)

    console.log(`\n${preset.name} (${trackId}): ${spokenCues.length} spoken cues`)

    const filenames = []
    const newHashes = {}

    for (let i = 0; i < spokenCues.length; i++) {
      const cue = spokenCues[i]
      const filename = `${padIndex(i)}.mp3`
      const outputPath = resolve(trackDir, filename)
      const textHash = hashText(cue.text)

      filenames.push(filename)
      newHashes[filename] = textHash

      // Skip if file exists and text hasn't changed
      if (existsSync(outputPath) && existingHashes[filename] === textHash) {
        totalSkipped++
        continue
      }

      // Generate audio
      const preview = cue.text.length > 60 ? cue.text.slice(0, 57) + '...' : cue.text
      process.stdout.write(`  [${padIndex(i)}] ${preview} `)

      try {
        await synthesize(cue.text, outputPath)
        totalGenerated++
        console.log('OK')
      } catch (err) {
        console.log(`FAILED: ${err.message}`)
      }
    }

    manifest[trackId] = filenames

    // Write sidecar hashes
    writeFileSync(sidecarPath, JSON.stringify(newHashes, null, 2))
  }

  // Write manifest
  const manifestPath = resolve(VOICE_DIR, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  console.log(`\n--- Summary ---`)
  console.log(`Generated: ${totalGenerated} files`)
  console.log(`Skipped (unchanged): ${totalSkipped} files`)
  console.log(`Manifest: ${manifestPath}`)
  console.log('\nDone!')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
