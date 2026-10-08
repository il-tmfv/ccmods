import { expect, test } from 'claude-code/testing'
import { commandDescription, commandName, globToRegExp, matchesGlobs, parseRule, splitGlobs } from '../hooks/lib'

test('parses globs, description and alwaysApply from frontmatter', () => {
  const rule = parseRule('/p/a.mdc', 'a', '---\nglobs: app/controllers/**/*.rb,app/policies/*.rb\nalwaysApply: false\n---\n# Title\n\nBody\n')
  expect(rule.globs).toEqual(['app/controllers/**/*.rb', 'app/policies/*.rb'])
  expect(rule.isAlways).toBe(false)
  expect(rule.body).toBe('# Title\n\nBody')
})

test('reads a description-only rule and an always rule', () => {
  const lazy = parseRule('/p/b.mdc', 'b', '---\ndescription: Prefer Kaminari\nalwaysApply: false\n---\nUse it')
  expect(lazy.description).toBe('Prefer Kaminari')
  expect(lazy.globs).toEqual([])
  expect(parseRule('/p/c.mdc', 'c', '---\nalwaysApply: true\n---\nx').isAlways).toBe(true)
})

test('reads globs written as a yaml list or an inline array', () => {
  expect(parseRule('/p/d.mdc', 'd', '---\nglobs:\n  - "*.rb"\n  - lib/**\n---\nx').globs).toEqual(['*.rb', 'lib/**'])
  expect(parseRule('/p/e.mdc', 'e', '---\nglobs: ["*.js", "*.ts"]\n---\nx').globs).toEqual(['*.js', '*.ts'])
})

test('a file without frontmatter is all body', () => {
  expect(parseRule('/p/f.mdc', 'f', '# Just text').body).toBe('# Just text')
})

test('does not split commas inside braces', () => {
  expect(splitGlobs('*.{js,ts},*.rb')).toEqual(['*.{js,ts}', '*.rb'])
})

test('a glob without a slash matches the file name at any depth', () => {
  expect(matchesGlobs(['*.rb'], 'app/models/user.rb')).toBe(true)
  expect(matchesGlobs(['*.rb'], 'user.rb')).toBe(true)
  expect(matchesGlobs(['*.rb'], 'user.rbx')).toBe(false)
})

test('a glob with a slash is anchored and * stays inside one directory', () => {
  expect(matchesGlobs(['app/services/*.rb'], 'app/services/pay.rb')).toBe(true)
  expect(matchesGlobs(['app/services/*.rb'], 'app/services/nested/pay.rb')).toBe(false)
  expect(matchesGlobs(['app/services/*.rb'], 'x/app/services/pay.rb')).toBe(false)
})

test('** crosses directories, also when it matches none', () => {
  expect(matchesGlobs(['spec/**/*.rb'], 'spec/a/b/c_spec.rb')).toBe(true)
  expect(matchesGlobs(['spec/**/*.rb'], 'spec/c_spec.rb')).toBe(true)
  expect(matchesGlobs(['spec/**/*.rb'], 'app/c_spec.rb')).toBe(false)
})

test('braces and escaped dots', () => {
  expect(globToRegExp('*.{js,ts}').test('a.ts')).toBe(true)
  expect(globToRegExp('*.{js,ts}').test('a.rb')).toBe(false)
  expect(globToRegExp('a.rb').test('axrb')).toBe(false)
})

test('command names and descriptions', () => {
  expect(commandName('review-pr.md')).toBe('review-pr')
  expect(commandName('bad name.md')).toBeUndefined()
  expect(commandDescription('\n# Review the PR\nmore')).toBe('Review the PR')
})

test('a malformed glob matches nothing and does not hide the others', () => {
  expect(matchesGlobs(['src/{a,b', '*.rb'], 'app/user.rb')).toBe(true)
  expect(matchesGlobs(['src/{a,b'], 'src/a')).toBe(false)
})
