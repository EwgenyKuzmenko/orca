import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { slackReplyBody } from '../../main/connector-cloud/connector-slack-text'
import { replyWithHtmlPages } from './bot-reply-html-pages'

it('shortens local paths in generated Slack files just as in inline replies', async () => {
  const path = ['', 'Users', 'example', 'project', 'file.ts'].join('/')
  const page = (name: string) =>
    `<!doctype html>\n<html><head><title>${name}</title></head><body><p>Open ${name}.</p></body></html>`
  const reply = (name: string) => `Here is the report.\n\n\`\`\`html\n${page(name)}\n\`\`\``
  const text = reply(path)
  const expected = page('file.ts')
  expect(slackReplyBody({ conversation: { source: 'slack' }, text }).text).toBe(reply('file.ts'))

  const staged: { name: string; size: number; contents: string }[] = []
  const uploaded = await replyWithHtmlPages(
    text,
    async (files) => {
      for (const file of files) {
        staged.push({
          name: file.name,
          size: file.size,
          contents: await readFile(file.path, 'utf8')
        })
      }
      return ['staged-id']
    },
    async (files, text) => ({ files, text })
  )

  expect(staged).toEqual([
    { name: 'file-ts.html', size: Buffer.byteLength(expected), contents: expected }
  ])
  expect(uploaded).toEqual({
    files: 1,
    sent: { files: ['staged-id'], text: 'Here is the report.' }
  })
})
