/**
 * Builds delivery_note_template.docx from delivery_note.docx by inserting docxtemplater placeholders.
 * Run: node scripts/build-delivery-note-template.js
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'delivery_note.docx');
const OUTPUT = path.join(ROOT, 'delivery_note_template.docx');

const UNDERLINE_TAGS = [
  'customer_name',
  'company_rep',
  'day_name',
  'trailer_number',
  'car_count',
  'branch_to',
  'attachments',
  'warehouse_supervisor_sign',
  'transport_rep_sign',
  'recipient_name',
  'recipient_signature',
  'recipient_date',
  'branch_stamp'
];

const UNDERLINE_RE = /<w:t[^>]*>\s*ـ{12,}\s*<\/w:t>/g;

function replaceUnderlinesInOrder(xml) {
  let count = 0;
  return xml.replace(UNDERLINE_RE, () => {
    const tag = UNDERLINE_TAGS[count];
    count += 1;
    if (!tag) return '<w:t> </w:t>';
    return `<w:t>{${tag}}</w:t>`;
  });
}

function injectCarRowPlaceholders(xml) {
  const arabicNums = ['١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', '١٠'];
  let result = xml;
  arabicNums.forEach((num, idx) => {
    const n = idx + 1;
    const marker = `<w:t>${num}</w:t>`;
    const pos = result.indexOf(marker);
    if (pos === -1) return;
    const rowStart = result.lastIndexOf('<w:tr', pos);
    const rowEnd = result.indexOf('</w:tr>', pos);
    if (rowStart === -1 || rowEnd === -1) return;
    const before = result.slice(0, rowStart);
    const rowXml = result.slice(rowStart, rowEnd + '</w:tr>'.length);
    const after = result.slice(rowEnd + '</w:tr>'.length);
    const fields = ['model', 'chassis', 'plate', 'remarks'];
    let fieldIdx = 0;
    const newRow = rowXml.replace(/<w:tc>([\s\S]*?)<\/w:tc>/g, (cell) => {
      if (cell.includes(`>${num}<`)) return cell;
      if (fieldIdx >= fields.length) return cell;
      if (/<w:t[^>]*>[^<]+<\/w:t>/.test(cell)) return cell;
      const field = fields[fieldIdx++];
      const placeholder = `{car${n}_${field}}`;
      if (cell.includes('<w:p') && !cell.includes('<w:r')) {
        return cell.replace(/<w:p([^>]*)>(\s*<w:pPr>[\s\S]*?<\/w:pPr>)?/,
          `<w:p$1>$2<w:r><w:t>${placeholder}</w:t></w:r>`);
      }
      return cell.replace(/<\/w:tc>/, `<w:p><w:r><w:t>${placeholder}</w:t></w:r></w:p></w:tc>`);
    });
    result = before + newRow + after;
  });
  return result;
}

function buildTemplate() {
  if (!fs.existsSync(SOURCE)) {
    console.error('Missing delivery_note.docx');
    process.exit(1);
  }
  const zip = new PizZip(fs.readFileSync(SOURCE, 'binary'));
  let xml = zip.file('word/document.xml').asText();

  xml = xml.replace(
    /<w:t xml:space="preserve">\s+\/\s+\/<\/w:t>/,
    '<w:t xml:space="preserve">{date_d}     /     {date_m}     /     {date_y}</w:t>'
  );

  xml = xml.replace(
    /<w:t>التاريخ :    \/    \/        الموافق:    \/    \/<\/w:t>/,
    '<w:t>التاريخ : {transfer_d}    /    {transfer_m}    /    {transfer_y}        الموافق: {corresponding_d}    /    {corresponding_m}    /    {corresponding_y}</w:t>'
  );

  let depDone = false;
  xml = xml.replace(/<w:t>دقيقة\s+ساعة<\/w:t>/g, () => {
    if (!depDone) {
      depDone = true;
      return '<w:t>{dep_minute}     {dep_hour}</w:t>';
    }
    return '<w:t>{rec_minute}     {rec_hour}</w:t>';
  });

  xml = xml.replace(
    /<w:t>رقم<\/w:t>(\s*<\/w:r>\s*<\/w:p>\s*<\/w:tc>\s*<w:tc[^>]*>\s*<w:tcPr>[\s\S]*?<\/w:tcPr>\s*)<w:p/,
    '<w:t>رقم</w:t>$1<w:p><w:r><w:t>{memo_number}</w:t></w:r></w:p><w:p'
  );

  xml = xml.replace(
    /<w:t xml:space="preserve">☐  سليمة<\/w:t>/,
    '<w:t xml:space="preserve">{received_intact_mark}  سليمة</w:t>'
  );
  xml = xml.replace(
    /<w:t xml:space="preserve">☐  بها تلفيات \(ويرفق بها التفاصيل\)<\/w:t>/,
    '<w:t xml:space="preserve">{received_damaged_mark}  بها تلفيات (ويرفق بها التفاصيل)</w:t>'
  );

  xml = replaceUnderlinesInOrder(xml);
  xml = injectCarRowPlaceholders(xml);

  zip.file('word/document.xml', xml);
  fs.writeFileSync(OUTPUT, zip.generate({ type: 'nodebuffer' }));
  console.log('Wrote', OUTPUT, '- underlines replaced:', (xml.match(/\{[a-z0-9_]+\}/gi) || []).length);
}

buildTemplate();
