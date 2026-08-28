'use strict';
// PreCompact hook: play a sound right before Claude Code compacts the
// conversation (manual /compact or automatic when context fills up).

const path = require('path');
const { readHookStdin, soundsRoot, writeHookLog, playRandomSound, isSubagentEvent } = require('./common');

const hookInput = readHookStdin();
if (isSubagentEvent(hookInput)) process.exit(0);
const file = playRandomSound(path.join(soundsRoot(), 'compacting'));
writeHookLog('PreCompact', 'compacting', hookInput.session_id, file ? path.basename(file) : (hookInput.trigger || ''));
