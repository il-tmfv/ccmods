import { expect, mock, test } from 'claude-code/testing'

const ROOT = '/proj'
const HOME = '/home/me'
const FILES: Record<string, string> = {
  [`${ROOT}/.cursor/rules/services.mdc`]: '---\nglobs: app/services/*.rb\nalwaysApply: false\n---\nUse dry-monads.',
  [`${ROOT}/.cursor/rules/style.mdc`]: '---\nalwaysApply: true\n---\nAlways be terse.',
  [`${ROOT}/.cursor/rules/pagination.mdc`]: '---\ndescription: Prefer Kaminari\nalwaysApply: false\n---\nUse Kaminari.',
  [`${ROOT}/.cursor/commands/review.md`]: '# Review the diff\n\nReview the current diff.',
  [`${HOME}/.cursor/commands/review.md`]: 'user-level, must lose to the project one',
  [`${HOME}/.cursor/commands/ship.md`]: 'Ship it.',
}

function entriesOf(dir: string) {
  const names = new Set<string>()
  for (const path of Object.keys(FILES)) {
    if (path.startsWith(dir + '/')) names.add(path.slice(dir.length + 1).split('/')[0])
  }
  return [...names].map(name => {
    const kind = FILES[`${dir}/${name}`] === undefined ? 'dir' : 'file'
    return { name, kind, size: 1, mtimeMs: 1, isLink: false }
  })
}

function stubFs(on: (name: string, hook: (...args: any[]) => unknown) => unknown, submitted: string[] = [], broken: string[] = []) {
  on('session.root', () => ({ value: ROOT }))
  on('env.get', () => ({ value: HOME }))
  on('fs.exists', ($: unknown, e: { path: string }) => ({ value: entriesOf(e.path).length > 0 }))
  on('fs.list', ($: unknown, e: { path: string }) => {
    if (broken.includes(e.path)) throw new Error('EACCES')
    return { value: entriesOf(e.path) }
  })
  on('fs.read', ($: unknown, e: { path: string }) => {
    if (broken.includes(e.path)) throw new Error('EACCES')
    return { value: FILES[e.path] ?? '' }
  })
  on('command.register', () => ({ value: undefined }))
  on('prompt.submit', ($: unknown, e: { text: string }) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('tool.call', () => ({ result: 'ok' }))
  on('prompt.context', () => ({ blocks: [] }))
  on('session.start', () => ({ cwd: ROOT }))
}

test('a matching Read hands the glob rule to Claude once', async ($, on) => {
  stubFs(on)
  const first = await $.tool.call({ tool: 'Read', file_path: `${ROOT}/app/services/pay.rb` })
  expect(first.context?.[0]).toContain('Use dry-monads.')
  const second = await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/app/services/pay.rb`, old_string: 'a', new_string: 'b' })
  expect(second.context).toBeUndefined()
})

test('a file no glob matches gets no context', async ($, on) => {
  stubFs(on)
  const ran = await $.tool.call({ tool: 'Read', file_path: `${ROOT}/app/models/user.rb` })
  expect(ran.context).toBeUndefined()
})

test('always rules and the description index go into the first message', async ($, on) => {
  stubFs(on)
  const context = await $.prompt.context({ blocks: [] })
  const text = context.blocks.find((block: { name: string }) => block.name === 'cursorRules')?.text ?? ''
  expect(text).toContain('Always be terse.')
  expect(text).toContain('Prefer Kaminari')
  expect(text).not.toContain('Use dry-monads.')
})

test('a cursor command runs as a prompt, project before user, with args appended', async ($, on) => {
  const submitted: string[] = []
  stubFs(on, submitted)
  const clock = mock.clock(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })
  await $.command.run({ command: 'review', args: 'PR 12' })
  await $.command.run({ command: 'ship', args: '' })
  await clock.advance(1)
  expect(submitted[0]).toBe('# Review the diff\n\nReview the current diff.\n\nPR 12')
  expect(submitted[1]).toBe('Ship it.')
})

test('an unreadable rule file does not hide the other rules', async ($, on) => {
  stubFs(on, [], [`${ROOT}/.cursor/rules/pagination.mdc`])
  const context = await $.prompt.context({ blocks: [] })
  const text = context.blocks.find((block: { name: string }) => block.name === 'cursorRules')?.text ?? ''
  expect(text).toContain('Always be terse.')
  expect(text).not.toContain('Prefer Kaminari')
})

test('an unreadable user commands directory does not stop the project commands', async ($, on) => {
  const submitted: string[] = []
  stubFs(on, submitted, [`${HOME}/.cursor/commands`])
  const clock = mock.clock(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: ROOT })
  await $.command.run({ command: 'review', args: '' })
  await clock.advance(1)
  expect(submitted[0]).toBe('# Review the diff\n\nReview the current diff.')
})
