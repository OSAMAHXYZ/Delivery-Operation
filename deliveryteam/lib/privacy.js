'use strict';

/**
 * Delivery Team privacy — customer name, invoice owner, and phone
 * are visible to admin only.
 */

const PII_KEYS = Object.freeze(['invoiceOwner', 'userName', 'phone']);

function canSeeCustomerPii(role) {
  const r = String(role || '').trim().toLowerCase();
  return r === 'admin' || r === 'hanouf';
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

/** Redact PII for API responses unless viewer is admin. */
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
