import { describe, expect, it } from 'vitest'
import { utf8Decode } from '@shared/payload'
import {
  cleanPublishProperties,
  createPublishDraft,
  DEFAULT_PUBLISH_PAYLOAD,
  draftFromMessage,
  parseDraft,
  parseHistoryItem,
  payloadForEditing,
  preparePublish,
  publishPropertiesProblem,
  sameDraftContent
} from '@/utils/publish'
import { message, utf8 } from './helpers'

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0)

describe('createPublishDraft', () => {
  it('uses the mqtey defaults', () => {
    expect(createPublishDraft()).toEqual({
      topic: 'mqtey/test',
      payload: '{\n  "msg": "hello from mqtey",\n  "at": "{{iso}}"\n}',
      format: 'json',
      qos: 0,
      retain: false,
      useTemplate: true,
      properties: { userProperties: [] }
    })
  })

  it('applies overrides and copies user properties', () => {
    const userProperties = [{ key: 'k', value: 'v' }]
    const draft = createPublishDraft({
      topic: 'x',
      properties: { contentType: 'a', userProperties }
    })
    expect(draft.topic).toBe('x')
    expect(draft.properties).toEqual({ contentType: 'a', userProperties })
    expect(draft.properties.userProperties?.[0]).not.toBe(userProperties[0])
  })
})

describe('cleanPublishProperties', () => {
  it('drops empty and invalid values', () => {
    expect(
      cleanPublishProperties({
        payloadFormatIndicator: undefined,
        messageExpiryInterval: Number.NaN,
        topicAlias: 0,
        responseTopic: '',
        correlationData: '',
        contentType: '',
        userProperties: [{ key: ' ', value: 'x' }]
      })
    ).toBeUndefined()
    expect(cleanPublishProperties(undefined)).toBeUndefined()
  })

  it('keeps meaningful values', () => {
    expect(
      cleanPublishProperties({
        payloadFormatIndicator: false,
        messageExpiryInterval: 0,
        topicAlias: 3,
        responseTopic: 'reply/to',
        correlationData: 'abc',
        contentType: 'application/json',
        userProperties: [
          { key: 'a', value: '' },
          { key: '', value: 'dropped' }
        ]
      })
    ).toEqual({
      payloadFormatIndicator: false,
      messageExpiryInterval: 0,
      topicAlias: 3,
      responseTopic: 'reply/to',
      correlationData: 'abc',
      contentType: 'application/json',
      userProperties: [{ key: 'a', value: '' }]
    })
  })
})

describe('preparePublish', () => {
  it('rejects invalid topics', () => {
    expect(preparePublish(createPublishDraft({ topic: '' }), { protocolVersion: 5 })).toEqual({
      ok: false,
      error: 'Topic is required'
    })
    const wildcard = preparePublish(createPublishDraft({ topic: 'a/#' }), { protocolVersion: 5 })
    expect(wildcard.ok).toBe(false)
  })

  it('renders templates when enabled', () => {
    const prepared = preparePublish(createPublishDraft(), { protocolVersion: 5, now: NOW })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(JSON.parse(utf8Decode(prepared.request.payload))).toEqual({
      msg: 'hello from mqtey',
      at: '2026-11-08T12:00:00.000Z'
    })
    const counter = preparePublish(
      createPublishDraft({ payload: 'n={{counter}}', format: 'text' }),
      { protocolVersion: 5, counter: 7 }
    )
    expect(counter.ok && utf8Decode(counter.request.payload)).toBe('n=7')
  })

  it('keeps template tokens when templates are disabled', () => {
    const prepared = preparePublish(createPublishDraft({ useTemplate: false }), {
      protocolVersion: 5
    })
    expect(prepared.ok && utf8Decode(prepared.request.payload)).toBe(DEFAULT_PUBLISH_PAYLOAD)
  })

  it('reports encoding errors', () => {
    const prepared = preparePublish(createPublishDraft({ payload: '{"a":', useTemplate: false }), {
      protocolVersion: 5
    })
    expect(prepared.ok).toBe(false)
    expect(!prepared.ok && prepared.error).toMatch(/^Invalid JSON/)
    const hex = preparePublish(createPublishDraft({ payload: 'zz', format: 'hex' }), {
      protocolVersion: 5
    })
    expect(!hex.ok && hex.error).toMatch(/hex/i)
  })

  it('sends MQTT 5 properties only to MQTT 5 brokers', () => {
    const draft = createPublishDraft({
      qos: 1,
      retain: true,
      properties: { contentType: 'application/json', userProperties: [] }
    })
    const v5 = preparePublish(draft, { protocolVersion: 5 })
    expect(v5.ok && v5.request).toMatchObject({
      topic: 'mqtey/test',
      qos: 1,
      retain: true,
      properties: { contentType: 'application/json' }
    })
    const v4 = preparePublish(draft, { protocolVersion: 4 })
    expect(v4.ok && v4.request).not.toHaveProperty('properties')
    const empty = preparePublish(createPublishDraft(), { protocolVersion: 5 })
    expect(empty.ok && empty.request).not.toHaveProperty('properties')
  })

  it('rejects MQTT strings over 65,535 UTF-8 bytes (not characters)', () => {
    const over = '€'.repeat(21_846) // 65,538 bytes in 21,846 characters
    const draft = createPublishDraft({ properties: { contentType: over, userProperties: [] } })
    expect(preparePublish(draft, { protocolVersion: 5 })).toEqual({
      ok: false,
      error: 'Content type is too long (max 65535 bytes)'
    })
    // 21,845 euro signs = 65,535 bytes: fits.
    const fits = createPublishDraft({
      properties: { contentType: '€'.repeat(21_845), userProperties: [] }
    })
    expect(preparePublish(fits, { protocolVersion: 5 }).ok).toBe(true)
    // Not sent to MQTT 3.1.1 brokers, so not checked there.
    expect(preparePublish(draft, { protocolVersion: 4 }).ok).toBe(true)
  })

  it('checks every string property, user properties and the correlation data', () => {
    const over = '€'.repeat(21_846)
    expect(publishPropertiesProblem({ responseTopic: over })).toBe(
      'Response topic is too long (max 65535 bytes)'
    )
    expect(publishPropertiesProblem({ responseTopic: 'reply/#' })).toBe(
      'Response topic must not contain wildcards (+, #)'
    )
    expect(publishPropertiesProblem({ userProperties: [{ key: over, value: 'v' }] })).toBe(
      'User property name is too long (max 65535 bytes)'
    )
    expect(publishPropertiesProblem({ userProperties: [{ key: 'k', value: 'a\uD800b' }] })).toBe(
      'User property value contains an unpaired surrogate'
    )
    expect(publishPropertiesProblem({ correlationData: over })).toBe(
      'Correlation data is too long (max 65535 bytes)'
    )
    expect(publishPropertiesProblem({ contentType: 'text/plain', userProperties: [] })).toBeNull()
    expect(publishPropertiesProblem(undefined)).toBeNull()
  })
})

