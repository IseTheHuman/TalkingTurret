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

function volumeConfigPath() {
    return path.join(dataDir(), 'volume.json');
}

// One fixed, reused filename (not unique-per-play) so a volume-scaled copy
// can never accumulate - every play overwrites the same file, and it's
// deleted again in playFile's finally block. Worst case (a hard crash mid-
// playback) leaves at most this one file behind, never more.
function volumeScratchPath() {
    return path.join(dataDir(), 'volume-scratch.wav');
}

function getVolume() {
    try {
        const raw = fs.readFileSync(volumeConfigPath(), 'utf-8');
        const v = JSON.parse(raw).volume;
        if (typeof v === 'number' && v >= 0 && v <= 100) return v;
    } catch {}
    return 100;
}

function setVolume(value) {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    fs.writeFileSync(volumeConfigPath(), JSON.stringify({ volume: clamped }), 'utf-8');
    return clamped;
}

// Scales a 16-bit PCM WAV's sample data by `factor` (0..1). Returns null
// (meaning "play unscaled, don't risk corrupting it") for anything that
// isn't plain 16-bit PCM - every file currently in sounds/ is, but this
// guards against a future non-PCM addition being silently mangled.
function scaleWavPcm16(buf, factor) {
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
    let offset = 12;
    let audioFormat = null;
    let bitsPerSample = null;
    let dataOffset = -1;
    let dataSize = 0;
    while (offset + 8 <= buf.length) {
        const id = buf.toString('ascii', offset, offset + 4);
        const size = buf.readUInt32LE(offset + 4);
        if (id === 'fmt ') {
            audioFormat = buf.readUInt16LE(offset + 8);
            bitsPerSample = buf.readUInt16LE(offset + 8 + 14);
        } else if (id === 'data') {
            dataOffset = offset + 8;
            dataSize = size;
        }
        offset += 8 + size + (size % 2);
    }
    if (audioFormat !== 1 || bitsPerSample !== 16 || dataOffset < 0) return null;
    const out = Buffer.from(buf);
    const end = dataOffset + dataSize - (dataSize % 2);
    for (let i = dataOffset; i < end; i += 2) {
        const sample = out.readInt16LE(i);
        out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * factor))), i);
    }
    return out;
}

// Returns [pathToActuallyPlay, scratchPathToDeleteAfterOrNull]. At the
// default volume (100) this is a no-op - zero temp-file activity for
// anyone who never touches the volume command, identical to before this
// feature existed.
function preparePlayback(filePath) {
    const volume = getVolume();
    if (volume >= 100) return [filePath, null];
    try {
        const scaled = scaleWavPcm16(fs.readFileSync(filePath), volume / 100);
        if (!scaled) return [filePath, null];
        const scratchPath = volumeScratchPath();
        fs.writeFileSync(scratchPath, scaled);
        return [scratchPath, scratchPath];
    } catch {
        // Never let a volume-scaling failure block playback - fall back to
        // the original file at full volume rather than staying silent.
        return [filePath, null];
    }
}

function playFile(filePath) {
    // HOOK_SOUND_DRYRUN lets test invocations verify which file/category
    // would be picked without actually playing audio.
    if (process.env.HOOK_SOUND_DRYRUN) return;
    if (!filePath) return;
    const [playPath, scratchPath] = preparePlayback(filePath);
    const platform = process.platform;
    try {
        if (platform === 'win32') {
            // playPath is always plugin-internal (soundsRoot() + a hardcoded
            // or whitelisted category name, or our own volume-scratch file -
            // never external/attacker input), and doubling ' is the complete
            // escaping rule for a PowerShell single-quoted string - no other
            // character is special inside one, so this is not a command-
            // injection vector.
            const psCmd = `(New-Object Media.SoundPlayer '${playPath.replace(/'/g, "''")}').PlaySync()`;
            spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd], { stdio: 'ignore' });
        } else if (platform === 'darwin') {
            spawnSync('afplay', [playPath], { stdio: 'ignore' });
        } else {
            // Linux: no single universal player - try common ones in order,
            // first one found on PATH wins. Silently no-op if none exist.
            const candidates = [
                ['paplay', [playPath]],
                ['aplay', [playPath]],
                ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', playPath]],
            ];
            for (const [cmd, args] of candidates) {
                const check = spawnSync('which', [cmd], { stdio: 'ignore' });
                if (check.status === 0) {
                    spawnSync(cmd, args, { stdio: 'ignore' });
                    break;
                }
            }
        }
    } catch {
    } finally {
        if (scratchPath) {
            try { fs.unlinkSync(scratchPath); } catch {}
        }
    }
}

function playRandomSound(folder) {
    const file = pickRandomWav(folder);
    playFile(file);
    return file;
}

module.exports = {
    readHookStdin, pluginRoot, dataDir, soundsRoot, writeHookLog, playRandomSound,
    ALL_CATEGORIES, tagFilePath, getVolume, setVolume,
};
