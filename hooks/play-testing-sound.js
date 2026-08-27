'use strict';
// PostToolUse (matcher: "Bash") hook: play a "testing" sound when the
// executed command was actually a test-runner invocation, detected from the
// real command string - not from Claude's answer text. This is a separate,
// deterministic trigger from the Stop hook's self-tag/keyword system: it
// fires the moment a test command runs, regardless of what Claude says
// about it afterward.

const path = require('path');
const { readHookStdin, soundsRoot, writeHookLog, playRandomSound, isSubagentEvent } = require('./common');

// Matches the common test-runner invocations across ecosystems. Deliberately
// permissive (e.g. "npm test" and "npm run test" both match "npm.*test")
// rather than trying to enumerate every package.json script name.
const TEST_COMMAND_PATTERNS = [
    /\bnpm\b.*\btest\b/i,
    /\byarn\b.*\btest\b/i,
    /\bpnpm\b.*\btest\b/i,
    /\bjest\b/i,
    /\bvitest\b/i,
    /\bmocha\b/i,
    /\bpytest\b/i,
    /\bgo\s+test\b/i,
    /\bcargo\s+test\b/i,
    /\bdotnet\s+test\b/i,
    /\bmvn\b.*\btest\b/i,
    /\bgradle\w*\s.*\btest\b/i,
    /\brspec\b/i,
    /\bphpunit\b/i,
];

const hookInput = readHookStdin();
if (isSubagentEvent(hookInput)) process.exit(0);
const command = (hookInput.tool_input && hookInput.tool_input.command) || '';
const isTestCommand = TEST_COMMAND_PATTERNS.some((re) => re.test(command));

if (isTestCommand) {
    const file = playRandomSound(path.join(soundsRoot(), 'testing'));
    writeHookLog('PostToolUse:Bash:testing', 'testing', hookInput.session_id, command.slice(0, 300));
}
