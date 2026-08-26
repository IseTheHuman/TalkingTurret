'use strict';
// PreCompact hook: play a sound right before Claude Code compacts the
// conversation (manual /compact or automatic when context fills up).

const path = require('path');
const { readHookStdin, soundsRoot, writeHookLog, playRandomSound } = require('./common');

const hookInput = readHookStdin();
const file = playRandomSound(path.join(soundsRoot(), 'compact'));
writeHookLog('PreCompact', 'compact', hookInput.session_id, file ? path.basename(file) : (hookInput.trigger || ''));
