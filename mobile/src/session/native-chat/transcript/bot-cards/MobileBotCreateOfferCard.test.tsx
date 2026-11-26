import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BotCreateOffer } from '../../../../../../src/shared/bots/bot-proposal'
import type { SupportedUiLocale } from '../../../../../../src/shared/i18n/ui-locale'
import { publishHostBots } from '../../../../bots/host-bot-store'
import type { PhoneBot } from '../../../../bots/host-bots-operations'
import { clearBotLink, readPendingBotLink } from '../../../../bots/pending-bot-link'
import { activateMobileUiLocale } from '../../../../i18n/mobile-i18n'
import { MobileBotCreateOfferCard } from './MobileBotCreateOfferCard'
import { MobileBotCardHostContext, type MobileBotCardHost } from './mobile-bot-card-host'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }
}))
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  Image: 'Image',
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios },
  useColorScheme: () => 'dark',
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
  Appearance: { getColorScheme: () => 'dark', addChangeListener: () => ({ remove: () => {} }) }
}))
// Every icon as a host element named after it.
vi.mock(
  'lucide-react-native',
  () => new Proxy({}, { get: (_, name) => String(name), has: () => true })
)
vi.mock('../../../../bots/MobileBotAvatar', () => ({ MobileBotAvatar: 'MobileBotAvatar' }))
vi.mock('../../../../worktree/execution-hosts/use-route-capability', () => ({
  useRouteCapability: () => false
}))
vi.mock('./use-mobile-bot-offer-answer', () => ({
  useMobileBotOfferAnswer: () => ({ dismissed: false, error: null, dismiss() {}, clearError() {} })
}))

const HOST_KEY = 'host-synthetic'
const PROPOSER_ID = 'bot-synthetic-planner'
const host: MobileBotCardHost = {
  client: null,
  hostKey: HOST_KEY,
  pairedHostId: 'paired-synthetic',
  hostLabel: 'Synthetic Mac',
  openBotChat: () => {},
  editOffer: () => {}
}

function bot(id: string, name: string, extra: Partial<PhoneBot> = {}): PhoneBot {
  return { id, name, agent: 'claude', folderWorkspaceId: `folder-${id}`, ...extra } as PhoneBot
}

function offer(offerId: string, name: string): BotCreateOffer {
  return {
    botId: PROPOSER_ID,
    offerId,
    offeredAt: 1,
    proposal: {
      name,
      purpose: 'Drafts weekly notes from merged work.',
      watches: 'Merged pull requests',
      does: 'Drafts the notes',
      reports: 'A draft in chat'
    }
  } as BotCreateOffer
}

/** The proposer, having accepted each offer into the bot id it maps to. */
function seed(accepted: Record<string, string>, made: PhoneBot[]): void {
  const proposer = bot(PROPOSER_ID, 'Synthetic Planner', {
    acceptedOffers: Object.entries(accepted).map(([offerId, botId]) => ({ offerId, botId }))
  })
  act(() => publishHostBots(HOST_KEY, { bots: [proposer, ...made], hideBotCreated: false }))
}

let tree: ReactTestRenderer | null = null
beforeEach(() => {
  const link = readPendingBotLink()
  if (link) {
    clearBotLink(link.id)
  }
})
afterEach(async () => {
  act(() => tree?.unmount())
  tree = null
  await act(() => activateMobileUiLocale('en'))
})

function render(cards: BotCreateOffer[]): void {
  act(() => {
    tree = create(
      createElement(
        MobileBotCardHostContext.Provider,
        { value: host },
        ...cards.map((card) =>
          createElement(MobileBotCreateOfferCard, {
            key: card.offerId,
            offer: card,
            cardId: card.offerId,
            fallback: 'fallback',
            fontScale: 1
          })
        )
      )
    )
  })
}

function textOf(node: ReactTestInstance): string {
  return node
    .findAll((child) => (child.type as unknown) === 'Text')
    .flatMap((child) => child.props.children)
    .filter((part) => typeof part === 'string')
    .join('')
}

