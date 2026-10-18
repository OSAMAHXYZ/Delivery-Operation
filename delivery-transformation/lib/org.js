'use strict';

function normName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function ensureOrg(meta) {
  if (!Array.isArray(meta.orgCities)) meta.orgCities = [];
  if (!Array.isArray(meta.orgCompanies)) meta.orgCompanies = [];
  return meta;
}

function nextId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function listOrg(meta) {
  const org = ensureOrg(meta);
  return { cities: org.orgCities, companies: org.orgCompanies };
}

function saveCity(meta, body) {
  const org = ensureOrg(meta);
  const name = String((body && body.name) || '').trim();
  const country = String((body && body.country) || '').trim() || 'Saudi Arabia';
  const active = body && body.active === false ? false : true;
  if (!name) return { error: 'City name is required' };
  const id = String((body && body.id) || '').trim();
  const dup = org.orgCities.find((c) => c.id !== id && normName(c.name) === normName(name) && normName(c.country) === normName(country));
  if (dup) return { error: 'That city already exists in this country' };
  if (id) {
    const row = org.orgCities.find((c) => c.id === id);
    if (!row) return { error: 'City not found' };
    row.name = name;
    row.country = country;
    row.active = active;
    return { city: row };
  }
  const city = { id: nextId('city'), name, country, active };
  org.orgCities.push(city);
  return { city };
}

function saveCompany(meta, body) {
  const org = ensureOrg(meta);
  const name = String((body && body.name) || '').trim();
  const code = String((body && body.code) || '').trim();
  const cityId = String((body && body.cityId) || '').trim();
  const active = body && body.active === false ? false : true;
  if (!name) return { error: 'Company name is required' };
  const id = String((body && body.id) || '').trim();
  if (cityId && !org.orgCities.some((c) => c.id === cityId)) return { error: 'Choose a city that exists' };
  if (code) {
    const dupCode = org.orgCompanies.find((c) => c.id !== id && normName(c.code) === normName(code));
    if (dupCode) return { error: 'That company code is already used' };
  }
  const dupName = org.orgCompanies.find((c) => c.id !== id && normName(c.name) === normName(name) && (c.cityId || '') === cityId);
  if (dupName) return { error: 'That company already exists for this city' };
  if (id) {
    const row = org.orgCompanies.find((c) => c.id === id);
    if (!row) return { error: 'Company not found' };
    row.name = name;
    row.code = code;
    row.cityId = cityId;
    row.active = active;
    return { company: row };
  }
  const company = { id: nextId('co'), name, code, cityId, active };
  org.orgCompanies.push(company);
  return { company };
}

function removeCity(meta, id) {
  const org = ensureOrg(meta);
  if (org.orgCompanies.some((c) => c.cityId === id)) {
    return { error: 'Reassign companies before removing this city' };
  }
  const before = org.orgCities.length;
  org.orgCities = org.orgCities.filter((c) => c.id !== id);
  if (org.orgCities.length === before) return { error: 'City not found' };
  return { ok: true };
}

module.exports = { listOrg, saveCity, saveCompany, removeCity };
