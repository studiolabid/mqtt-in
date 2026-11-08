import { describe, expect, it } from 'vitest'
import {
  findMatchingSubscription,
  hasWildcard,
  isSharedSubscription,
  splitTopic,
  stripSharePrefix,
  topicMatches,
  validateTopicFilter,
  validateTopicName
} from '@shared/topic'

const HASH_ERROR = "'#' must be the last level and occupy the whole level"
const PLUS_ERROR = "'+' must occupy a whole topic level"
const SHARE_FORMAT_ERROR = 'Shared subscription must be $share/<group>/<filter>'
const SHARE_GROUP_ERROR = 'Share group name must not contain wildcards'

describe('splitTopic', () => {
  it('splits on every slash and keeps empty levels', () => {
    expect(splitTopic('a/b/c')).toEqual(['a', 'b', 'c'])
    expect(splitTopic('/finance')).toEqual(['', 'finance'])
    expect(splitTopic('a//b/')).toEqual(['a', '', 'b', ''])
    expect(splitTopic('')).toEqual([''])
  })
})

describe('validateTopicName', () => {
  it.each([
    'a',
    'sport/tennis/player1',
    '/',
    '/finance',
    'finance/',
    'a//b',
    '$SYS/broker/uptime',
    'Accounts payable',
    'ünïcödé/日本語/😀'
  ])('accepts %j', (topic) => {
    expect(validateTopicName(topic)).toBeNull()
  })

  it('requires a topic', () => {
    expect(validateTopicName('')).toBe('Topic is required')
  })

  it.each(['#', '+', 'a/#', 'a/+/b', 'sport+', 'a#b'])('rejects the wildcard in %j', (topic) => {
    expect(validateTopicName(topic)).toBe('Wildcards (+, #) are not allowed when publishing')
  })

  it('rejects the null character', () => {
    expect(validateTopicName('a\u0000b')).toBe('Topic must not contain the null character')
  })
})

describe('validateTopicFilter', () => {
  it.each([
    '#',
    '+',
    'sport/#',
    'sport/tennis/#',
    'sport/tennis/+',
    '+/tennis/#',
    'sport/+/player1',
    '+/+',
    '/+',
    '+/',
    '/',
    'a//b',
    'a/+/+/#',
    '$SYS/#',
    '$SYS/monitor/+',
    'Accounts payable/+'
  ])('accepts %j', (filter) => {
    expect(validateTopicFilter(filter)).toBeNull()
  })

  it('requires a filter', () => {
    expect(validateTopicFilter('')).toBe('Topic filter is required')
  })

  it.each(['sport/tennis#', 'sport/tennis/#/ranking', '#/a', '##', 'a/#/', 'a#', '+#'])(
    "rejects a misplaced or partial '#' in %j",
    (filter) => {
      expect(validateTopicFilter(filter)).toBe(HASH_ERROR)
    }
  )

  it.each(['sport+', 'sport/+player1', '++', '+a/b', 'a/b+', 'a/++/c'])(
    "rejects a partial-level '+' in %j",
    (filter) => {
      expect(validateTopicFilter(filter)).toBe(PLUS_ERROR)
    }
  )

  it('rejects the null character', () => {
    expect(validateTopicFilter('a/\u0000/#')).toBe(
      'Topic filter must not contain the null character'
    )
  })

  describe('shared subscriptions ($share/<group>/<filter>)', () => {
    it.each(['$share/group/a/b', '$share/group/#', '$share/g/+/x', '$share/g/+', '$share/g//'])(
      'accepts %j',
      (filter) => {
        expect(validateTopicFilter(filter)).toBeNull()
      }
    )

    it.each<[string, string]>([
      ['$share/', SHARE_FORMAT_ERROR],
      ['$share/group', SHARE_FORMAT_ERROR],
      ['$share//a', SHARE_FORMAT_ERROR],
      ['$share/gr+oup/a', SHARE_GROUP_ERROR],
      ['$share/+/a', SHARE_GROUP_ERROR],
      ['$share/#/a', SHARE_GROUP_ERROR],
      ['$share/group/', 'Shared subscription filter is empty'],
      ['$share/group/a#', HASH_ERROR],
      ['$share/group/#/a', HASH_ERROR],
      ['$share/group/a+', PLUS_ERROR]
    ])('rejects %j', (filter, message) => {
      expect(validateTopicFilter(filter)).toBe(message)
    })

    it("treats '$share' without a slash, '$sharex/' and '$SHARE/' as ordinary filters", () => {
      expect(validateTopicFilter('$share')).toBeNull()
      expect(validateTopicFilter('$sharex/a/#')).toBeNull()
      expect(validateTopicFilter('$SHARE/group')).toBeNull()
    })
  })

  describe('EMQX queue subscriptions ($queue/<filter>)', () => {
    it.each(['$queue/a/b', '$queue/#', '$queue/+/x'])('accepts %j', (filter) => {
      expect(validateTopicFilter(filter)).toBeNull()
    })

    it.each<[string, string]>([
      ['$queue/', 'Queue subscription filter is empty'],
      ['$queue/a/#/b', HASH_ERROR],
      ['$queue/a+', PLUS_ERROR]
    ])('rejects %j', (filter, message) => {
      expect(validateTopicFilter(filter)).toBe(message)
    })
  })
})

