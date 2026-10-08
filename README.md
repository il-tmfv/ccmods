# ccmods

Personal [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview), shipped as a plugin marketplace.

A mod is code that runs inside Claude Code with your permissions. Read a mod's source before you install it.

## Install

Needs Claude Code v2.1.287 or later (`claude --version`).

1. Add the marketplace (once per machine):

   ```bash
   claude plugin marketplace add il-tmfv/ccmods
   ```

2. Install a mod for every project on this machine:

   ```bash
   claude plugin install cursor-rules@ccmods --scope user
   ```

3. Restart Claude Code, or run `/reload-plugins` in an open session.

4. Check: `claude plugin list` shows `cursor-rules@ccmods` as enabled.

Inside a session the same thing is `/plugin marketplace add il-tmfv/ccmods`, then `/plugin install cursor-rules@ccmods`.

### Update

```bash
claude plugin marketplace update ccmods
claude plugin update cursor-rules@ccmods
```

### Try without installing

```bash
git clone git@github.com:il-tmfv/ccmods.git
claude --plugin-dir ccmods/plugins/cursor-rules
```

## Mods

### cursor-rules

Makes Claude Code read what a repo keeps for Cursor, with no converter and nothing to keep in sync. Files are read from disk, so an edited rule applies at once.

| Cursor | What Claude Code gets |
| --- | --- |
| `.cursor/rules/*.mdc` with `alwaysApply: true` | The rule text in the first message of each conversation |
| `.cursor/rules/*.mdc` with `globs` | The rule text, attached to the result of the first `Read`, `Edit` or `Write` of a matching file. It arrives after the tool has run, so a `Write` of a new file with no earlier `Read` sees the rule only afterward |
| `.cursor/rules/*.mdc` with only `description` | A one-line index in the first message. Claude opens the file when the task matches |
| `.cursor/commands/*.md` in the project | A `/name` slash command that sends the file as your prompt. Text after the name is appended |
| `~/.cursor/commands/*.md` | The same, in every project. A project command wins over a user one with the same name |

Details:

- Globs follow Cursor: `*.rb` matches the file name at any depth, `app/services/*.rb` is anchored to the project root, `**` crosses directories, `{a,b}` works.
- Frontmatter is stripped. Only the rule body reaches Claude.
- After `/clear` or a compaction, glob rules are handed over again on the next matching file.
- Rules are read from `.cursor/rules/` at the session root, up to three directories deep. Rules in nested `.cursor/rules/` folders of a monorepo are not read.
- New command files appear after `/reload-plugins` or a restart. Edits to an existing command apply immediately.
- A command whose name is taken by a built-in or native command is skipped.

## Develop

```bash
cd plugins/cursor-rules
claude plugin validate .
claude plugin test
```

Run against a real project without installing: `claude --plugin-dir plugins/cursor-rules`.

## Add a mod

1. Create `plugins/<name>/` with `.claude-plugin/plugin.json` and `hooks/hooks.json`.
2. Add an entry to `.claude-plugin/marketplace.json`.
3. Run `claude plugin validate .` in the repo root.
