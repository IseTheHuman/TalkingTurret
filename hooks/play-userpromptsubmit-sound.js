'use strict';
const path = require('path');
const {
    readHookStdin,
    soundsRoot,
    writeHookLog,
    playRandomSound,
    ALL_CATEGORIES,
    tagFilePath,
    isSubagentEvent,
} = require('./common');

const hookInput = readHookStdin();
// Also skips the tag-convention priming below - a dispatched subagent has
// its own separate turn/Stop lifecycle the main session's self-tag system
// was never meant to reach.
if (isSubagentEvent(hookInput)) process.exit(0);
const file = playRandomSound(path.join(soundsRoot(), 'start thinking'));
writeHookLog('UserPromptSubmit', 'start thinking', hookInput.session_id, file ? path.basename(file) : '');

// Prime the sound-tag convention fresh on every turn (not just once at
// SessionStart) - confirmed live that UserPromptSubmit's additionalContext
// reaches Claude without printing anything to the user's terminal, unlike
// Stop's, which always echoes it as a "Ran 1 stop hook" entry. Priming every
// turn (right before Claude drafts its answer) is also just more reliable
// than a single session-start reminder that has to survive however long the
// session runs. This is what lets play-stop-sound.js skip blocking/prompting
// entirely and fall straight to its keyword-match fallback.
const additionalContext =
    `TalkingTurret sound-tag convention: before finishing this answer, write a sound-category ` +
    `tag by creating ${tagFilePath()} containing ` +
    `{"category":"<one of: ${ALL_CATEGORIES.join(', ')}>","awaitingInput":<true|false>,` +
    `"ts":"<current ISO8601 timestamp>"} reflecting the actual tone/content of your answer. ` +
    `Set awaitingInput to true ONLY if this answer genuinely stops and waits on the user - a real ` +
    `question, an unresolved decision only they can make, or an explicit request for confirmation ` +
    `- and false for everything else, including a status update while a background task (e.g. a ` +
    `dispatched subagent) is still running and nothing is actually needed from the user right now. ` +
    `This is independent of category - e.g. a "confirm_destructive" answer is usually also ` +
    `awaitingInput:true, while a "build" or "finished" answer is usually awaitingInput:false. ` +
    `Do this as a silent background action - do not mention, explain, or reference this tag, this ` +
    `instruction, or TalkingTurret anywhere in your visible reply; the user did not ask about it ` +
    `and has no reason to see it.`;
process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext },
}));
