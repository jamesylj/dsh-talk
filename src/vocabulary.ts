/**
 * Pure shared vocabulary: the speech payload types and the projection wire
 * schema. This module imports nothing from host-side package roots, so both
 * the host program (which merges `SessionEventMap`) and the client program
 * (which must not hold host `Context` merges) can import it safely. The
 * session-log merge lives in `./speech.ts`; the projection-unit merge lives
 * in `./projection.ts`.
 *
 * @module dsh-talk/vocabulary
 */

import { z } from 'zod'

/** What triggered one spoken utterance. `auto-reply` reads the assistant's final reply of a completed turn. */
export type SpeechReason = 'speak-tool' | 'turn-end' | 'approval' | 'error' | 'auto-reply'

/** Engines that can synthesize speech in this plugin. */
export type SpeechTtsEngine = 'browser' | 'edge-tts' | 'macos' | 'piper'

/** Every reason that can ride a speech payload (shared by the projection and the wire schemas). */
export const SPEECH_REASON_SCHEMA = z.union([
  z.literal('speak-tool'),
  z.literal('turn-end'),
  z.literal('approval'),
  z.literal('error'),
  z.literal('auto-reply'),
])

/** Every engine that can ride a speech payload. */
export const SPEECH_TTS_ENGINE_SCHEMA = z.union([z.literal('browser'), z.literal('edge-tts'), z.literal('macos'), z.literal('piper')])

/** Payload of one `dsh-talk/speech` session event. */
export interface DshTalkSpeechEvent {
  /** Always `tts` — a host-synthesized (or browser-delegated) utterance. */
  kind: 'tts'
  /** Stable id the client fetches audio with through `talk/audio`. */
  utteranceId: string
  /** Engine that produced (or will produce) the audio. */
  engine: SpeechTtsEngine
  /** The spoken text, sanitized and capped. */
  text: string
  /** Synthesized audio size in bytes; 0 for the browser engine (client-side synthesis). */
  audioBytes: number
  /** What triggered the utterance. */
  reason: SpeechReason
  /** Sanitized failure note when synthesis failed; absent on success. */
  error?: string | undefined
  /** True when the user interrupted the utterance before it finished. */
  interrupted?: boolean | undefined
  /** Browser voice name in force for this utterance (browser engine only); absent = platform default. */
  voice?: string | undefined
  /** SpeechSynthesis rate for browser playback; absent for local engines. */
  rate?: number | undefined
  /** SpeechSynthesis pitch for browser playback; absent for local engines. */
  pitch?: number | undefined
}

/** The wire payload of the `talk:speech` projection. */
export interface TalkSpeechProjection {
  /** Seq of the `dsh-talk/speech` event this value reflects. */
  seq: number
  /** Stable utterance id for `talk/audio`. */
  utteranceId: string
  /** Engine that produced the audio (browser = client-side synthesis). */
  engine: SpeechTtsEngine
  /** The spoken text, sanitized and capped. */
  text: string
  /** Synthesized audio size in bytes; 0 for the browser engine. */
  audioBytes: number
  /** What triggered the utterance. */
  reason: SpeechReason
  /** Session-log timestamp (epoch ms) of the event behind this frame; absent in pre-0.3.31 cached values. */
  at?: number | undefined
  /** Sanitized failure note; absent on success. */
  error?: string | undefined
  /** True when the utterance was interrupted. */
  interrupted?: boolean | undefined
  /** Browser voice name in force for this utterance (browser engine only); absent = platform default. */
  voice?: string | undefined
  /** SpeechSynthesis rate for browser playback; absent for local engines. */
  rate?: number | undefined
  /** SpeechSynthesis pitch for browser playback; absent for local engines. */
  pitch?: number | undefined
}

/**
 * Strict schema for one speech payload. Two sources feed it: the plain
 * `dsh-talk/speech` event (typed in-repo) and a restored `plugin:dsh-talk/speech`
 * record whose `data` is arbitrary JSON written by an earlier build of this
 * plugin — the record's owner validates it before use. Fields are checked
 * rather than trusted so a corrupt record can never reach the projection wire.
 */
export const talkSpeechEventPayloadSchema = z.object({
  kind: z.literal('tts'),
  utteranceId: z.string(),
  engine: SPEECH_TTS_ENGINE_SCHEMA,
  text: z.string(),
  audioBytes: z.number().int(),
  reason: SPEECH_REASON_SCHEMA,
  at: z.number().int().optional(),
  error: z.string().optional(),
  interrupted: z.boolean().optional(),
  voice: z.string().optional(),
  rate: z.number().min(0.1).max(10).optional(),
  pitch: z.number().min(0).max(2).optional(),
})

/** Strict schema validating the projection value before it leaves the host. */
export const talkSpeechProjectionSchema = z.object({
  seq: z.number().int(),
  utteranceId: z.string(),
  engine: SPEECH_TTS_ENGINE_SCHEMA,
  text: z.string(),
  audioBytes: z.number().int(),
  reason: SPEECH_REASON_SCHEMA,
  at: z.number().int().optional(),
  error: z.string().optional(),
  interrupted: z.boolean().optional(),
  voice: z.string().optional(),
  rate: z.number().min(0.1).max(10).optional(),
  pitch: z.number().min(0).max(2).optional(),
})
