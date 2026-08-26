'use strict';
// Standalone CLI script (not a hook) invoked by the /talking-turret:volume
// slash command. Unlike the hook scripts, printing to stdout here is fine
// and expected - this runs on demand from a user action, not silently on
// every turn.

const { setVolume } = require('./common');

const arg = process.argv[2];
const n = Number(arg);
if (arg === undefined || arg === '' || Number.isNaN(n)) {
    console.log('Usage: node set-volume.js <0-100>');
    process.exit(1);
}

const clamped = setVolume(n);
console.log(`TalkingTurret volume set to ${clamped}.`);