describe('topicMatches', () => {
  describe('MQTT 5.0 §4.7 examples', () => {
    it.each<[string, string, boolean]>([
      // §4.7.1.2 multi-level wildcard
      ['sport/tennis/player1/#', 'sport/tennis/player1', true],
      ['sport/tennis/player1/#', 'sport/tennis/player1/ranking', true],
      ['sport/tennis/player1/#', 'sport/tennis/player1/score/wimbledon', true],
      ['sport/#', 'sport', true],
      ['#', 'sport/tennis', true],
      ['#', '/finance', true],
      // §4.7.1.3 single-level wildcard
      ['sport/tennis/+', 'sport/tennis/player1', true],
      ['sport/tennis/+', 'sport/tennis/player2', true],
      ['sport/tennis/+', 'sport/tennis/player1/ranking', false],
      ['sport/+', 'sport', false],
      ['sport/+', 'sport/', true],
      ['sport/+/player1', 'sport/tennis/player1', true],
      ['+/tennis/#', 'sport/tennis/player1/score', true],
      ['+/+', '/finance', true],
      ['/+', '/finance', true],
      ['+', '/finance', false],
      // §4.7.2 topics beginning with $
      ['#', '$SYS/x', false],
      ['#', '$SYS', false],
      ['+', '$SYS', false],
      ['+/monitor/Clients', '$SYS/monitor/Clients', false],
      ['$SYS/#', '$SYS/a', true],
      ['$SYS/#', '$SYS', true],
      ['$SYS/monitor/+', '$SYS/monitor/Clients', true],
      // §4.7.3 case sensitivity and distinct names
      ['ACCOUNTS', 'Accounts', false],
      ['Accounts payable', 'Accounts payable', true],
      ['/finance', 'finance', false],
      ['finance', '/finance', false]
    ])('%j vs %j → %s', (filter, topic, expected) => {
      expect(topicMatches(filter, topic)).toBe(expected)
    })
  })

  describe('edge cases', () => {
    it.each<[string, string, boolean]>([
      ['a/b', 'a/b', true],
      ['a/b', 'a/b/c', false],
      ['a/b/c', 'a/b', false],
      ['a/+/c', 'a//c', true],
      ['a/#', 'a/', true],
      ['a/#', 'ab', false],
      ['a/+', 'a/b/', false],
      ['+/+/+', 'a/b/c', true],
      ['+/#', 'a', true],
      ['$SYS/+', '$SYS/x', true],
      ['$data/#', '$SYS/x', false]
    ])('%j vs %j → %s', (filter, topic, expected) => {
      expect(topicMatches(filter, topic)).toBe(expected)
    })
  })

  describe('shared subscription prefixes are ignored', () => {
    it.each<[string, string, boolean]>([
      ['$share/group/sport/#', 'sport/tennis', true],
      ['$share/group/sport/+', 'sport', false],
      ['$share/group/#', '$SYS/x', false],
      ['$share/group/$SYS/#', '$SYS/x', true],
      ['$share/group/a', 'a', true],
      ['$share/group/a', '$share/group/a', false],
      ['$queue/a/+', 'a/b', true],
      ['$queue/#', 'anything/at/all', true],
      ['$share/group', 'group', false],
      ['$share/', 'x', false]
    ])('%j vs %j → %s', (filter, topic, expected) => {
      expect(topicMatches(filter, topic)).toBe(expected)
    })
  })
})

