export type Rule = {
  name: string
  path: string
  description: string
  globs: string[]
  isAlways: boolean
  body: string
}

// Splits on commas outside braces, so `*.{js,ts},*.rb` is two globs
export function splitGlobs(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of value) {
    if (ch === '{') depth++
    if (ch === '}') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts.map(unquote).filter(part => part !== '')
}

function unquote(value: string): string {
  const trimmed = value.trim()
  return /^(['"]).*\1$/.test(trimmed) ? trimmed.slice(1, -1).trim() : trimmed
}

export function splitFrontmatter(text: string): { meta: Record<string, string | string[]>; body: string } {
  const source = text.replace(/\r\n/g, '\n')
  if (!source.startsWith('---\n')) return { meta: {}, body: source }
  const end = source.indexOf('\n---', 4)
  if (end === -1) return { meta: {}, body: source }
  const header = source.slice(4, end)
  const body = source.slice(end + 4).replace(/^[^\n]*\n?/, '')
  const meta: Record<string, string | string[]> = {}
  let listKey: string | undefined
  for (const line of header.split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item && listKey) {
      const list = meta[listKey]
      if (Array.isArray(list)) list.push(unquote(item[1]))
      continue
    }
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!pair) continue
    if (pair[2] === '') {
      meta[pair[1]] = []
      listKey = pair[1]
    } else {
      meta[pair[1]] = unquote(pair[2])
      listKey = undefined
    }
  }
  return { meta, body }
}

export function parseRule(path: string, name: string, text: string): Rule {
  const { meta, body } = splitFrontmatter(text)
  const rawGlobs = meta.globs
  let globs: string[] = []
  if (Array.isArray(rawGlobs)) globs = rawGlobs
  else if (typeof rawGlobs === 'string') globs = splitGlobs(rawGlobs.replace(/^\[(.*)\]$/, '$1'))
  const description = typeof meta.description === 'string' ? meta.description : ''
  return {
    name,
    path,
    description,
    globs,
    isAlways: meta.alwaysApply === 'true',
    body: body.trim(),
  }
}

const SPECIAL = /[.+^$()|[\]\\]/

export function globToRegExp(glob: string): RegExp {
  let source = ''
  let depth = 0
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        source += '(?:.*/)?'
        i += 2
      } else {
        source += '.*'
        i += 1
      }
    } else if (ch === '*') source += '[^/]*'
    else if (ch === '?') source += '[^/]'
    else if (ch === '{') {
      depth++
      source += '(?:'
    } else if (ch === '}' && depth > 0) {
      depth--
      source += ')'
    } else if (ch === ',' && depth > 0) source += '|'
    else if (SPECIAL.test(ch)) source += '\\' + ch
    else source += ch
  }
  // Like Cursor: a glob without a slash matches the file name at any depth
  const prefix = glob.includes('/') ? '^' : '(?:^|/)'
  return new RegExp(prefix + source + '$')
}

export function matchesGlobs(globs: readonly string[], relativePath: string): boolean {
  return globs.some(glob => {
    try {
      return globToRegExp(glob.replace(/^\.?\//, '')).test(relativePath)
    } catch {
      // A malformed glob (say an unclosed `{`) matches nothing instead of failing the whole lookup
      return false
    }
  })
}

export function commandDescription(body: string): string {
  const first = body.split('\n').map(line => line.replace(/^#+\s*/, '').trim()).find(line => line !== '')
  return first === undefined ? 'Cursor command' : first.slice(0, 100)
}

export function commandName(file: string): string | undefined {
  const name = file.replace(/\.md$/, '')
  return /^[A-Za-z0-9_-]{1,64}$/.test(name) ? name : undefined
}