/** The pills whose visible label is exactly Open, as a screen reader meets them. */
function openPills(): ReactTestInstance[] {
  return tree!.root.findAll(
    (node) =>
      (node.type as unknown) === 'Pressable' &&
      node.props.accessibilityRole === 'button' &&
      textOf(node) === 'Open'
  )
}

it("names the created bot on its Open pill and opens that bot's home", () => {
  seed({ 'offer-made': 'bot-made' }, [bot('bot-made', 'Release Notes Drafter')])
  render([offer('offer-made', 'Release Notes Drafter')])

  const [open] = openPills()
  expect(openPills()).toHaveLength(1)
  expect(open.props.accessibilityRole).toBe('button')
  expect(open.props.accessibilityLabel).toBe('Open Release Notes Drafter')

  act(() => open.props.onPress())
  expect(readPendingBotLink()?.target).toEqual({ kind: 'bot', botId: 'bot-made' })
})

it('tells several created cards apart by name, in any script, and each opens its own bot', () => {
  const names = {
    'bot-ja': 'リリースノート係',
    'bot-ko': '릴리스 노트 봇',
    'bot-mixed': 'Release ノート 봇 v2'
  }
  seed(
    Object.fromEntries(Object.keys(names).map((id) => [`offer-${id}`, id])),
    Object.entries(names).map(([id, name]) => bot(id, name))
  )
  render(Object.entries(names).map(([id, name]) => offer(`offer-${id}`, name)))

  const pills = openPills()
  expect(pills.map((pill) => pill.props.accessibilityLabel)).toEqual([
    'Open リリースノート係',
    'Open 릴리스 노트 봇',
    'Open Release ノート 봇 v2'
  ])
  for (const [index, id] of Object.keys(names).entries()) {
    act(() => pills[index].props.onPress())
    expect(readPendingBotLink()?.target).toEqual({ kind: 'bot', botId: id })
  }
})

it('names the bot as it is called now, after a rename since the card was offered', () => {
  seed({ 'offer-renamed': 'bot-renamed' }, [bot('bot-renamed', 'Weekly Notes')])
  render([offer('offer-renamed', 'Release Notes Drafter')])

  expect(openPills().map((pill) => pill.props.accessibilityLabel)).toEqual(['Open Weekly Notes'])
})

it('offers no Open once the created bot was deleted', () => {
  seed({ 'offer-gone': 'bot-gone' }, [])
  render([offer('offer-gone', 'Release Notes Drafter')])

  expect(openPills()).toHaveLength(0)
  expect(tree!.root.findAll((node) => node.props.accessibilityLabel !== undefined)).toEqual([])
})

it('offers no Open while the bot is not created yet', () => {
  seed({}, [])
  render([offer('offer-open', 'Release Notes Drafter')])

  expect(openPills()).toHaveLength(0)
  expect(
    tree!.root
      .findAll((node) => (node.type as unknown) === 'Pressable')
      .map((node) => textOf(node))
      .slice(1)
  ).toEqual(['Not now', 'Edit', 'Create bot'])
})

// The languages whose phone catalogs take this label next; until they do, each reads the English.
const TARGET_LOCALES: SupportedUiLocale[] = ['de', 'es', 'fr', 'ja', 'ko', 'pt', 'zh-Hant']

it.each(TARGET_LOCALES)('names the bot on its Open pill in %s', async (locale) => {
  await act(() => activateMobileUiLocale(locale))
  seed({ 'offer-made': 'bot-made' }, [bot('bot-made', 'リリース 봇 Drafter')])
  render([offer('offer-made', 'リリース 봇 Drafter')])

  const labelled = tree!.root.findAll(
    (node) =>
      (node.type as unknown) === 'Pressable' && typeof node.props.accessibilityLabel === 'string'
  )
  expect(labelled).toHaveLength(1)
  const [open] = labelled
  const label: string = open.props.accessibilityLabel
  expect(label).toContain('リリース 봇 Drafter')
  expect(label).not.toContain('{{')
  expect(label).not.toContain('chat.botCards')
  act(() => open.props.onPress())
  expect(readPendingBotLink()?.target).toEqual({ kind: 'bot', botId: 'bot-made' })
})
