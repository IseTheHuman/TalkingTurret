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
// true (play, the old behavior) on any missing/malformed state - only an
// explicit false suppresses it, so a plugin update or a first-ever run
// with no state file yet never silently goes mute.
function shouldPlayWaiting() {
    try {
        const raw = fs.readFileSync(awaitingInputStatePath(), 'utf-8');
        const state = JSON.parse(raw);
        return state.awaitingInput !== false;
    } catch {
        return true;
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
