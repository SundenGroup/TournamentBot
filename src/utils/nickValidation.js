// Server-side validation for the signup nick / game-ID field.
//
// Discord's modal setMinLength already blocks short single-field inputs on the
// client, but we re-check on the server because (a) the API can be crafted and
// (b) captain-mode collects one identifier per LINE in a paragraph, which
// Discord can't length-check per line. Uses the per-game nickField config so
// GOALS ("GOALS User ID", min 30) and any future game validate correctly.

/**
 * @param {string} value        the entered nick / ID
 * @param {object} nickField    result of getNickField(tournament.game)
 * @param {string} [who]        prefix for team-member errors, e.g. "line 2's"
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function validateNick(value, nickField, who = 'Your') {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return { ok: false, error: `${who} ${nickField.noun} is required.` };
  }
  if (nickField.minLength && trimmed.length < nickField.minLength) {
    const hint = nickField.custom ? ` Make sure you paste the full ${nickField.noun}.` : '';
    return {
      ok: false,
      error: `${who} ${nickField.noun} looks too short — it needs at least ${nickField.minLength} characters.${hint}`,
    };
  }
  return { ok: true, value: trimmed };
}

module.exports = { validateNick };
