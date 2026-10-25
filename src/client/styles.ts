/**
 * Scoped inline styles for the talk client components. Standalone bundles
 * cannot use the in-repo CSS-module pipeline, so every rule lives here and is
 * installed (and removed) through one document-level `<style>` element.
 *
 * @module dsh-talk/client/styles
 */

/** One scoped stylesheet installation; returns its disposer. */
export function installTalkStyles(): () => void {
  const style = document.createElement('style')
  style.dataset['dshTalkStyles'] = '1'
  style.textContent = `
    [data-dsh-talk-voice] {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 28px;
      padding: 4px 8px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      cursor: pointer;
      font: inherit;
      color: inherit;
      line-height: 1;
    }
    [data-dsh-talk-voice]:hover {
      background: rgba(127, 127, 127, 0.12);
    }
    [data-dsh-talk-voice][data-speaking='true'] {
      border-color: #d33;
      color: #d33;
    }
    [data-dsh-talk-voice][data-disabled='true'] {
      opacity: 0.45;
      cursor: default;
    }
    [data-dsh-talk-mode] {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 40px;
      padding: 3px 8px;
      border: 1px solid rgba(127, 127, 127, 0.35);
      border-radius: 999px;
      background: transparent;
      cursor: pointer;
      font: inherit;
      font-size: 0.75em;
      line-height: 1.2;
      color: inherit;
      opacity: 0.9;
    }
    [data-dsh-talk-mode]:hover {
      background: rgba(127, 127, 127, 0.12);
    }
    [data-dsh-talk-mode][data-mode='auto'] {
      border-color: #2e8b57;
      color: #2e8b57;
    }
    [data-dsh-talk-mode][data-mode='manual'] {
      border-color: #b26a00;
      color: #b26a00;
    }
    [data-dsh-talk-mode]:disabled {
      opacity: 0.45;
      cursor: default;
    }
    [data-dsh-talk-settings] {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 560px;
    }
    [data-dsh-talk-settings] label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 0.85em;
    }
    [data-dsh-talk-settings] select,
    [data-dsh-talk-settings] input[type='text'] {
      padding: 4px 6px;
      font: inherit;
    }
    [data-dsh-talk-settings] .row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.9em;
    }
    [data-dsh-talk-settings] .note {
      font-size: 0.8em;
      opacity: 0.75;
    }
    [data-dsh-talk-settings] button {
      align-self: flex-start;
      padding: 4px 12px;
      font: inherit;
    }
  `
  document.head.appendChild(style)
  return () => {
    style.remove()
  }
}
