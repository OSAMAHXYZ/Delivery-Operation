'use strict';

/**
 * Delivery Team privacy —
 * Customer name, invoice owner (raw col N), and phone are visible to all roles.
 */

const PII_KEYS = Object.freeze(['invoiceOwner', 'userName', 'phone']);

function canSeeInvoiceOwner(_role) {
  return true;
}

/** @deprecated All contact fields are open to every role. */
function canSeeCustomerPii(_role) {
  return true;
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

/** No PII redaction — name, owner, and phone pass through for every viewer. */
function redactRawPii(raw, _viewerRole) {
  if (!raw || typeof raw !== 'object') return raw;
  return { ...raw };
}

module.exports = {
  PII_KEYS,
  canSeeCustomerPii,
  canSeeInvoiceOwner,
  maskPersonName,
  maskPhone,
  phoneDisplay,
  redactRawPii,
};
