'use strict';

/**
 * Delivery Team privacy — customer name and phone are visible to the whole team.
 * Invoice owner stays available to the team as well (internal ops).
 */

const PII_KEYS = Object.freeze(['invoiceOwner', 'userName', 'phone']);

/** All signed-in Delivery Team roles may see customer name / phone. */
function canSeeCustomerPii(role) {
  const r = String(role || '').trim().toLowerCase();
  return r === 'admin' || r === 'hanouf' || r === 'employee';
}

function maskPersonName(value) {
  const s = String(value == null ? '' : value).trim();
  return s || '—';
}

function maskPhone(_value) {
  return '—';
}

function phoneDisplay(value) {
  const s = String(value == null ? '' : value).trim();
  return s || '—';
}

/** Pass through customer fields for team viewers; redact only for unknown roles. */
function redactRawPii(raw, viewerRole) {
  if (!raw || typeof raw !== 'object') return raw;
  if (canSeeCustomerPii(viewerRole)) return { ...raw };
  return {
    ...raw,
    invoiceOwner: '—',
    userName: '—',
    phone: '—',
  };
}

module.exports = {
  PII_KEYS,
  canSeeCustomerPii,
  maskPersonName,
  maskPhone,
  phoneDisplay,
  redactRawPii,
};
