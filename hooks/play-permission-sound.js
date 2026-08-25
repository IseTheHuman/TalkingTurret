'use strict';
const path = require('path');
const { readHookStdin, soundsRoot, writeHookLog, playRandomSound } = require('./common');

const hookInput = readHookStdin();
const file = playRandomSound(path.join(soundsRoot(), 'question'));
writeHookLog('Notification:permission_prompt', 'question', hookInput.session_id, file ? path.basename(file) : '');