describe('stripSharePrefix', () => {
  it.each<[string, string]>([
    ['$share/group/a/b', 'a/b'],
    ['$share/group/#', '#'],
    ['$share/group/', ''],
    ['$share/group', ''],
    ['$share/', ''],
    ['$queue/a/b', 'a/b'],
    ['$queue/', ''],
    ['a/b', 'a/b'],
    ['$SYS/#', '$SYS/#'],
    ['$share', '$share']
  ])('%j → %j', (filter, expected) => {
    expect(stripSharePrefix(filter)).toBe(expected)
  })
})

describe('isSharedSubscription / hasWildcard', () => {
  it('recognises $share/ and $queue/ prefixes only', () => {
    expect(isSharedSubscription('$share/g/a')).toBe(true)
    expect(isSharedSubscription('$queue/a')).toBe(true)
    expect(isSharedSubscription('$share')).toBe(false)
    expect(isSharedSubscription('a/$share/b')).toBe(false)
  })

  it('detects + and # anywhere', () => {
    expect(hasWildcard('a/+/b')).toBe(true)
    expect(hasWildcard('a/#')).toBe(true)
    expect(hasWildcard('a/b')).toBe(false)
    expect(hasWildcard('$share/g/a')).toBe(false)
  })
})

describe('findMatchingSubscription', () => {
  interface Sub {
    id: string
    topic: string
    enabled?: boolean
  }

  const subs: Sub[] = [
    { id: 'temp', topic: 'sensors/+/temp', enabled: true },
    { id: 'sensors', topic: 'sensors/#', enabled: true },
    { id: 'alerts', topic: '$share/g/alerts/#' }
  ]

  it('returns the first match in list order', () => {
    expect(findMatchingSubscription(subs, 'sensors/kitchen/temp')?.id).toBe('temp')
  })

  it('falls through to later filters', () => {
    expect(findMatchingSubscription(subs, 'sensors/kitchen/humidity')?.id).toBe('sensors')
  })

  it('ignores shared-subscription prefixes and treats a missing enabled flag as enabled', () => {
    expect(findMatchingSubscription(subs, 'alerts/fire')?.id).toBe('alerts')
  })

  it('returns undefined when nothing matches or the list is empty', () => {
    expect(findMatchingSubscription(subs, 'other/topic')).toBeUndefined()
    expect(findMatchingSubscription([], 'a')).toBeUndefined()
  })

  it('skips disabled subscriptions', () => {
    const list: Sub[] = [
      { id: 'off', topic: 'sensors/#', enabled: false },
      { id: 'on', topic: 'sensors/+/temp', enabled: true }
    ]
    expect(findMatchingSubscription(list, 'sensors/kitchen/temp')?.id).toBe('on')
    expect(findMatchingSubscription(list, 'sensors/kitchen/humidity')).toBeUndefined()
  })

  it('returns the original element (not a copy)', () => {
    expect(findMatchingSubscription(subs, 'sensors/x/temp')).toBe(subs[0])
  })
})