describe('payloadForEditing', () => {
  it('pretty prints JSON, keeps text and shows binary data as hex', () => {
    expect(payloadForEditing(utf8('{"a":[1,2]}'))).toEqual({
      payload: '{\n  "a": [\n    1,\n    2\n  ]\n}',
      format: 'json'
    })
    expect(payloadForEditing(utf8('hello'))).toEqual({ payload: 'hello', format: 'text' })
    expect(payloadForEditing(utf8('42'))).toEqual({ payload: '42', format: 'text' })
    expect(payloadForEditing(Uint8Array.from([0, 1, 255]))).toEqual({
      payload: '00 01 ff',
      format: 'hex'
    })
    expect(payloadForEditing(new Uint8Array())).toEqual({ payload: '', format: 'text' })
  })
})

describe('draftFromMessage', () => {
  it('copies topic, QoS, retain and properties without receive-only fields', () => {
    const draft = draftFromMessage(
      message({
        topic: 'a/b',
        qos: 2,
        retain: true,
        payload: utf8('{"x":1}'),
        properties: {
          contentType: 'application/json',
          subscriptionIdentifier: [4],
          topicAlias: 9,
          messageExpiryInterval: 60,
          userProperties: [{ key: 'k', value: 'v' }]
        }
      }),
      createPublishDraft()
    )
    expect(draft).toEqual({
      topic: 'a/b',
      payload: '{\n  "x": 1\n}',
      format: 'json',
      qos: 2,
      retain: true,
      useTemplate: true,
      properties: {
        contentType: 'application/json',
        messageExpiryInterval: 60,
        userProperties: [{ key: 'k', value: 'v' }]
      }
    })
  })

  it('disables templates when the payload contains template tokens', () => {
    const draft = draftFromMessage(
      message({ payload: utf8('id={{uuid}}') }),
      createPublishDraft({ useTemplate: true })
    )
    expect(draft.useTemplate).toBe(false)
    expect(draft.properties).toEqual({ userProperties: [] })
  })
})

describe('sameDraftContent', () => {
  it('compares what would be published', () => {
    const a = createPublishDraft()
    expect(sameDraftContent(a, createPublishDraft())).toBe(true)
    expect(sameDraftContent(a, createPublishDraft({ qos: 1 }))).toBe(false)
    expect(sameDraftContent(a, createPublishDraft({ payload: 'x' }))).toBe(false)
    // Empty properties are equivalent to no properties.
    expect(
      sameDraftContent(
        a,
        createPublishDraft({ properties: { contentType: '', userProperties: [] } })
      )
    ).toBe(true)
    expect(
      sameDraftContent(
        a,
        createPublishDraft({ properties: { contentType: 'x', userProperties: [] } })
      )
    ).toBe(false)
  })
})

describe('parseDraft / parseHistoryItem', () => {
  it('accepts valid data and fills defaults', () => {
    expect(parseDraft({ topic: 't', payload: 'p' })).toEqual({
      topic: 't',
      payload: 'p',
      format: 'text',
      qos: 0,
      retain: false,
      useTemplate: true,
      properties: { userProperties: [] }
    })
    expect(
      parseDraft({
        topic: 't',
        payload: 'p',
        format: 'hex',
        qos: 2,
        retain: true,
        useTemplate: false,
        properties: { contentType: 'c', userProperties: [{ key: 'a', value: 'b' }, { key: 1 }] }
      })
    ).toEqual({
      topic: 't',
      payload: 'p',
      format: 'hex',
      qos: 2,
      retain: true,
      useTemplate: false,
      properties: { contentType: 'c', userProperties: [{ key: 'a', value: 'b' }] }
    })
  })

  it('rejects malformed data', () => {
    expect(parseDraft(null)).toBeNull()
    expect(parseDraft([])).toBeNull()
    expect(parseDraft({ topic: 1, payload: 'p' })).toBeNull()
    expect(parseDraft({ topic: 't', payload: 'p', format: 'exe', qos: 7 })).toMatchObject({
      format: 'text',
      qos: 0
    })
  })

  it('requires an id for history items', () => {
    expect(parseHistoryItem({ topic: 't', payload: 'p' })).toBeNull()
    expect(parseHistoryItem({ id: 'h1', topic: 't', payload: 'p', timestamp: 5 })).toMatchObject({
      id: 'h1',
      timestamp: 5
    })
    expect(parseHistoryItem({ id: 'h1', topic: 't', payload: 'p' })?.timestamp).toBe(0)
  })
})
