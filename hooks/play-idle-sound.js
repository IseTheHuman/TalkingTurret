'use strict';
const path = require('path');
const { readHookStdin, soundsRoot, writeHookLog, playRandomSound } = require('./common');

const hookInput = readHookStdin();
const file = playRandomSound(path.join(soundsRoot(), 'waiting'));
writeHookLog('Notification:idle_prompt', 'waiting', hookInput.session_id, file ? path.basename(file) : '');
