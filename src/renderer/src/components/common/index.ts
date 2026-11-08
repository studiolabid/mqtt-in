/**
 * App-level reusable components (prop-driven: props in, events / v-model out).
 * They never import stores, services, composables or features.
 *
 * `CodeEditor`, `TimeSeriesChart` and `PayloadDiff` are async components (`./async`): their
 * libraries (CodeMirror, uPlot, diff) load on first use, not at startup (CT-20). Import them
 * from here, never from their `.vue` files.
 */
export { CodeEditor, PayloadDiff, TimeSeriesChart } from './async'
export { default as AppLogo } from './AppLogo.vue'
export { default as ColorSwatchPicker } from './ColorSwatchPicker.vue'
export { default as ConnectionAvatar } from './ConnectionAvatar.vue'
export { default as CopyButton } from './CopyButton.vue'
export { default as EmptyState } from './EmptyState.vue'
export { default as HighlightText } from './HighlightText.vue'
export { default as HintTooltip } from './HintTooltip.vue'
export { default as IconButton } from './IconButton.vue'
export { default as JsonInline } from './JsonInline.vue'
export { default as KbdShortcut } from './KbdShortcut.vue'
export { default as KeyValueEditor } from './KeyValueEditor.vue'
export { default as PanelHeader } from './PanelHeader.vue'
export { default as PayloadView } from './PayloadView.vue'
export { default as PoweredBy } from './PoweredBy.vue'
export { default as QosBadge } from './QosBadge.vue'
export { default as QosSelect } from './QosSelect.vue'
export { default as RelativeTime } from './RelativeTime.vue'
export { default as SearchInput } from './SearchInput.vue'
export { default as Sparkline } from './Sparkline.vue'
export { default as StatusDot } from './StatusDot.vue'
export { default as TopicLabel } from './TopicLabel.vue'

// Small display helpers shared with the components above.
export { copyText } from './lib/clipboard'
export { colorName, normalizeHex, sameColor } from './lib/color'
export type { CodeEditorLanguage } from './lib/editor/extensions'
export { initials } from './lib/initials'
export { QOS_LEVELS, qosLevel, toQos, type QosLevel } from './lib/qos'
export { formatShortcut, formatShortcutKey, isMacPlatform } from './lib/shortcut'
export {
  CONNECTION_STATUS_LABELS,
  connectionStatusLabel,
  isTransitionalStatus,
  statusTone,
  type StatusTone
} from './lib/status'
