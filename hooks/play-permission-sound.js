'use strict';
const path = require('path');
const { readHookStdin, soundsRoot, writeHookLog, playRandomSound, isSubagentEvent } = require('./common');

const hookInput = readHookStdin();
if (isSubagentEvent(hookInput)) process.exit(0);
const file = playRandomSound(path.join(soundsRoot(), 'question'));
writeHookLog('Notification:permission_prompt', 'question', hookInput.session_id, file ? path.basename(file) : '');
