// UTC offsets in hours for common timezone abbreviations
const TZ_OFFSETS = {
  // UTC / GMT
  UTC: 0, GMT: 0,
  // Europe
  WET: 0, WEST: 1, CET: 1, CEST: 2, EET: 2, EEST: 3, MSK: 3,
  // North America
  EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7,
  AKST: -9, AKDT: -8, HST: -10,
  // South America
  BRT: -3, ART: -3,
  // Asia
  IST: 5.5, PKT: 5, JST: 9, KST: 9, CST_ASIA: 8, HKT: 8, SGT: 8, ICT: 7,
  // Oceania
  AEST: 10, AEDT: 11, ACST: 9.5, ACDT: 10.5, AWST: 8, NZST: 12, NZDT: 13,
  // Africa
  SAST: 2, EAT: 3, WAT: 1, CAT: 2,
};

// Build regex pattern from timezone keys
const tzPattern = Object.keys(TZ_OFFSETS).join('|');
const informalRegex = new RegExp(
  `(\\w+)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?\\s*(${tzPattern})?`,
  'i'
);

function parseDateTime(input) {
  // Try to parse various date formats
  // Examples: "Feb 15 7pm UTC", "2026-02-15 19:00", "February 15, 2026 7:00 PM CET"

  // Try informal format first — native Date() misparses strings without a year
  const informalMatch = input.match(informalRegex);

  if (informalMatch) {
    const [, month, day, hour, minute = '00', ampm, tz] = informalMatch;
    const year = new Date().getFullYear();
    let hourNum = parseInt(hour);

    if (ampm?.toLowerCase() === 'pm' && hourNum < 12) {
      hourNum += 12;
    } else if (ampm?.toLowerCase() === 'am' && hourNum === 12) {
      hourNum = 0;
    }

    // Convert to UTC using timezone offset
    const tzKey = tz?.toUpperCase() || 'UTC';
    const offset = TZ_OFFSETS[tzKey] ?? 0;

    // Build date in UTC by subtracting the timezone offset
    const dateStr = `${month} ${day}, ${year} ${hourNum}:${minute}:00 UTC`;
    const parsed = new Date(dateStr);

    if (!isNaN(parsed.getTime())) {
      // Subtract offset to convert local time → UTC
      parsed.setTime(parsed.getTime() - (offset * 60 * 60 * 1000));
      return parsed;
    }
  }

  // Fall back to native parser for ISO and full date strings (e.g. "2026-02-15 19:00")
  const date = new Date(input);

  if (!isNaN(date.getTime())) {
    return date;
  }

  return null;
}

function formatTimeUntil(date) {
  const now = new Date();
  const diff = date.getTime() - now.getTime();

  if (diff < 0) {
    return 'Started';
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);

  return parts.join(' ') || 'Starting soon';
}

function toDiscordTimestamp(date, style = 'F') {
  const d = new Date(date);
  const unix = Math.floor(d.getTime() / 1000);
  return `<t:${unix}:${style}>`;
}

function toDiscordFullAndRelative(date) {
  const d = new Date(date);
  const unix = Math.floor(d.getTime() / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}

module.exports = {
  parseDateTime,
  formatTimeUntil,
  toDiscordTimestamp,
  toDiscordFullAndRelative,
};
