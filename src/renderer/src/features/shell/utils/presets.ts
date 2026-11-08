/**
 * Display helpers for broker presets (welcome cards, command palette).
 */
import type { Component } from 'vue'
import { GlobeIcon, LaptopIcon, ShieldCheckIcon } from '@lucide/vue'
import { isTlsProtocol } from '@shared/defaults'
import type { BrokerPreset } from '@/utils/presets'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Laptop for local brokers, shield for TLS transports, globe for public brokers. */
export function presetIcon(preset: BrokerPreset): Component {
  const host = preset.profile.host?.trim().toLowerCase() ?? ''
  if (LOCAL_HOSTS.has(host)) return LaptopIcon
  const protocol = preset.profile.protocol
  if (protocol && isTlsProtocol(protocol)) return ShieldCheckIcon
  return GlobeIcon
}
