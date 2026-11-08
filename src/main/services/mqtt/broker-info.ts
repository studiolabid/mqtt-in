/**
 * What a broker announced in its CONNACK, as the `BrokerInfo` the UI shows (CT-05). MQTT 5
 * capability fields stay absent when the broker did not send the property (its default applies)
 * and always on MQTT 3.x, which has no CONNACK properties.
 */
import type { IConnackPacket } from 'mqtt'
import type { BrokerInfo, MqttProtocolVersion, QoS } from '@shared/models'

function isQoS(value: unknown): value is QoS {
  return value === 0 || value === 1 || value === 2
}

/** The `BrokerInfo` of a successful CONNACK. */
export function brokerInfoOf(
  protocolVersion: MqttProtocolVersion,
  packet: Pick<IConnackPacket, 'sessionPresent' | 'properties'>
): BrokerInfo {
  const info: BrokerInfo = { protocolVersion, sessionPresent: packet.sessionPresent === true }
  const p = packet.properties
  if (protocolVersion !== 5 || !p) return info
  if (p.assignedClientIdentifier) info.assignedClientId = p.assignedClientIdentifier
  if (isQoS(p.maximumQoS)) info.maximumQoS = p.maximumQoS
  if (p.retainAvailable !== undefined) info.retainAvailable = p.retainAvailable
  if (p.wildcardSubscriptionAvailable !== undefined) {
    info.wildcardSubscriptionAvailable = p.wildcardSubscriptionAvailable
  }
  if (p.sharedSubscriptionAvailable !== undefined) {
    info.sharedSubscriptionAvailable = p.sharedSubscriptionAvailable
  }
  if (p.subscriptionIdentifiersAvailable !== undefined) {
    info.subscriptionIdentifiersAvailable = p.subscriptionIdentifiersAvailable
  }
  if (p.receiveMaximum !== undefined) info.receiveMaximum = p.receiveMaximum
  if (p.maximumPacketSize !== undefined) info.maximumPacketSize = p.maximumPacketSize
  if (p.topicAliasMaximum !== undefined) info.topicAliasMaximum = p.topicAliasMaximum
  if (p.serverKeepAlive !== undefined) info.serverKeepAlive = p.serverKeepAlive
  if (p.serverReference !== undefined) info.serverReference = p.serverReference
  if (p.responseInformation !== undefined) info.responseInformation = p.responseInformation
  return info
}
