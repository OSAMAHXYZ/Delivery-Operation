/**
 * Field positions for قائمة فحص السيارات وقت التسليم (اسامة12.pdf)
 * Pure page fractions only (no px) so screen + print stay aligned.
 * [tag, x, y, w, h, align?]
 */
const CHECK_NOTE_FIELDS = [
  // Left-of-center values (next to إسم المالك / المستخدم / هاتف / رقم الهوية)
  ['wh_owner_name', 0.05, 0.127, 0.33, 0.014, 'end'],   // +10px down
  ['wh_user_name', 0.05, 0.145, 0.33, 0.014, 'end'],    // +10px down
  ['wh_user_phone', 0.05, 0.183, 0.33, 0.014, 'end'],   // +15px down
  ['wh_user_id', 0.05, 0.215, 0.33, 0.014, 'end'],      // +30px down

  // Bottom row of header box (وقت / تاريخ طباعة المستند) — +4px more (~0.004 of A4)
  ['wh_print_time', 0.05, 0.228, 0.30, 0.014, 'end'],
  ['wh_print_date', 0.50, 0.228, 0.22, 0.014, 'end'],

  // Chassis — +100px right; +20px down
  ['wh_chassis', 0.71, 0.281, 0.20, 0.015, 'start'],
  ['wh_chassis_2', 0.71, 0.297, 0.20, 0.014, 'start'],
  ['wh_chassis_3', 0.71, 0.311, 0.20, 0.014, 'start'],
  ['wh_chassis_4', 0.71, 0.325, 0.20, 0.014, 'start'],
  ['wh_chassis_5', 0.71, 0.339, 0.20, 0.014, 'start']
];

const CHECK_NOTE_COVERS = [];

if (typeof window !== 'undefined') {
  window.CHECK_NOTE_FIELDS = CHECK_NOTE_FIELDS;
  window.CHECK_NOTE_COVERS = CHECK_NOTE_COVERS;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CHECK_NOTE_FIELDS, CHECK_NOTE_COVERS };
}
