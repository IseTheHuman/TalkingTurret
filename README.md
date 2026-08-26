# TalkingTurret

A plugin that gives Claude Code a soul. Makes Claude accompany its response with voice-sample from the portal games. Also works great as an audible notification when Claude is waiting on new input.

The voice lines feature mainly Portal's turrets, with some GLaDOS sprinkled in occasionally, sourced from [the Portal Wiki's Voice lines page](https://theportalwiki.com/wiki/Voice_lines).

## Installation

**Prerequisites:** [Claude Code](https://claude.com/claude-code) itself (which bundles Node.js, used to run the hook scripts) and `git`. No npm packages, no build step.

```bash
git clone https://github.com/IseTheHuman/TalkingTurret.git ~/.claude/skills/talking-turret
```

That's it — Claude Code auto-discovers any plugin placed under `~/.claude/skills/<name>/` (containing a `.claude-plugin/plugin.json`) with no separate `/plugin install` step. **Restart Claude Code (start a new session)** for it to take effect — plugins are only loaded at session start, so an already-running session won't pick it up.

Verify it's loaded:

```bash
claude plugin list
```

You should see `talking-turret@skills-dir` listed under "Skills-directory plugins" with status `loaded`.

**If you already have your own personal sound hooks** wired up directly in `~/.claude/settings.json` (rather than through this plugin), remove those entries first — otherwise every event fires twice, once from each source.

**To update:** `git pull` inside `~/.claude/skills/talking-turret`, then restart.

**To uninstall:** delete the `~/.claude/skills/talking-turret` folder, then restart.

## Compatibility

| Setup | Works? | Notes |
|---|---|---|
| Windows 10/11 | ✅ Yes | Uses `System.Media.SoundPlayer` via PowerShell (built into every supported Windows version). |
| macOS | ✅ Yes | Uses `afplay` (built-in, no install needed). |
| Linux desktop (Ubuntu, Fedora, etc.) | ✅ Usually | Uses whichever of `paplay`, `aplay`, or `ffplay` is found on `PATH`, in that order. Most desktop distros ship at least one out of the box. |
| Linux minimal/server distro with no audio player installed | ⚠️ Silent no-op | The hook runs, logs the pick, but plays nothing — by design, so a missing player never errors or blocks a turn. Install `pulseaudio-utils` (`paplay`) or `alsa-utils` (`aplay`) to fix. |
| **Remote/SSH sessions, cloud VMs, devcontainers, CI runners, Codespaces** | ❌ No (by design of how hooks work) | A hook's shell command runs wherever the **Claude Code process** runs — on a remote machine, that's the remote machine, not your local speakers. There's no built-in audio relay back to your local device. If you're SSH'd into a headless server, you will not hear anything, even if the plugin loads and "works" correctly on that end. |
| WSL (Windows Subsystem for Linux) | ⚠️ Depends | Needs WSLg's audio passthrough (Windows 11, enabled by default in recent versions) or manually configured PulseAudio-over-network forwarding to reach your Windows speakers. Not guaranteed out of the box on older WSL setups. |
| Multiple concurrent Claude Code sessions on one machine | ⚠️ Works, but sounds are unattributed | All sessions share the same system audio output — you can't tell which session made a given sound just by ear. `${CLAUDE_PLUGIN_DATA}/hook-fire-log.jsonl` records the session ID per firing if you need to check after the fact. |

## How it works

Nine Claude Code hook triggers are wired up (`hooks/hooks.json`):

| Event | Trigger | Sound source |
|---|---|---|
| `SessionStart` | A session opens (startup, resume, or `/clear`) - not on `/compact`, since that fires mid-session rather than at an actual open | random file from `sounds/welcome/` |
| `PreCompact` | Claude Code is about to compact the conversation (manual `/compact` or automatic when context fills up) | random file from `sounds/compact/` |
| `Notification` (`idle_prompt`) | Claude has been waiting on you for a while | random file from `sounds/waiting/` |
| `Notification` (`permission_prompt`) | Claude needs a permission decision | random file from `sounds/question/` |
| `Notification` (`quota_auto_resume_disabled`) | Claude Code gave up trying to auto-resume after a usage/session limit | random file from `sounds/out_of_tokens/` |
| `UserPromptSubmit` | You just submitted a message | random file from `sounds/start thinking/` (also silently primes Claude with the `Stop` sound-tag convention — see below) |
| `PostToolUse` (`AskUserQuestion`) | Claude asked a structured multiple-choice question | random file from `sounds/start thinking/` |
| `PostToolUse` (`Bash`) | The executed command was a test-runner invocation (`npm test`, `jest`, `pytest`, `cargo test`, etc. — detected from the actual `tool_input.command`, not from Claude's answer text) | random file from `sounds/testing/` |
| `Stop` | Claude finished a turn | category chosen dynamically — see below |

### `Stop`: how the category is chosen

A single fixed "finished" sound for every turn ending turned out to feel wrong most of the time (saying goodbye but hearing a generic "done" chime, etc.), so `Stop` picks from the full category list using two layers:

1. **Claude self-tags its own answer.** Near the end of a turn, Claude writes a small JSON file — `{"category":"<name>","ts":"<now>"}` — to `${CLAUDE_PLUGIN_DATA}/last-answer-category.json`, reflecting what it actually just said. This is a normal tool call (not visible clutter in the answer), costs no extra API call, and is far more accurate than any keyword heuristic since it's Claude's own judgment with full context.
2. **Priming, not blocking.** `play-userpromptsubmit-sound.js` teaches Claude the tag convention fresh on *every* turn, via `hookSpecificOutput.additionalContext` on `UserPromptSubmit` — this reaches Claude's context but is never printed to your terminal (confirmed empirically across several rendering options; see "A note on the design history" below). The injected instruction also explicitly tells Claude not to mention the tag/instruction in its visible reply, since you never asked about it. An earlier version instead blocked `Stop` once via `{"decision":"block","reason":...}` to force a retry when Claude forgot to self-tag — but that construct *always* echoes as a visible "Ran 1 stop hook" entry in your terminal, no matter how short the text, so priming every turn replaced it. If Claude still doesn't self-tag, `Stop` falls back silently (no output at all) to keyword-matching the last paragraph of Claude's actual response text (with backtick-quoted code spans stripped, so mentioning a category name as a technical term doesn't false-positive as that category).

If nothing fits, the tag/fallback both land on `finished` — that's a legitimate category, not an omission.

#### A note on the design history

Earlier iterations tried to keep the `Stop`-hook block but make its output less obtrusive: a short `reason` alongside a long `systemMessage`, then the reverse, then splitting the full instructions into `hookSpecificOutput.additionalContext` hoping it was Claude-only, then a `suppressOutput: true` flag. Confirmed live, one at a time: `{"decision":"block","reason":...}` always prints (first framed as an "error", later just as "Stop hook feedback"); `additionalContext` on `Stop` *also* always prints, despite docs suggesting otherwise; `systemMessage` on `Stop` renders separately as a calm one-line "Stop says: ..." but doesn't make Claude continue on its own, so it can't replace the block. `additionalContext` on `UserPromptSubmit`, by contrast, never printed anything across repeated tests — which is why priming moved there instead of trying to make the `Stop` block quieter.

### Categories

`bug found`, `bug_fixed`, `build`, `compact`, `compliment`, `confirm_destructive`, `error`, `finished`, `fixing`, `goodbye`, `milestone_reached`, `missing_file`, `mistake`, `no_access`, `out_of_tokens`, `question`, `searching bug`, `start thinking`, `testing`, `thinking`, `understood`, `waiting`, `welcome` — folder names under `sounds/`. `milestone_reached` is for a great success or milestone, distinct from the smaller-scale `compliment`/`bug_fixed`. `thinking` is reserved for when you explicitly ask if Claude is still working; it's not automatically triggered by any hook. `testing` is auto-triggered by `PostToolUse` (`Bash`) whenever the executed command is a test-runner invocation, and `compact` by `PreCompact` — see the hook table above — neither is part of the `Stop`-hook self-tag/keyword system. `welcome` is triggered by `SessionStart` *and* is self-taggable/keyword-matched at `Stop` — if a session's first message is just a greeting, Claude's reply to it can be tagged `welcome` too.

### Cross-platform sound playback

`hooks/common.js` detects `process.platform` and shells out to the native player per the compatibility table above. All hook scripts are plain Node.js (no external npm dependencies), so `${CLAUDE_PLUGIN_ROOT}` + `node <script>` works identically on every platform — the only thing that differs is what `common.js` shells out to.

Runtime state (the tag file, the fire-activity log) lives under `${CLAUDE_PLUGIN_DATA}` — the plugin's persistent data directory — not under `${CLAUDE_PLUGIN_ROOT}`, which is treated as read-only bundled content that may be replaced on update.

## Debugging / auditing

Every hook firing is logged to `${CLAUDE_PLUGIN_DATA}/hook-fire-log.jsonl` (timestamp, event, category, session ID, and either the matched sound file or the text snippet that was matched). Set the `HOOK_SOUND_DRYRUN` environment variable to any value to test a hook script without actually playing audio (still logs normally).

## Known limitations

- **No remote audio relay** (see compatibility table) — this is a fundamental constraint of how hook commands execute, not something fixable in this plugin alone.
- **Self-tagging compliance isn't perfect** — the `UserPromptSubmit` priming makes Claude self-tag reliably in practice, but isn't a hard guarantee; the silent keyword-match fallback is what keeps a sound playing even on the rare turn it forgets, possibly with a less accurate category.
- **No per-session audio isolation** — see compatibility table.
