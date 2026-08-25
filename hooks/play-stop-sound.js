'use strict';
// Stop hook: pick a sound category for Claude's own last answer, instead of
// always playing "finished". Two layers, in priority order:
//
//   1. Claude self-tags its answer (writes categoryTagPath) as one of its
//      last tool calls in the turn - this is preferred, since it's Claude's
//      own judgment with full context, at zero extra latency/cost (no
//      separate API call).
//   2. If no fresh tag exists, this hook BLOCKS ONCE (via the Stop hook's
//      "decision":"block" response) to give Claude one chance to write it,
//      then - on the guaranteed retry (stop_hook_active=true) - falls back
//      to keyword-matching the transcript so a sound still always plays
//      even if Claude never complies.
//
// See README.md for the full design rationale.

const fs = require('fs');
const path = require('path');
const {
    readHookStdin,
    soundsRoot,
    dataDir,
    writeHookLog,
    playRandomSound,
} = require('./common');

const ALL_CATEGORIES = [
    'confirm_destructive', 'out_of_tokens', 'no_access', 'missing_file',
    'mistake', 'error', 'question', 'bug_fixed', 'bug found', 'fixing',
    'searching bug', 'understood', 'compliment', 'build', 'goodbye', 'finished',
];
const TAG_MAX_AGE_SECONDS = 45;

function tagFilePath() {
    return path.join(dataDir(), 'last-answer-category.json');
}

function readAndConsumeTag() {
    const tagPath = tagFilePath();
    let result = null;
    if (fs.existsSync(tagPath)) {
        try {
            const tag = JSON.parse(fs.readFileSync(tagPath, 'utf-8'));
            const ageSeconds = (Date.now() - new Date(tag.ts).getTime()) / 1000;
            if (ageSeconds <= TAG_MAX_AGE_SECONDS && ALL_CATEGORIES.includes(tag.category)) {
                result = tag.category;
            }
        } catch {}
        try { fs.unlinkSync(tagPath); } catch {}
    }
    return result;
}

function getLastAssistantText(transcriptPath) {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
    let lines;
    try {
        const raw = fs.readFileSync(transcriptPath, 'utf-8');
        const all = raw.split('\n').filter((l) => l.trim() !== '');
        lines = all.slice(-20);
    } catch {
        return null;
    }
    for (let i = lines.length - 1; i >= 0; i--) {
        let entry;
        try { entry = JSON.parse(lines[i]); } catch { continue; }
        if (entry.type !== 'assistant') continue;
        const content = (entry.message && entry.message.content) || [];
        const textBlocks = content.filter((c) => c.type === 'text');
        if (textBlocks.length > 0) {
            return textBlocks.map((b) => b.text).join('\n');
        }
    }
    return null;
}

function stripCodeSpans(text) {
    if (!text) return text;
    return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

function lastParagraph(text) {
    if (!text) return text;
    const paragraphs = text.trim().split(/\r?\n\s*\r?\n/).filter((p) => p.trim() !== '');
    return paragraphs.length > 0 ? paragraphs[paragraphs.length - 1] : text;
}

// Ordered: most specific / safety-relevant signals first, generic ones last.
// "finished" is not listed - it's the fallback when nothing matches.
const CATEGORY_PATTERNS = [
    ['confirm_destructive', [/this will delete/i, /cannot be undone/i, /irreversible/i, /force push/i, /permanently delete/i, /drop table/i]],
    ['out_of_tokens', [/running low on context/i, /out of tokens/i, /need to compact/i, /hitting the limit/i]],
    ['no_access', [/you.ll need to log in/i, /i don.t have access/i, /permission denied/i, /requires your credentials/i, /run this yourself/i]],
    ['missing_file', [/file not found/i, /doesn.t exist/i, /couldn.t find/i, /no such file/i, /path not found/i]],
    ['mistake', [/my mistake/i, /i was wrong/i, /\bsorry\b/i, /my bad/i, /i apologize/i, /i misread/i]],
    ['error', [/\berror\b/i, /\bfailed\b/i, /crashed/i, /exception/i, /something went wrong/i, /build failed/i, /test failed/i]],
    // A live question takes priority over status-report categories below it -
    // if the message both reports progress AND asks something, the question
    // is the more actionable signal.
    ['question', [/\?\s*$/, /would you like/i, /do you want me to/i, /\bwant me to\b/i, /which would you prefer/i, /how do you want/i, /which one/i, /\bshould i\b/i, /could you clarify/i]],
    ['bug_fixed', [/\bfixed\b/i, /\bresolved\b/i, /should fix it/i, /issue resolved/i, /bug is gone/i, /verified the fix/i]],
    ['bug found', [/found the bug/i, /found it\b/i, /root cause/i, /here.s what.s causing/i, /i see the problem/i, /that explains it/i]],
    ['fixing', [/let me fix/i, /fixing now/i, /applying the fix/i, /working on a fix/i, /patching/i]],
    ['searching bug', [/investigating/i, /let me look into/i, /searching for/i, /digging into/i, /looking into the cause/i]],
    ['understood', [/\bgot it\b/i, /\bunderstood\b/i, /\bnoted\b/i, /makes sense/i, /i.ll keep that in mind/i]],
    ['compliment', [/good catch/i, /great idea/i, /nice call/i, /you.re right/i, /good point/i]],
    ['build', [/\bbuilding\b/i, /\bdeploying\b/i, /running the build/i, /\binstalling\b/i, /\bcompiling\b/i]],
    ['goodbye', [/good night/i, /goodbye/i, /good-bye/i, /\bbye\b/i, /see you/i, /talk soon/i, /signing off/i, /take care/i]],
];

function keywordMatch(scanText) {
    if (!scanText) return 'finished';
    for (const [cat, patterns] of CATEGORY_PATTERNS) {
        if (patterns.some((re) => re.test(scanText))) return cat;
    }
    return 'finished';
}

function main() {
    const hookInput = readHookStdin();
    const transcriptPath = hookInput.transcript_path;
    const sessionId = hookInput.session_id;
    const stopHookActive = Boolean(hookInput.stop_hook_active);

    let matched = readAndConsumeTag();
    const source = matched ? 'claude-tag' : 'keyword';

    // No tag, and this is the FIRST stop attempt this turn - give Claude one
    // chance to write the tag instead of silently falling back to guessing.
    // stop_hook_active is Claude Code's own loop-guard: true means we
    // already blocked once for this turn, so never block a second time no
    // matter what - that's what makes this finite.
    if (!matched && !stopHookActive) {
        const reason = `Before finishing, write a sound-category tag: create ${tagFilePath()} containing ` +
            `{"category":"<one of: ${ALL_CATEGORIES.join(', ')}>","ts":"<current ISO8601 timestamp>"} ` +
            `reflecting the actual tone/content of the answer you just gave, then finish normally.`;
        writeHookLog('Stop:blocked-for-tag', '', sessionId, '');
        process.stdout.write(JSON.stringify({ decision: 'block', reason, systemMessage: 'TalkingTurret is thinking about what to say' }));
        process.exit(0);
    }

    let scanText = null;
    if (!matched) {
        let lastText = getLastAssistantText(transcriptPath);
        lastText = stripCodeSpans(lastText);
        scanText = lastParagraph(lastText);
        matched = keywordMatch(scanText);
    }

    const folder = path.join(soundsRoot(), matched);
    playRandomSound(folder);
    writeHookLog('Stop', matched, sessionId, `[${source}] ${scanText || ''}`);
}

main();
