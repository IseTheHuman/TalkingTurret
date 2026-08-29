'use strict';
const fs = require('fs');
const path = require('path');
const {
    readHookStdin,
    soundsRoot,
    writeHookLog,
    playRandomSound,
    awaitingInputStatePath,
    isSubagentEvent,
} = require('./common');

// Only the "genuinely waiting on a real answer/decision from the user"
// case should play the waiting sound - not every idle_prompt (Claude Code
// fires this whenever the user hasn't responded in a while, even if
// Claude's last message was just a status update while a background task
// runs, e.g. "dispatched the implementer, will report back"). Defaults to
// false (do NOT play) on any missing/malformed state, or when the state
// file's own awaitingInput field isn't literally `true` - a first-ever
// run with no state file yet, a plugin update mid-session, or Claude
// simply forgetting to self-tag all resolve to silence, not noise. Only
// an explicit, successfully-persisted `awaitingInput: true` plays the
// sound. See persistAwaitingInput's own comment in play-stop-sound.js for
// why this direction (default-quiet) is correct here specifically, unlike
// the tag-category fallback's default-toward-still-playing-something.
function shouldPlayWaiting() {
    try {
        const raw = fs.readFileSync(awaitingInputStatePath(), 'utf-8');
        const state = JSON.parse(raw);
        return state.awaitingInput === true;
    } catch {
        return false;
    }
}

const hookInput = readHookStdin();
if (isSubagentEvent(hookInput)) process.exit(0);
if (shouldPlayWaiting()) {
    const file = playRandomSound(path.join(soundsRoot(), 'waiting'));
    writeHookLog('Notification:idle_prompt', 'waiting', hookInput.session_id, file ? path.basename(file) : '');
} else {
    writeHookLog('Notification:idle_prompt', 'waiting (suppressed - not awaiting input)', hookInput.session_id, '');
}
