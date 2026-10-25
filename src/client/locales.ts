/**
 * Client UI dictionaries for the `settings.talk` namespace. The harness
 * locale registry accepts `en`/`zh` UI codes; the English file is the source
 * of truth and the Chinese file mirrors it key-for-key.
 *
 * @module dsh-talk/client/locales
 */

export type TalkLocaleKey =
  | 'tab'
  | 'playLatest'
  | 'stop'
  | 'speaking'
  | 'nothingToRead'
  | 'modeAuto'
  | 'modeManual'
  | 'engine'
  | 'voiceId'
  | 'autoReplyEnabled'
  | 'save'
  | 'saved'
  | 'saveFailed'
  | 'reloadNote'

export const en: Record<TalkLocaleKey, string> = {
  tab: 'Talk',
  playLatest: 'Read the latest reply aloud',
  stop: 'Stop speaking',
  speaking: 'Speaking…',
  nothingToRead: 'No reply to read yet',
  modeAuto: 'Auto',
  modeManual: 'Manual',
  engine: 'Text-to-speech engine',
  voiceId: 'MiniMax voice id',
  autoReplyEnabled: 'Read replies aloud automatically',
  save: 'Save settings',
  saved: 'Settings appended to the profile patch; reload to apply.',
  saveFailed: 'Could not save settings',
  reloadNote: 'Reload the profile to apply settings.',
}

export const zh: Record<TalkLocaleKey, string> = {
  tab: '语音',
  playLatest: '朗读最近一条回复',
  stop: '停止朗读',
  speaking: '朗读中…',
  nothingToRead: '还没有可朗读的回复',
  modeAuto: '自动',
  modeManual: '手动',
  engine: '文字转语音引擎',
  voiceId: 'MiniMax 音色 ID',
  autoReplyEnabled: '自动朗读助手回复',
  save: '保存设置',
  saved: '设置已追加到 profile patch，重载后生效。',
  saveFailed: '设置保存失败',
  reloadNote: '请重载 profile 以应用设置。',
}
