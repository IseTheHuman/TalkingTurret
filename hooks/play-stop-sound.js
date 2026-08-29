'use strict';
// Stop hook: pick a sound category for Claude's own last answer, instead of
// always playing "finished". Two layers, in priority order:
//
//   1. Claude self-tags its answer (writes the tag file) as one of its last
//      tool calls in the turn - this is preferred, since it's Claude's own
//      judgment with full context, at zero extra latency/cost (no separate
//      API call). play-userpromptsubmit-sound.js primes this convention on
//      every turn via a silent (non-visible-to-user) additionalContext.
//   2. If no fresh tag exists, this hook falls back to keyword-matching the
//      transcript, silently - no JSON/stdout output, so nothing ever prints
//      to the user's terminal. (An earlier version blocked once via the
//      Stop hook's "decision":"block" to force a retry, but that always
//      echoed something visible in the terminal; priming every turn via
//      UserPromptSubmit instead made that retry unnecessary.)
//
// See README.md for the full design rationale.

const fs = require('fs');
const path = require('path');
const {
    readHookStdin,
    soundsRoot,
    writeHookLog,
    playRandomSound,
    ALL_CATEGORIES,
    tagFilePath,
    awaitingInputStatePath,
    isSubagentEvent,
} = require('./common');

const TAG_MAX_AGE_SECONDS = 45;

// Persists just the awaitingInput verdict to its own small file that
// play-idle-sound.js can still read later, since the tag file itself is
// about to be deleted below (readAndConsumeTag) and Notification:idle_prompt
// only ever fires well after this Stop hook has already run. This file is
// NEVER deleted (unlike the tag file below) - only ever overwritten, every
// single Stop event, regardless of whether Claude wrote a category tag
// this turn at all.
//
// Defaults to false (do NOT play "waiting") whenever Claude didn't
// explicitly write `awaitingInput: true` this turn - a missing tag, a
// tag with no awaitingInput field, or malformed JSON all resolve to
// false. This is the opposite of the tag-category fallback's own
// philosophy (which defaults toward still playing SOMETHING, since
// missing a sound entirely reads as broken) - "waiting" is different:
// it's specifically meant to only fire when Claude is truly blocked on
// the user, so the safe default here is silence, not noise. Confirmed
// live: the previous true-default played "waiting" on a turn where
// Claude simply forgot to self-tag (fell through to keyword-matching for
// the category), which is exactly the false positive this exists to
// prevent.
function persistAwaitingInput(tag) {
    const awaitingInput = tag && typeof tag.awaitingInput === 'boolean' ? tag.awaitingInput : false;
    try {
        fs.writeFileSync(
            awaitingInputStatePath(),
            JSON.stringify({ awaitingInput, ts: new Date().toISOString() }),
            'utf-8'
        );
    } catch {}
}

function readAndConsumeTag() {
    const tagPath = tagFilePath();
    let result = null;
    if (fs.existsSync(tagPath)) {
        let tag = null;
        try {
            tag = JSON.parse(fs.readFileSync(tagPath, 'utf-8'));
            const ageSeconds = (Date.now() - new Date(tag.ts).getTime()) / 1000;
            if (ageSeconds <= TAG_MAX_AGE_SECONDS && ALL_CATEGORIES.includes(tag.category)) {
                result = tag.category;
            }
        } catch {}
        // Persisted even on a parse failure/stale tag (tag will be null,
        // falling back to the safe awaitingInput:true default inside
        // persistAwaitingInput) - every Stop event refreshes this state,
        // so it never lingers stale from several turns back.
        persistAwaitingInput(tag);
        try { fs.unlinkSync(tagPath); } catch {}
    } else {
        // No tag written this turn at all (Claude didn't self-tag) - same
        // safe default, and still refreshes the state file so it can't be
        // stuck on a much older turn's value.
        persistAwaitingInput(null);
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
    ['welcome', [/^(hi|hey|hello)[!.,\s]*$/i, /^(hi|hey|hello) there\b/i, /good morning/i, /good afternoon/i, /good evening/i, /welcome back/i]],
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
    ['milestone_reached', [/\bmilestone\b/i, /huge (win|success)/i, /massive achievement/i, /we (finally )?(did it|made it|shipped it)\b/i, /major achievement/i]],
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
    if (isSubagentEvent(hookInput)) return;
    const transcriptPath = hookInput.transcript_path;
    const sessionId = hookInput.session_id;

    let matched = readAndConsumeTag();
    const source = matched ? 'claude-tag' : 'keyword';

    // No blocking retry here anymore: play-userpromptsubmit-sound.js primes
    // the tag convention fresh on every turn (confirmed silent to the user,
    // unlike a Stop-hook block, which always echoes something visible - see
    // README.md's "A note on the design history" for what was tried,
    // including suppressOutput, and why none of it beat priming instead).
    // If Claude still didn't self-tag, fall straight through to
    // keyword-match below - zero JSON/stdout output, so nothing ever prints
    // here.

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
