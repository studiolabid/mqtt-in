/**
 * Rows of the workspace's "Broker" popover (FP-5, PRODUCT-09): what the broker announced in its
 * CONNACK (`useSessionsStore().brokerInfo`, CT-16). MQTT 5 properties the broker left out read
 * "not announced (default …)" with the default the protocol defines for them (MQTT 5 §3.2.2.3).
 * MQTT 3.1 / 3.1.1 brokers announce nothing but the session state. Pure.
 */
import type { BrokerInfo, MqttProtocolVersion } from '@shared/models'
import { protocolLabel } from '@shared/defaults'
import { formatBytes, formatNumber } from '@/utils/format'

export interface BrokerRow {
  label: string
  value: string
  /** False when the broker did not announce it (the protocol default applies). */
  announced: boolean
}

export interface BrokerView {
  /** A sentence instead of (or above) the rows. */
  message?: string
  rows: BrokerRow[]
}

export interface BrokerViewInput {
  /** The session is connected. */
  connected: boolean
  /** The broker's CONNACK facts (undefined until the main process reported them). */
  info: BrokerInfo | undefined
  /** The profile's protocol version (used while no CONNACK facts are known). */
  protocolVersion: MqttProtocolVersion
  /** The keep alive the client asked for, in seconds (the default of Server Keep Alive). */
  keepalive: number
}

const yesNo = (value: boolean): string => (value ? 'Yes' : 'No')

function row<T>(
  label: string,
  value: T | undefined,
  format: (value: T) => string,
  fallback: string
): BrokerRow {
  return value === undefined
    ? { label, value: `not announced (default ${fallback})`, announced: false }
    : { label, value: format(value), announced: true }
}

function sessionRow(info: BrokerInfo): BrokerRow {
  return { label: 'Session present', value: yesNo(info.sessionPresent), announced: true }
}

/** The popover content for a connection. */
export function brokerView(input: BrokerViewInput): BrokerView {
  if (!input.connected) return { message: 'Connect to see what the broker supports', rows: [] }
  const info = input.info
  const version = info?.protocolVersion ?? input.protocolVersion
  if (version !== 5) {
    return {
      message: `${protocolLabel(version)} brokers do not announce their limits`,
      rows: info ? [sessionRow(info)] : []
    }
  }
  if (!info) return { message: 'The broker details of this session are not known', rows: [] }
  const keepalive = input.keepalive > 0 ? `yours, ${formatNumber(input.keepalive)} s` : 'off'
  return {
    rows: [
      sessionRow(info),
      row('Assigned client ID', info.assignedClientId, String, 'yours'),
      row('Max QoS', info.maximumQoS, String, '2'),
      row('Retain available', info.retainAvailable, yesNo, 'yes'),
      row('Wildcard subscriptions', info.wildcardSubscriptionAvailable, yesNo, 'yes'),
      row('Shared subscriptions', info.sharedSubscriptionAvailable, yesNo, 'yes'),
      row('Subscription identifiers', info.subscriptionIdentifiersAvailable, yesNo, 'yes'),
      row('Receive maximum', info.receiveMaximum, formatNumber, formatNumber(65_535)),
      row('Maximum packet size', info.maximumPacketSize, (n) => formatBytes(n), 'no limit'),
      row('Topic alias maximum', info.topicAliasMaximum, formatNumber, '0, no aliases'),
      row('Server keep alive', info.serverKeepAlive, (n) => `${formatNumber(n)} s`, keepalive),
      row('Server reference', info.serverReference, String, 'none'),
      row('Response information', info.responseInformation, String, 'none')
    ]
  }
}
