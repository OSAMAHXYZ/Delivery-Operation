/**
 * Builds muthakara_template.docx from مذكرة ترحيل.docx (scanned form image)
 * by overlaying docxtemplater text-box placeholders.
 * Run: node scripts/build-muthakara-template.js
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const { MUTHAKARA_FIELDS, INVOICE_NUMBER_COVER } = require('./muthakara-field-layout');

const ROOT = path.join(__dirname, '..');
const SOURCE_CANDIDATES = [
  path.join(ROOT, 'مذكرة ترحيل.docx'),
  path.join(ROOT, 'muthakara_tarhil.docx')
];
const OUTPUT = path.join(ROOT, 'muthakara_template.docx');

const PAGE_W = 7557770;
const PAGE_H = 10689590;

function whiteCover(id, x, y, w, h) {
  const px = Math.round(x * PAGE_W);
  const py = Math.round(y * PAGE_H);
  const pw = Math.round(w * PAGE_W);
  const ph = Math.round(h * PAGE_H);
  return `<wps:wsp>
    <wps:cNvPr id="${id}" name="memo_cover"/>
    <wps:cNvSpPr/>
    <wps:spPr>
      <a:xfrm><a:off x="${px}" y="${py}"/><a:ext cx="${pw}" cy="${ph}"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
      <a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
    </wps:spPr>
    <wps:bodyPr rtlCol="0" anchor="ctr"/>
  </wps:wsp>`;
}

function field(id, tag, x, y, w, h, align) {
  const px = Math.round(x * PAGE_W);
  const py = Math.round(y * PAGE_H);
  const pw = Math.round(w * PAGE_W);
  const ph = Math.round(h * PAGE_H);
  const anchor = align === 'center' ? 'ctr' : align === 'end' ? 'b' : 't';
  const tIns = align === 'end' ? 18000 : 12000;
  const bIns = align === 'end' ? 0 : 12000;
  const isHeaderDate = /^date_[dmy]$/.test(tag);
  const isInvoice = tag === 'invoice_number';
  const fontSz = isHeaderDate ? '12' : isInvoice ? '20' : '14';
  const runRPr = isInvoice
    ? `<w:rPr><w:b/><w:sz w:val="${fontSz}"/><w:color w:val="EB0A1E"/><w:rtl/></w:rPr>`
    : `<w:rPr><w:sz w:val="${fontSz}"/><w:rtl/></w:rPr>`;
  return `<wps:wsp>
    <wps:cNvPr id="${id}" name="${tag}"/>
    <wps:cNvSpPr txBox="1"/>
    <wps:spPr>
      <a:xfrm><a:off x="${px}" y="${py}"/><a:ext cx="${pw}" cy="${ph}"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:noFill/>
      <a:ln w="0"><a:noFill/></a:ln>
    </wps:spPr>
    <wps:txbx>
      <w:txbxContent>
        <w:p><w:pPr><w:jc w:val="${align === 'center' ? 'center' : 'right'}"/><w:bidi/></w:pPr>
          <w:r>${runRPr}<w:t>{${tag}}</w:t></w:r>
        </w:p>
      </w:txbxContent>
    </wps:txbx>
    <wps:bodyPr wrap="none" anchor="${anchor}" lIns="18000" tIns="${tIns}" rIns="18000" bIns="${bIns}" rtlCol="1"/>
  </wps:wsp>`;
}

function buildFields() {
  let id = 100;
  const parts = [];
  const [cx, cy, cw, ch] = INVOICE_NUMBER_COVER;
  parts.push(whiteCover(id++, cx, cy, cw, ch));
  parts.push(...MUTHAKARA_FIELDS.map(([tag, x, y, w, h, align]) =>
    field(id++, tag, x, y, w, h, align || 'end')
  ));
  return parts.join('');
}

function buildTemplate() {
  const source = SOURCE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!source) {
    console.error('Missing مذكرة ترحيل.docx');
    process.exit(1);
  }
  const zip = new PizZip(fs.readFileSync(source, 'binary'));
  let xml = zip.file('word/document.xml').asText();
  const shapes = buildFields();
  if (!xml.includes('</wpg:wgp>')) {
    console.error('Unexpected document structure — cannot inject fields');
    process.exit(1);
  }
  xml = xml.replace('</wpg:wgp>', `${shapes}</wpg:wgp>`);
  zip.file('word/document.xml', xml);
  fs.writeFileSync(OUTPUT, zip.generate({ type: 'nodebuffer' }));
  const count = (xml.match(/\{[a-z0-9_]+\}/gi) || []).length;
  console.log('Wrote', OUTPUT, 'from', path.basename(source), '- placeholders:', count);
}

buildTemplate();
