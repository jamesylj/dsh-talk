/**
 * Shared failure classification for the two host-played TTS engines.
 *
 * A failed synthesis is either an interruption (the caller's abort signal
 * ended it) or a real failure; the service uses that distinction to fall back
 * to the offline MLX engine instead of swallowing an interruption.
 *
 * @module dsh-talk/engine
 */

/** Failure classification of one synthesis attempt. */
export class EngineFailure extends Error {
  /** True when the caller's abort signal ended the attempt. */
  readonly aborted: boolean

  /**
   * @param message - sanitized failure description.
   * @param aborted - whether the caller aborted the attempt.
   */
  constructor(message: string, aborted: boolean) {
    super(message)
    this.name = 'EngineFailure'
    this.aborted = aborted
  }
}
