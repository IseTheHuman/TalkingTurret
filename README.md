# TalkingTurret

A plugin for Claude. Makes Claude accompany its response by playing a fitting voice-sample of the cute Portal turrets. Also works great as a notification that Claude is waiting on new input.

Instead of one fixed notification sound, this plugin plays a category-appropriate voice line for what Claude is actually doing: starting work, waiting on you, asking a question, hitting an error, signing off, and more.

## ⚠️ Repository status: private, audio rights unresolved

This repo is **private** and should stay that way until the licensing status of the bundled `sounds/` files is resolved. The audio is a set of Portal turret/GLaDOS-style voice lines. Checking [the source wiki page](https://theportalwiki.com/wiki/Turret_voice_lines) directly: its CC BY 4.0 notice covers the wiki's own article text only, **not** the audio files, which remain Valve's copyrighted material with no explicit reuse grant. Do not make this repo public, and do not redistribute `sounds/` elsewhere, until that's sorted out (e.g. a licensed/royalty-free replacement set, or explicit permission).

The code in `hooks/` is separately MIT-licensed (see `LICENSE`) and has no such restriction.

## How it works

Five Claude Code hook events are wired up (`hooks/hooks.json`):

| Event | Trigger | Sound source |
|---|---|---|
| `Notification` (`idle_prompt`) | Claude has been waiting on you for a while | random file from `sounds/waiting/` |
| `Notification` (`permission_prompt`) | Claude needs a permission decision | random file from `sounds/question/` |
| `UserPromptSubmit` | You just submitted a message | random file from `sounds/start thinking/` (also silently primes Claude with the `Stop` sound-tag convention — see below) |
| `PostToolUse` (`AskUserQuestion`) | Claude asked a structured multiple-choice question | random file from `sounds/start thinking/` |
| `Stop` | Claude finished a turn | category chosen dynamically — see below |

### `Stop`: how the category is chosen

A single fixed "finished" sound for every turn ending turned out to feel wrong most of the time (saying goodbye but hearing a generic "done" chime, etc.), so `Stop` picks from the full category list using two layers:

1. **Claude self-tags its own answer.** Near the end of a turn, Claude writes a small JSON file — `{"category":"<name>","ts":"<now>"}` — to `${CLAUDE_PLUGIN_DATA}/last-answer-category.json`, reflecting what it actually just said. This is a normal tool call (not visible clutter in the answer), costs no extra API call, and is far more accurate than any keyword heuristic since it's Claude's own judgment with full context.
2. **Priming, not blocking.** `play-userpromptsubmit-sound.js` teaches Claude the tag convention fresh on *every* turn, via `hookSpecificOutput.additionalContext` on `UserPromptSubmit` — this reaches Claude's context but is never printed to your terminal (confirmed empirically; unlike a `Stop`-hook `{"decision":"block","reason":...}`, which *always* echoes as a visible "Ran 1 stop hook" entry, no matter how short the text). The injected instruction also explicitly tells Claude not to mention the tag/instruction in its visible reply, since you never asked about it. An earlier version blocked `Stop` once to force a retry when Claude forgot; priming every turn made that retry — and its unavoidable terminal output — unnecessary. If Claude still doesn't self-tag, `Stop` falls back silently (no output at all) to keyword-matching the last paragraph of Claude's actual response text (with backtick-quoted code spans stripped, so mentioning a category name as a technical term doesn't false-positive as that category).

If nothing fits, the tag/fallback both land on `finished` — that's a legitimate category, not an omission.

### Categories

`bug found`, `bug_fixed`, `build`, `compliment`, `confirm_destructive`, `error`, `finished`, `fixing`, `goodbye`, `missing_file`, `mistake`, `no_access`, `out_of_tokens`, `question`, `searching bug`, `start thinking`, `thinking`, `understood`, `waiting`, `welcome` — folder names under `sounds/`. `thinking` is reserved for when you explicitly ask if Claude is still working; it's not automatically triggered by any hook.

### Cross-platform sound playback

`hooks/common.js` detects `process.platform` and shells out to the native player: `SoundPlayer` via PowerShell on Windows, `afplay` on macOS, and the first of `paplay`/`aplay`/`ffplay` found on `PATH` on Linux. All hook scripts are plain Node.js (no external npm dependencies) so `${CLAUDE_PLUGIN_ROOT}` + `node <script>` works identically on every platform — the only thing that differs is what `common.js` shells out to.

Runtime state (the tag file, the fire-activity log) lives under `${CLAUDE_PLUGIN_DATA}` — the plugin's persistent data directory — not under `${CLAUDE_PLUGIN_ROOT}`, which is treated as read-only bundled content that may be replaced on update.

## Installing (while private)

Not on a marketplace yet (see rights status above). To use it yourself:

```bash
git clone https://github.com/IseTheHuman/TalkingTurret.git ~/.claude/skills/talking-turret
```

Claude Code auto-discovers a plugin placed in `~/.claude/skills/<name>/` (containing `.claude-plugin/plugin.json`) with no separate install step.

## Debugging / auditing

Every hook firing is logged to `${CLAUDE_PLUGIN_DATA}/hook-fire-log.jsonl` (timestamp, event, category, session ID, and either the matched sound file or the text snippet that was matched). Set the `HOOK_SOUND_DRYRUN` environment variable to any value to test a hook script without actually playing audio (still logs normally).
