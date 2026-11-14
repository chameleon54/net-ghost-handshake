// Browser rules for sound, kept in one place (conventions.md): a page may not play sound until the player has clicked or
// pressed a key, so the audio context starts "suspended" and must be resumed from inside that first click. The same calls
// pause and resume the sound with the game.

/** Starts (or restarts) sound. Call it from inside a click handler. Never throws: a refusal just means no sound yet. */
export function resumeAudio(context: AudioContext): void {
  if (context.state === 'running') return;
  context.resume().catch(() => {
    // Refused (no user gesture yet). The next click tries again.
  });
}

/** Freezes all sound, for when the game is paused. Sounds carry on from where they were when it resumes. */
export function suspendAudio(context: AudioContext): void {
  if (context.state !== 'running') return;
  context.suspend().catch(() => {
    // Nothing to do: the sound simply keeps playing under the pause menu.
  });
}
