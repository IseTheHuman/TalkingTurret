'use strict';
// Notification hook (matchers: quota_auto_resume_fired/stale/disabled): plays
// out_of_tokens whenever Claude Code hits a usage/session limit. This is the
// real signal for that - the Stop hook's keyword fallback (matching phrases
// like "out of tokens" in Claude's own answer text) never fires for an
// actual limit hit, since Claude doesn't get to produce/finish an answer to
// scan when it's cut off by the limit itself.

const path = require('path');
const { readHookStdin, soundsRoot, writeHookLog, playRandomSound } = require('./common');

const hookInput = readHookStdin();
const file = playRandomSound(path.join(soundsRoot(), 'out_of_tokens'));
writeHookLog(`Notification:${hookInput.notification_type || 'quota'}`, 'out_of_tokens', hookInput.session_id, file ? path.basename(file) : '');
