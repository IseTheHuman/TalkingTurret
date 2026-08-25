'use strict';
const path = require('path');
const { readHookStdin, soundsRoot, writeHookLog, playRandomSound } = require('./common');

const hookInput = readHookStdin();
const file = playRandomSound(path.join(soundsRoot(), 'start thinking'));
writeHookLog('PostToolUse:AskUserQuestion', 'start thinking', hookInput.session_id, file ? path.basename(file) : '');
