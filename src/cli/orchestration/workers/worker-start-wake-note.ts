// A worker start's note on where it came from, for a later turn that starts on its own (the start
// finished in the background) and so posts nothing by itself. The bot decides whether to post.
import { readInjectedAgentSessionId } from '../../../shared/agent-session/lifecycle/launch/agent-session-caller-env'
import type { RuntimeClient } from '../../runtime/client'
import { orchestrationCliName } from '../agent-view'

type WakeReplyPlace = { place: string | null; to?: string }

/** Null outside a bot chat, from a host that predates it, or when Orca can't prove the place. */
export async function readWorkerStartWakeNote(client: RuntimeClient): Promise<string | null> {
  const sessionId = readInjectedAgentSessionId()
  if (!sessionId) {
    return null
  }
  const answer = await client
    .call<WakeReplyPlace>('connector.wakeReplyPlace', { sessionId })
    .catch(() => null)
  const found = answer?.result
  return found?.place ? formatWorkerStartWakeNote({ place: found.place, to: found.to }) : null
}

export function formatWorkerStartWakeNote(
  { place, to }: { place: string; to?: string },
  cli = orchestrationCliName()
): string {
  const post = to
    ? `${cli} bot reply --to ${to} --text "..." posts in that direct message`
    : `${cli} bot reply --text "..." posts there`
  return `[Orca: this start came from ${place}. A turn that starts on its own when this command finishes in the background stays in Orca; ${post}.]`
}
