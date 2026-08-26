'use strict';
// SessionStart hook: play a welcome sound when a session actually opens,
// before anything has been typed. Skips `source: "compact"` - that fires
// mid-session during auto-compaction, not when a session is being opened,
// so playing "welcome" there would be misleading.

const path = require('path');
const { readHookStdin, soundsRoot, writeHookLog, playRandomSound } = require('./common');

const hookInput = readHookStdin();
if (hookInput.source !== 'compact') {
    const file = playRandomSound(path.join(soundsRoot(), 'welcome'));
    writeHookLog('SessionStart', 'welcome', hookInput.session_id, file ? path.basename(file) : (hookInput.source || ''));
}
