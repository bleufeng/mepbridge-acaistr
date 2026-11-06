// SPDX-License-Identifier: MIT
'use strict';

// One mode decision for every server-side entry point. Automatic execution is
// the project default; callers must opt into a supervised/manual mode explicitly.
function isAutomaticExecution(context = {}) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return true;
  if (context.autoMode === false) return false;
  if (context.autoMode === true) return true;
  const declared = String(context.mode || context.source || '').trim().toLowerCase();
  if (declared === 'manual-strict' || declared === 'copilot-supervised' || declared === 'supervised') return false;
  if (declared === 'copilot-auto' || declared === 'ui-copilot' || declared === 'auto' || declared === 'automatic') return true;
  return declared === '';
}

module.exports = { isAutomaticExecution };
