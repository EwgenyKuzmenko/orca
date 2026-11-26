/** connector.* conversation handlers act on this host's seam, regardless of caller. */

import {
  cloudConversation,
  CONNECTOR_REPLIES_OUTBOX_FEATURE
} from '../../../../../shared/connectors/connector-cloud-contract'
import { botReplyRefusal } from '../../../../external-conversations/external-conversation-bots'
import {
  ConnectorReply,
  ConnectorWakeReplyPlace,
  CONNECTOR_REPLY_HTML_PAGE_AS_FILE
} from '../../../../../shared/rpc-contract/connectors/connector-params'
import type { ExternalConversationSeam } from '../../../../external-conversations/external-conversation-seam'
import { chatPaneKey } from '../../../../external-conversations/external-conversation-chat'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import { defineMethod, type RpcContext } from '../../core'
import { readBotTurnOrigin } from '../orchestration/messaging/bot-turn-origin'
import { recordedWakeDm, wakeReplyPlace } from '../../../../bots/bot-wake-reply-place'
import type {
  ConversationKey,
  ReplyTarget
} from '../../../../external-conversations/external-conversation-types'
import { botTurnFor } from '../../../../bots/bot-turn-for'
import { sessionCallerOf } from '../../../orchestration/addressing/orchestration-caller-identity'
import { CONNECTOR_ACT_METHOD } from '../connector-act'
import { connectorPostAttempts } from '../../../../external-conversations/connector-post-attempts'
import { CONNECTOR_REACT_METHOD } from '../connector-react'
import { CONNECTOR_LEAVE_THREAD_METHOD } from '../connector-leave-thread'
import { splitHtmlDocumentFences } from '../../../../../shared/markdown/html-document-fences'
import type { ConnectorCloudFeature } from '../../../../../shared/connector-cloud-features'
import { botOfSession } from '../../../../bots/bot-session-tabs'

/** The DM `--to` names: only from the bot's own Home Chat, and only one its worker start saved. */
function homeChatSavedDm(
  params: { to?: string } & ({ sessionId: string } | { paneKey: string }),
  target: ReplyTarget,
  context: Pick<RpcContext, 'runtime' | 'orchestrationCaller'>
): ConversationKey {
  const sessionId = 'sessionId' in params ? params.sessionId : null
  const bot =
    sessionId && context.runtime.bots.enabled()
      ? botOfSession(context.runtime.bots, sessionId)
      : null
  const saved =
    bot &&
    params.to &&
    sessionCallerOf(context.orchestrationCaller)?.sessionId === sessionId &&
    target.bot?.kind === 'bot-chat' &&
    target.bot.botId === bot.id
      ? recordedWakeDm(bot.id, params.to)
      : null
  if (!saved) {
    throw new Error('not_a_saved_dm')
  }
  return saved
}

export function requireSeam(
  runtime: Pick<OrcaRuntimeService, 'getExternalConversationSeam'>
): ExternalConversationSeam {
  const seam = runtime.getExternalConversationSeam()
  if (!seam) {
    throw new Error('connectors_disabled')
  }
  return seam
}

export const CONNECTOR_METHODS = [
  // `orca bot reply`: the calling pane names its cloud conversation and turn; Orca Cloud posts it.
  defineMethod({
    name: 'connector.reply',
    permission: 'workspace',
    params: ConnectorReply,
    handler: async (params, context) => {
      const { replyId, text, review } = params
      const paneKey = 'paneKey' in params ? params.paneKey : chatPaneKey(params.sessionId)
      const target = requireSeam(context.runtime).replyTarget(paneKey)
      if (!target) {
        throw new Error('not_a_cloud_conversation')
      }
      const savedDm = params.to ? homeChatSavedDm(params, target, context) : null
      // A bot posts only into the conversation its chat is bound to, as that bot.
      const botRefusal = savedDm
        ? null
        : botReplyRefusal(target, context.runtime.bots.enabled() ? context.runtime.bots.list() : [])
      if (botRefusal) {
        throw new Error(botRefusal)
      }
      const conversation = cloudConversation(savedDm ?? target.key)
      if (!conversation) {
        throw new Error('not_a_cloud_conversation')
      }
      if (target.turnId === null) {
        throw new Error('no_current_turn')
      }
      const turnFor =
        'sessionId' in params
          ? await botTurnFor(context.runtime, params.sessionId, {
              verifiedSessionId: sessionCallerOf(context.orchestrationCaller)?.sessionId
            })
          : // A terminal pane's reply names no chat whose turn Orca can read.
            'someone_else'
      const cloud = context.runtime.getConnectorCloud()
      // Slack shows a whole page as an .html file; a caller that asked resends it with the page attached.
      const features = cloud?.cloudFeatures()
      // A saved DM takes its words inline: files would stage in the chat's current conversation.
      if (
        !savedDm &&
        params.pagesAsFiles &&
        conversation.source === 'slack' &&
        'sessionId' in params &&
        context.runtime.bots.enabled() &&
        botOfSession(context.runtime.bots, params.sessionId) &&
        (['actions', 'files.direct', 'reply.files'] satisfies ConnectorCloudFeature[]).every(
          (feature) => features?.has(feature)
        ) &&
        splitHtmlDocumentFences(text).documents.length > 0
      ) {
        throw new Error(CONNECTOR_REPLY_HTML_PAGE_AS_FILE)
      }
      // Under replies.outbox a reply naming its turn's request takes that request's answer key.
      const keyed =
        !savedDm &&
        target.answerDeliveryId &&
        cloud?.cloudFeatures()?.has(CONNECTOR_REPLIES_OUTBOX_FEATURE) === true
          ? { answerDeliveryId: target.answerDeliveryId }
          : {}
      const refused = connectorPostAttempts.attempted(paneKey, replyId, conversation.externalId)
      const sent = await cloud?.reply({
        replyId,
        conversation,
        turnId: target.turnId,
        text,
        turnFor,
        ...(review ? { review } : {}),
        ...keyed
      })
      // Never sent, or refused outright: nothing reached the thread. A lost answer may have posted.
      if (
        !sent ||
        (!sent.ok && sent.status !== null && sent.status < 500 && sent.error !== 'post_uncertain')
      ) {
        refused()
      }
      if (!sent) {
        throw new Error('connector_not_connected')
      }
      if (!sent.ok) {
        throw new Error(
          sent.error === 'not_this_hosts_thread' ? 'not_this_hosts_thread' : 'connector_unavailable'
        )
      }
      return { ...sent.value, place: savedDm ? params.to : target.place }
    }
  }),
  // `orca orchestration worker-start`: where its result should be told, if a later turn wants to.
  defineMethod({
    name: 'connector.wakeReplyPlace',
    permission: 'workspace',
    params: ConnectorWakeReplyPlace,
    handler: async ({ sessionId }, context) => {
      const { runtime } = context
      const bot = runtime.bots.enabled() ? botOfSession(runtime.bots, sessionId) : null
      // Only the chat itself: what this saves lets that chat post.
      if (!bot || sessionCallerOf(context.orchestrationCaller)?.sessionId !== sessionId) {
        return { place: null }
      }
      const target = runtime.getExternalConversationSeam()?.replyTarget(chatPaneKey(sessionId))
      const placed = await wakeReplyPlace(bot.id, target ?? null, () =>
        readBotTurnOrigin(runtime, runtime.getOrchestrationDb(), sessionId).catch(() => null)
      )
      return placed ?? { place: null }
    }
  }),
  CONNECTOR_ACT_METHOD,
  CONNECTOR_REACT_METHOD,
  CONNECTOR_LEAVE_THREAD_METHOD
]
