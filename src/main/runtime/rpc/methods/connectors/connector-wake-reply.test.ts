// A turn that starts on its own posts nothing, so the bot can post itself: a worker start names where
// it came from, and the Home Chat may then answer only a DM such a start saved, never whichever DM
// wrote last or another bot's.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { reply, origin } = vi.hoisted(() => ({ reply: vi.fn(), origin: vi.fn() }))
vi.mock('../orchestration/messaging/bot-turn-origin', () => ({ readBotTurnOrigin: origin }))
vi.mock('../../../../bots/bot-session-tabs', () => ({
  botOfSession: (_bots: unknown, sessionId: string) =>
    sessionId === CHAT ? { id: 'bot-a' } : sessionId === OTHER_BOT_CHAT ? { id: 'bot-b' } : null
}))

import { CONNECTOR_METHODS } from './connector'
import { forgetWakeDms } from '../../../../bots/bot-wake-reply-place'

const CHAT = '55555555-5555-4555-8555-555555555555'
const OTHER_BOT_CHAT = '66666666-6666-4666-8666-666666666666'
const DM_X = 'T1:D0X:D0X:UBOT'
const DM_Y = 'T1:D0Y:D0Y:UBOT'
const X_LINK = 'https://app.slack.com/client/T1/D0X'
const THREAD = 'T1:C1:1712.000100:UBOT'

let target: Record<string, unknown> | null = null
const runtime = {
  getOrchestrationDb: () => ({}),
  bots: { enabled: () => true, list: () => [] },
  getExternalConversationSeam: () => ({ replyTarget: () => target }),
  getConnectorCloud: () => ({ cloudFeatures: () => new Set<string>(), reply })
}
const context = (sessionId: string) => ({
  runtime,
  orchestrationCaller: {
    address: `orca_session_id:${sessionId}`,
    terminalHandle: null,
    paneKey: null,
    orcaSessionId: sessionId,
    sessionId,
    workspaceId: 'w'
  }
})
const homeChat = (externalId: string, delivered: boolean, botId = 'bot-a') => ({
  key: { source: 'slack', externalId },
  turnId: 9,
  worktreeId: 'w',
  bot: { kind: 'bot-chat', botId },
  place: `the DM ${externalId}`,
  ...(delivered ? { answerDeliveryId: 'd1' } : {})
})

const handler = (name: string) =>
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the method's handler, called with the params and context it reads.
  CONNECTOR_METHODS.find((method) => method.name === name)!.handler as (
    params: unknown,
    context: unknown
  ) => Promise<unknown>
const placeFor = (sessionId: string, caller = sessionId) =>
  handler('connector.wakeReplyPlace')({ sessionId }, context(caller))
const replyTo = async (to: string, sessionId = CHAT) => {
  reply.mockClear()
  await handler('connector.replySavedDm')(
    { sessionId, replyId: 'r1', text: 'The worker failed to start.', to },
    context(sessionId)
  )
  return reply.mock.calls[0]?.[0]?.conversation
}

describe('a turn that started on its own answers where its worker start came from', () => {
  beforeEach(() => {
    reply.mockResolvedValue({ ok: true, value: {} })
    origin.mockResolvedValue({ source: 'slack', placeId: 'D0X' })
  })

  it('names a place only when the starting turn was the conversation’s and its origin agrees', async () => {
    target = { ...homeChat(THREAD, true), bot: { kind: 'bot', botId: 'bot-a' } }
    origin.mockResolvedValue({ source: 'slack', placeId: 'C1' })
    expect(await placeFor(CHAT)).toEqual({ place: `the DM ${THREAD}` })
    // A turn Orca began, a thread elsewhere in the origin record, or another chat asking: nothing.
    target = { ...homeChat(THREAD, false), bot: { kind: 'bot', botId: 'bot-a' } }
    expect(await placeFor(CHAT)).toEqual({ place: null })
    target = { ...homeChat(THREAD, true), bot: { kind: 'bot', botId: 'bot-a' } }
    origin.mockResolvedValue({ source: 'slack', placeId: 'C2' })
    expect(await placeFor(CHAT)).toEqual({ place: null })
    origin.mockResolvedValue({ source: 'slack', placeId: 'C1' })
    expect(await placeFor(CHAT, OTHER_BOT_CHAT)).toEqual({ place: null })
  })

  it('lets the Home Chat answer only a DM its own start saved', async () => {
    target = homeChat(DM_X, true)
    expect(await placeFor(CHAT)).toEqual({ place: `the DM ${DM_X}`, to: X_LINK })
    // Y wrote last; the reply still goes to X, the DM the start came from.
    target = homeChat(DM_Y, false)
    expect(await replyTo(X_LINK)).toEqual({ source: 'slack', externalId: DM_X })
    // A DM no start saved, or another bot's Chat naming X: refused.
    await expect(replyTo('https://app.slack.com/client/T1/D0Y')).rejects.toThrow('not_a_saved_dm')
    target = homeChat(DM_Y, false, 'bot-b')
    await expect(replyTo(X_LINK, OTHER_BOT_CHAT)).rejects.toThrow('not_a_saved_dm')
    // A turn Y's own message opened never speaks in X.
    target = homeChat(DM_Y, true)
    await expect(replyTo(X_LINK)).rejects.toThrow('not_a_saved_dm')
    target = homeChat(DM_X, true)
    expect(await replyTo(X_LINK)).toEqual({ source: 'slack', externalId: DM_X })
    // A deleted bot's saved DMs go with it.
    forgetWakeDms('bot-a')
    target = homeChat(DM_Y, false)
    await expect(replyTo(X_LINK)).rejects.toThrow('not_a_saved_dm')
    // Without --to the Home Chat still has no one conversation to post into.
    target = homeChat(DM_Y, false)
    await expect(
      handler('connector.reply')({ sessionId: CHAT, replyId: 'r2', text: 'hi' }, context(CHAT))
    ).rejects.toThrow('bot_chat_reply')
  })

  it('saves no DM for a start the DM did not open', async () => {
    target = homeChat('T1:D0Z:D0Z:UBOT', false)
    origin.mockResolvedValue({ source: 'slack', placeId: 'D0Z' })
    expect(await placeFor(CHAT)).toEqual({ place: null })
    target = homeChat(DM_Y, false)
    await expect(replyTo('https://app.slack.com/client/T1/D0Z')).rejects.toThrow('not_a_saved_dm')
  })
})
