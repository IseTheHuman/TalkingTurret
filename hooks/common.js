'use strict';
// Shared helpers for all hook scripts. Cross-platform (Windows/macOS/Linux) -
// this is why the hooks are Node.js rather than PowerShell: Node ships with
// Claude Code itself, so it's guaranteed present regardless of OS, whereas a
// single hooks.json can't branch its `command` string per platform.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function readHookStdin() {
    try {
        const raw = fs.readFileSync(0, 'utf-8');
        if (!raw) return {};
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function pluginRoot() {
    return process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
}

function dataDir() {
    // CLAUDE_PLUGIN_DATA is the persistent, writable per-plugin directory
    // (survives plugin updates) - runtime state (the tag file, the fire
    // log) belongs here, NOT under CLAUDE_PLUGIN_ROOT, which is treated as
    // the plugin's static bundled content and may not be writable/durable.
    const dir = process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'claude-voice-notifications-data');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    return dir;
}

function soundsRoot() {
    return path.join(pluginRoot(), 'sounds');
}

// Shared between play-userpromptsubmit-sound.js (primes Claude with the tag
// convention on every turn, silently) and play-stop-sound.js (reads back
// whatever tag Claude wrote, falling back to keyword-matching if none).
// Deliberately does NOT include categories owned by other hooks - "start
// thinking"/"testing"/"compact" are each triggered directly by their own
// event (UserPromptSubmit/PostToolUse/PreCompact), and "thinking" is
// reserved/manual-only - none of the four are things Claude should be able
// to self-tag an ordinary answer as. "welcome" IS included below, despite
// also being SessionStart-triggered: if the user's first message is just a
// greeting, Claude's reply to it should be self-taggable as "welcome" too.
const ALL_CATEGORIES = [
    'confirm_destructive', 'out_of_tokens', 'no_access', 'missing_file',
    'mistake', 'error', 'question', 'bug_fixed', 'bug found', 'fixing',
    'searching bug', 'understood', 'compliment', 'build', 'goodbye', 'finished',
    'welcome', 'milestone_reached',
];

function tagFilePath() {
    return path.join(dataDir(), 'last-answer-category.json');
}

function writeHookLog(eventName, category, sessionId, snippet) {
    try {
        const logPath = path.join(dataDir(), 'hook-fire-log.jsonl');
        let s = snippet || '';
        if (s.length > 300) s = s.slice(0, 300);
        const entry = {
            ts: new Date().toISOString(),
            event: eventName,
            category: category || '',
            sessionId: sessionId || '',
            snippet: s,
        };
        fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {}
}

function pickRandomWav(folder) {
    try {
        const files = fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.wav'));
        if (files.length === 0) return null;
        const pick = files[Math.floor(Math.random() * files.length)];
        return path.join(folder, pick);
    } catch {
        return null;
    }
}

function playFile(filePath) {
    // HOOK_SOUND_DRYRUN lets test invocations verify which file/category
    // would be picked without actually playing audio.
    if (process.env.HOOK_SOUND_DRYRUN) return;
    if (!filePath) return;
    const platform = process.platform;
    try {
        if (platform === 'win32') {
            // filePath is always plugin-internal (soundsRoot() + a hardcoded
            // or whitelisted category name, never external/attacker input),
            // and doubling ' is the complete escaping rule for a PowerShell
            // single-quoted string - no other character is special inside
            // one, so this is not a command-injection vector.
            const psCmd = `(New-Object Media.SoundPlayer '${filePath.replace(/'/g, "''")}').PlaySync()`;
            spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd], { stdio: 'ignore' });
        } else if (platform === 'darwin') {
            spawnSync('afplay', [filePath], { stdio: 'ignore' });
        } else {
            // Linux: no single universal player - try common ones in order,
            // first one found on PATH wins. Silently no-op if none exist.
            const candidates = [
                ['paplay', [filePath]],
                ['aplay', [filePath]],
                ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', filePath]],
            ];
            for (const [cmd, args] of candidates) {
                const check = spawnSync('which', [cmd], { stdio: 'ignore' });
                if (check.status === 0) {
                    spawnSync(cmd, args, { stdio: 'ignore' });
                    break;
                }
            }
        }
    } catch {}
}

function playRandomSound(folder) {
    const file = pickRandomWav(folder);
    playFile(file);
    return file;
}

module.exports = {
    readHookStdin, pluginRoot, dataDir, soundsRoot, writeHookLog, playRandomSound,
    ALL_CATEGORIES, tagFilePath,
};
