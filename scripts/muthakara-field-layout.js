/**
 * Field positions for مذكرة ترحيل (fractions of page width/height).
 * [tag, x, y, w, h, align?] — align: 'start' | 'center' | 'end' (vertical baseline on line)
 */
const MUTHAKARA_FIELDS = [
  // Header — memo box (left), date slots (top right)
  // INVOICE_NUMBER_COVER hides pre-printed 023002 on scanned form
  ['invoice_number', 0.058, 0.130, 0.132, 0.026, 'center'],
  // Header date — between / slots (التاريخ)
  ['date_d', 0.750, 0.093, 0.042, 0.022, 'center'],
  ['date_m', 0.796, 0.093, 0.042, 0.022, 'center'],
  ['date_y', 0.842, 0.093, 0.055, 0.022, 'center'],
  // Exit time — ساعة (left box), دقيقة (right box)
  ['dep_hour', 0.748, 0.142, 0.050, 0.022, 'center'],
  ['dep_minute', 0.805, 0.142, 0.050, 0.022, 'center'],

  // Row 1 — company name / اسم الشركة (left), company rep / مندوب (right)
  ['company_rep', 0.018, 0.173, 0.30, 0.020, 'end'],
  ['customer_name', 0.558, 0.171, 0.280, 0.022, 'end'],

  // Row 2 — day (left), corresponding (middle), transfer date (right)
  ['day_name', 0.055, 0.198, 0.24, 0.024, 'end'],
  ['corresponding_d', 0.44, 0.206, 0.048, 0.022, 'center'],
  ['corresponding_m', 0.498, 0.206, 0.048, 0.022, 'center'],
  ['corresponding_y', 0.556, 0.206, 0.062, 0.022, 'center'],
  ['transfer_d', 0.720, 0.206, 0.042, 0.022, 'center'],
  ['transfer_m', 0.780, 0.206, 0.042, 0.022, 'center'],
  ['transfer_y', 0.840, 0.206, 0.055, 0.022, 'center'],

  // Row 3 — car count (left), trailer (right)
  ['car_count', 0.055, 0.228, 0.24, 0.024, 'end'],
  ['trailer_number', 0.316, 0.224, 0.46, 0.024, 'end'],

  // Row 4 — branch
  ['branch_to', 0.116, 0.254, 0.66, 0.024, 'end'],

  // Row 5 — attachments (nudged up + left vs printed label line; +5px down ≈ +0.45%)
  ['attachments', 0.02, 0.2725, 0.78, 0.028, 'end'],

  // Signatures
  ['transport_rep_sign', 0.055, 0.662, 0.38, 0.024, 'end'],
  ['warehouse_supervisor_sign', 0.52, 0.662, 0.42, 0.024, 'end'],

  // Branch receipt checkboxes (left of سليمة / بها تلفيات)
  ['received_intact_mark', 0.112, 0.716, 0.026, 0.02, 'center'],
  ['received_damaged_mark', 0.112, 0.738, 0.026, 0.02, 'center'],

  // Recipient block (right column)
  ['recipient_name', 0.52, 0.782, 0.42, 0.024, 'end'],
  ['recipient_signature', 0.52, 0.812, 0.42, 0.024, 'end'],
  ['recipient_date', 0.52, 0.842, 0.42, 0.024, 'end'],

  // Stamp (left) + receipt time (right)
  ['branch_stamp', 0.055, 0.872, 0.34, 0.038, 'center'],
  ['rec_minute', 0.788, 0.902, 0.048, 0.022, 'center'],
  ['rec_hour', 0.868, 0.902, 0.048, 0.022, 'center']
];

// Table: left→right = remarks | plate | chassis | model (all rows share TABLE_*)
// Chassis is widest — full 17-char VIN must fit at print size without clipping
const TABLE_COLS = [
  ['remarks', 0.100, 0.140],
  ['plate', 0.250, 0.130],
  // Chassis/model horizontal print nudges applied in Delivery_pdf via mm (print-stable)
  ['chassis', 0.400, 0.310],
  ['model', 0.730, 0.145]
];
const TABLE_ROW_START = 0.362;
const TABLE_ROW_STEP = 0.0246;
const TABLE_ROW_H = 0.022;

for (let row = 1; row <= 10; row++) {
  const y = TABLE_ROW_START + (row - 1) * TABLE_ROW_STEP;
  TABLE_COLS.forEach(([col, x, w]) => {
    MUTHAKARA_FIELDS.push([`car${row}_${col}`, x, y, w, TABLE_ROW_H, 'center']);
  });
}

// White patch over pre-printed red memo no. on scan (x, y, w, h)
const INVOICE_NUMBER_COVER = [0.050, 0.122, 0.146, 0.036];
// alias for cover rect used in preview
const MEMO_NUMBER_COVER = INVOICE_NUMBER_COVER;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MUTHAKARA_FIELDS, INVOICE_NUMBER_COVER, MEMO_NUMBER_COVER };
}
