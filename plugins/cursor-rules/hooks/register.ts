import type { EngineInterface, Register } from 'claude-code'
import { commandDescription, commandName, matchesGlobs, parseRule, splitFrontmatter, type Rule } from './lib'

const RULE_FILE = /\.mdc?$/
const MAX_DEPTH = 3

// Parsed rules by path, reparsed when the file's mtime changes
const cache = new Map<string, { mtimeMs: number; rule: Rule }>()
// Rules already handed to Claude in this conversation
const applied = new Set<string>()
// Slash command name to the Cursor command file behind it
const commands = new Map<string, string>()

async function loadRules($: EngineInterface, dir: string, depth = 0): Promise<Rule[]> {
  if (depth === 0 && !(await $.fs.exists(dir))) return []
  const rules: Rule[] = []
  for (const entry of await $.fs.list(dir)) {
    const path = `${dir}/${entry.name}`
    if (entry.kind === 'dir' && depth < MAX_DEPTH) {
      rules.push(...(await loadRules($, path, depth + 1)))
    } else if (entry.kind === 'file' && RULE_FILE.test(entry.name)) {
      const cached = cache.get(path)
      if (cached !== undefined && cached.mtimeMs === entry.mtimeMs) {
        rules.push(cached.rule)
        continue
      }
      const rule = parseRule(path, entry.name.replace(RULE_FILE, ''), await $.fs.read(path))
      cache.set(path, { mtimeMs: entry.mtimeMs, rule })
      rules.push(rule)
    }
  }
  return rules
}

function render(rule: Rule, root: string): string {
  const where = rule.globs.length > 0 ? ` (applies to ${rule.globs.join(', ')})` : ''
  return `Cursor rule "${rule.name}"${where}, from ${rule.path.replace(root + '/', '')}:\n\n${rule.body}`
}

export const register: Register = on => {
  // Rules that are always on, plus a one-line index of rules Claude may open on its own
  on('prompt.context', async ($, e, next) => {
    const base = await next(e)
    try {
      const root = await $.session.root()
      const rules = await loadRules($, `${root}/.cursor/rules`)
      const always = rules.filter(rule => rule.isAlways && rule.body !== '')
      const optional = rules.filter(rule => !rule.isAlways && rule.globs.length === 0 && rule.description !== '')
      const parts = always.map(rule => render(rule, root))
      if (optional.length > 0) {
        const index = optional.map(rule => `- ${rule.path.replace(root + '/', '')}: ${rule.description}`)
        parts.push('Cursor rules to read when the task matches their description:\n' + index.join('\n'))
      }
      if (parts.length === 0) return base
      for (const rule of always) applied.add(rule.path)
      return { ...base, blocks: [...base.blocks, { name: 'cursorRules', text: parts.join('\n\n---\n\n') }] }
    } catch {
      return base
    }
  }).catch(($, e, next) => next(e))

  // Glob rules load the first time Claude touches a matching file, as native path rules do
  on('tool.call', { tool: ['Read', 'Edit', 'Write'] }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    try {
      const root = await $.session.root()
      if (!e.file_path.startsWith(root + '/')) return ran
      const relative = e.file_path.slice(root.length + 1)
      const rules = await loadRules($, `${root}/.cursor/rules`)
      const hits = rules.filter(
        rule => rule.globs.length > 0 && !applied.has(rule.path) && rule.body !== '' && matchesGlobs(rule.globs, relative),
      )
      if (hits.length === 0) return ran
      for (const rule of hits) applied.add(rule.path)
      return { ...ran, context: [...(ran.context ?? []), ...hits.map(rule => render(rule, root))] }
    } catch {
      return ran
    }
  }).catch(($, e, next) => next(e))

  // After /clear or a compaction Claude no longer holds the rules, so hand them over again
  on('session.end', ($, e, next) => {
    applied.clear()
    return next(e)
  })
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    applied.clear()
    return result
  }).catch(($, e, next) => next(e))

  // Every .cursor/commands/*.md becomes a slash command; the project's win over the user's
  on('session.start', async ($, e, next) => {
    const home = await $.env.get('HOME')
    const dirs = [`${await $.session.root()}/.cursor/commands`, ...(home === undefined ? [] : [`${home}/.cursor/commands`])]
    commands.clear()
    for (const dir of dirs) {
      if (!(await $.fs.exists(dir))) continue
      for (const entry of await $.fs.list(dir)) {
        const name = commandName(entry.name)
        if (entry.kind !== 'file' || !entry.name.endsWith('.md') || name === undefined || commands.has(name)) continue
        try {
          const { body } = splitFrontmatter(await $.fs.read(`${dir}/${entry.name}`))
          await $.command.register({ name, description: commandDescription(body) })
          commands.set(name, `${dir}/${entry.name}`)
        } catch {
          // The name is taken by a built-in or native command, or the file can't be read
        }
      }
    }
    return next(e)
  })

  on('command.run', async ($, e, next) => {
    const file = commands.get(e.command)
    if (file === undefined) return next(e)
    const { body } = splitFrontmatter(await $.fs.read(file))
    const args = e.args.trim()
    const text = args === '' ? body.trim() : `${body.trim()}\n\n${args}`
    // The host refuses a submit from inside command.run, which holds the turn; a timer's dispatch is a later one
    $.clock.after(0, () => $.prompt.submit({ text, asUser: true }))
    return {}
  }).catch(($, e, next) => next(e))
}
