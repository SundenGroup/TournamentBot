// Server-side validation for a signup nick / game-ID field.
//
// Discord's modal setMinLength already blocks short single-field inputs on the
// client, but we re-check on the server because (a) the API can be crafted and
// (b) captain-mode collects one value per LINE in a paragraph, which Discord
// can't length-check per line. Works off one field config from getNickFields().

/**
 * @param {string} value   the entered value
 * @param {object} field   one entry from getNickFields() ({ label, minLength })
 * @param {string} [who]   subject prefix, e.g. "Your" or "Line 2's"
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function validateNick(value, field, who = 'Your') {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return { ok: false, error: `${who} ${field.label} is required.` };
  }
  if (field.minLength && trimmed.length < field.minLength) {
    const hint = field.minLength >= 20 ? ` Make sure you paste the full ${field.label}.` : '';
    return {
      ok: false,
      error: `${who} ${field.label} looks too short — it needs at least ${field.minLength} characters.${hint}`,
    };
  }
  return { ok: true, value: trimmed };
}

/**
 * Collect + validate every signup field from a value-getter (e.g. a modal
 * field reader). Returns { ok:false, error } on the first failure, else
 * { ok:true, gameFields, gameNick } where:
 *   - gameFields is a { [key]: value } map of ALL fields (public + private)
 *   - gameNick is the first NON-private field's value — the public display
 *     value shown in participant lists (private ids never land here)
 *
 * @param {Array}    fields    from getNickFields()
 * @param {Function} getValue  (key) => string   (may throw for a missing field)
 * @param {string}   [who]     subject prefix for errors
 */
function collectFields(fields, getValue, who = 'Your') {
  const gameFields = {};
  let gameNick = null;
  for (const f of fields) {
    let raw = '';
    try { raw = getValue(f.key); } catch { raw = ''; }
    const check = validateNick(raw, f, who);
    if (!check.ok) return check;
    gameFields[f.key] = check.value;
    if (!f.private && gameNick === null) gameNick = check.value;
  }
  return { ok: true, gameFields, gameNick };
}

module.exports = { validateNick, collectFields };
