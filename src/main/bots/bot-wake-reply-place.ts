// Where a bot's background work started, for a turn that later starts on its own (that work finished)
// and so posts nothing by itself: the Slack thread or DM whose delivery opened the starting turn, as
// that turn's origin record (#486) also names it. A DM is saved here when proven, so the Home Chat may
// later answer that DM, not whichever DM wrote last. Kept in memory: after a restart it is not
// recorded, so such a reply is refused (a missed post, never one in the wrong place).
import type {
  ConversationKey,
  ReplyTarget
} from '../external-conversations/external-conversation-types'
import type { BotWakingPlace } from './bot-request-asker'
import { slackPlaceOf, slackThreadUrl } from '../../shared/connectors/slack-mirror-state'

export type WakeReplyPlace = {
  /** The thread or DM, as a bot reads it. */
  place: string
  /** A DM the Home Chat answers with `bot reply --to <this>`; absent for a thread chat's own thread. */
  to?: string
}

const MAX_DMS_PER_BOT = 64
const recordedDms = new Map<string, Map<string, ConversationKey>>()

/** The place, when the running turn was opened by its conversation's delivery and its origin record
 *  names that same Slack channel; null for anything else. */
export async function wakeReplyPlace(
  botId: string,
  target: ReplyTarget | null,
  // The host's mark that a connector message opened or joined the running turn: the journal's opener
  // alone can't say, as a turn that started on its own reads as the last message's.
  delivered: boolean,
  readOrigin: () => Promise<BotWakingPlace | null>
): Promise<WakeReplyPlace | null> {
  if (
    !delivered ||
    !target?.answerDeliveryId ||
    target.bot?.botId !== botId ||
    target.key.source !== 'slack'
  ) {
    return null
  }
  const slack = slackPlaceOf(target.key.externalId)
  if (!slack) {
    return null
  }
  const origin = await readOrigin()
  if (origin?.source !== 'slack' || origin.placeId !== slack.channelId) {
    return null
  }
  if (target.bot.kind === 'bot') {
    return { place: target.place }
  }
  const to = slackThreadUrl(target.key.externalId)
  // A DM's id repeats its channel where a thread's holds its timestamp.
  const [, channel, again] = target.key.externalId.split(':')
  if (!to || slack.threadTs || !channel?.startsWith('D') || again !== channel) {
    return null
  }
  const dms = recordedDms.get(botId) ?? new Map<string, ConversationKey>()
  dms.delete(to)
  dms.set(to, target.key)
  if (dms.size > MAX_DMS_PER_BOT) {
    dms.delete(dms.keys().next().value!)
  }
  recordedDms.set(botId, dms)
  return { place: target.place, to }
}

/** The DM conversation `--to` names, only when this bot's own start saved it. */
export function recordedWakeDm(botId: string, to: string): ConversationKey | null {
  return recordedDms.get(botId)?.get(to) ?? null
}

/** A deleted bot's saved DMs go with it. */
export function forgetWakeDms(botId: string): void {
  recordedDms.delete(botId)
}
