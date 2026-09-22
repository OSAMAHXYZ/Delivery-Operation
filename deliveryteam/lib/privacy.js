'use strict';

/**
 * Delivery Team privacy —
 * - Customer name + phone: visible to all roles
 * - Invoice owner: admin + Hanouf only
 */

const PII_KEYS = Object.freeze(['invoiceOwner', 'userName', 'phone']);

function canSeeInvoiceOwner(role) {
  const r = String(role || '').trim().toLowerCase();
  return r === 'admin' || r === 'hanouf';
}

/** @deprecated Prefer canSeeInvoiceOwner — customer name/phone are open to all. */
function canSeeCustomerPii(role) {
  return canSeeInvoiceOwner(role);
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

/** Redact invoice owner unless viewer is admin/Hanouf. Name + phone always pass through. */
function redactRawPii(raw, viewerRole) {
  if (!raw || typeof raw !== 'object') return raw;
  const out = { ...raw };
  if (!canSeeInvoiceOwner(viewerRole)) {
    out.invoiceOwner = '—';
  }
  return out;
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
