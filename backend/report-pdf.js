'use strict';

/**
 * Minimal, dependency-free PDF writer for clinical assessment reports.
 *
 * It renders only from the validated assessment object returned by
 * `assessment_view`, so the on-screen report and the PDF cannot disagree. The
 * writer deliberately supports a small feature set: Helvetica text, wrapping,
 * pagination and a header/footer. Content streams are left uncompressed so the
 * report can be checked as text in tests.
 */

const fs = require('node:fs');
const path = require('node:path');
const LOGO = fs.readFileSync(path.join(__dirname, 'report-logo.jpg'));
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 46;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM_LIMIT = 72;

const REPLACE = new Map([
  ['\u2018', "'"], ['\u2019', "'"], ['\u201c', '"'], ['\u201d', '"'],
  ['\u2013', '-'], ['\u2014', '-'], ['\u2026', '...'], ['\u00a0', ' '],
  ['\u2022', '-'], ['\u2192', '->'],
]);

function toWinAnsi(text) {
  let out = '';
  for (const char of String(text ?? '')) {
    const mapped = REPLACE.get(char) ?? char;
    for (const part of mapped) {
      const code = part.codePointAt(0);
      out += code <= 255 ? part : '?';
    }
  }
  return out;
}

function escapePdf(text) {
  return toWinAnsi(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// Conservative per-character widths for Helvetica. Wrapping only needs to stay
// inside the printable area, so exact metrics are unnecessary; the estimate is
// deliberately slightly generous.
function charWidth(char, size) {
  if ('iIl.,:;!|\'`()[]{}'.includes(char)) return 0.3 * size;
  if ('mwMW@%'.includes(char)) return 0.87 * size;
  if (char === ' ') return 0.28 * size;
  if (char >= 'A' && char <= 'Z') return 0.69 * size;
  if (char >= '0' && char <= '9') return 0.56 * size;
  if (char >= 'a' && char <= 'z') return 0.53 * size;
  return 0.55 * size;
}

function measure(text, size, bold = false) {
  let width = 0;
  for (const char of toWinAnsi(text)) width += charWidth(char, size) * (bold ? 1.04 : 1);
  return width;
}

function wrap(text, size, maxWidth, bold = false) {
  if (String(text ?? '').includes('\n')) return String(text).split(/\r?\n/).flatMap(line => line.trim() ? wrap(line, size, maxWidth, bold) : ['']);
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ');
  if (!words[0]) return [];
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, size, bold) <= maxWidth) { line = candidate; continue; }
    if (line) lines.push(line);
    // A single word longer than the line is split on character boundaries.
    if (measure(word, size, bold) > maxWidth) {
      let chunk = '';
      for (const char of word) {
        if (measure(chunk + char, size, bold) > maxWidth) { lines.push(chunk); chunk = char; }
        else chunk += char;
      }
      line = chunk;
    } else {
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

class Report {
  constructor(meta) {
    this.meta = meta;
    this.pages = [];
    this.current = null;
    this.y = 0;
  }

  ensurePage() {
    if (this.current) return;
    this.current = [];
    this.pages.push(this.current);
    this.y = PAGE_HEIGHT - 96;
    this.drawHeader();
  }

  newPage() {
    this.current = null;
    this.ensurePage();
  }

  drawHeader() {
    this.raw('0.09 0.35 0.42 rg');
    this.raw(`${MARGIN} ${PAGE_HEIGHT - 40} ${CONTENT_WIDTH} 3 re f`);
    this.raw('0 g');
    this.raw(`q 100 0 0 40 ${MARGIN} ${PAGE_HEIGHT - 72} cm /Logo Do Q`);
    this.drawText(PAGE_WIDTH - MARGIN - measure('Clinical assessment report', 9), PAGE_HEIGHT - 54, 'Clinical assessment report', 9, true);
    const reference = 'Ref ' + String(this.meta.reference || '').slice(0, 8);
    this.drawText(PAGE_WIDTH - MARGIN - measure(reference, 8), PAGE_HEIGHT - 68, reference, 8, false, .4);
    this.raw(`0.85 0.88 0.9 RG 0.7 w ${MARGIN} ${PAGE_HEIGHT - 74} m ${PAGE_WIDTH - MARGIN} ${PAGE_HEIGHT - 74} l S`);
  }

  raw(op) {
    this.ensurePage();
    this.current.push(op);
  }

  drawText(x, y, text, size, bold = false, gray = 0) {
    const font = bold ? '/F2' : '/F1';
    this.raw(`${gray} g BT ${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdf(text)}) Tj ET`);
  }

  space(height) {
    this.ensurePage();
    this.y -= height;
  }

  heading(text) {
    this.ensurePage();
    if (this.y < BOTTOM_LIMIT + 72) this.newPage();
    this.space(14);
    this.drawText(MARGIN, this.y, text, 11.5, true);
    // A restrained navy section marker, kept on the same grid as body text.
    this.raw(`0.09 0.26 0.48 rg ${MARGIN - 8} ${(this.y - 2).toFixed(2)} 2 11 re f`);
    this.space(6);
    this.raw(`0.8 0.84 0.87 RG 0.6 w ${MARGIN} ${this.y.toFixed(2)} m ${PAGE_WIDTH - MARGIN} ${this.y.toFixed(2)} l S`);
    this.space(10);
  }

  subheading(text) {
    this.ensurePage();
    if(this.y < BOTTOM_LIMIT + 42) this.newPage();
    this.space(10);
    this.drawText(MARGIN, this.y, text, 9.5, true, 0.25);
    this.space(12);
  }

  paragraph(text, { size = 10, bold = false, gray = 0.15, indent = 0 } = {}) {
    const lines = wrap(text, size, CONTENT_WIDTH - indent, bold);
    for (const line of lines) {
      if (this.y < BOTTOM_LIMIT) this.newPage();
      this.drawText(MARGIN + indent, this.y, line, size, bold, gray);
      this.space(size <= 9 ? 11 : 13);
    }
  }

  keyValue(label, value) {
    if (value === null || value === undefined || value === '') return;
    this.ensurePage();
    const labelWidth = 148;
    const valueSize = /reference|ID|version/i.test(label) ? 8 : 10;
    const lines = wrap(value, valueSize, CONTENT_WIDTH - labelWidth);
    if(this.y < BOTTOM_LIMIT + Math.min(lines.length, 4) * 13) this.newPage();
    const firstLineY = this.y;
    this.drawText(MARGIN, firstLineY, label, 9.5, true, 0.35);
    for (const [index, line] of lines.entries()) {
      if (index > 0 && this.y < BOTTOM_LIMIT) this.newPage();
      this.drawText(MARGIN + labelWidth, this.y, line, valueSize, false, 0.12);
      this.space(13);
    }
    if (!lines.length) this.space(13);
  }

  bullets(items, emptyText) {
    const list = Array.isArray(items) ? items.filter((item) => typeof item === 'string' && item.trim()) : [];
    if (!list.length) {
      this.paragraph(emptyText, { gray: 0.45, size: 9.5 });
      return;
    }
    for (const item of list) {
      const lines = wrap(item, 10, CONTENT_WIDTH - 14);
      if (this.y < BOTTOM_LIMIT) this.newPage();
      this.drawText(MARGIN + 2, this.y, '-', 10, false, 0.4);
      for (const line of lines) {
        if (this.y < BOTTOM_LIMIT) this.newPage();
        this.drawText(MARGIN + 14, this.y, line, 10, false, 0.12);
        this.space(13);
      }
    }
  }

  finish() {
    this.ensurePage();
    const total = this.pages.length;
    for (const [index, page] of this.pages.entries()) {
      const footerY = 46;
      const pageNo = `Page ${index + 1} of ${total}`;
      page.push(`${0.3} g BT /F1 8 Tf 1 0 0 1 ${MARGIN} ${footerY} Tm (${escapePdf(this.meta.footer)}) Tj ET`);
      page.push(`0.3 g BT /F1 8 Tf 1 0 0 1 ${(PAGE_WIDTH - MARGIN - measure(pageNo, 8)).toFixed(2)} ${footerY} Tm (${escapePdf(pageNo)}) Tj ET`);
      page.push('0 g');
    }
    return this.pages;
  }
}

function humanize(identifier) {
  const text = String(identifier ?? '').replace(/_/g, ' ').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : String(identifier ?? '');
}

function dateText(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function renderAssessmentReport(assessment, { generatedAt = new Date() } = {}) {
  const meta = {
    footer: 'Confidential patient information | HelloDoc',
    reference: assessment.id,
  };
  const doc = new Report(meta);

  doc.ensurePage();
  doc.drawText(MARGIN, doc.y, 'Clinical assessment', 20, true);
  doc.space(24);
  doc.paragraph(`Report generated ${dateText(generatedAt)}`, { size: 9, gray: 0.4 });
  if (assessment.demoMode) doc.paragraph('ADMIN DEMO MODE — this report was generated in an administrator demo workspace.', { size: 11, bold: true, gray: 0.2 });
  doc.paragraph(`Report reference: ${assessment.id || 'Not recorded'}`, {size:8,gray:.4});

  doc.heading('Patient and consultation');
  doc.keyValue('Patient', assessment.patientName || 'Not recorded');
  doc.keyValue('Patient ID', assessment.patientId || 'Not recorded');
  doc.keyValue('Patient email', assessment.patientEmail || '');
  if(assessment.age !== undefined && assessment.age !== null) doc.keyValue('Age',String(assessment.age));
  if(assessment.sex) doc.keyValue('Sex',assessment.sex);
  doc.keyValue('Consultation type', assessment.consultationType || 'Not recorded');
  doc.keyValue('Consultation', assessment.appointmentStart
    ? `${dateText(assessment.appointmentStart)}${assessment.appointmentStatus ? ` (${assessment.appointmentStatus})` : ''}`
    : 'Not linked to an appointment');
  doc.keyValue('Appointment reference', assessment.appointmentId || '');
  doc.keyValue('Assessment recorded', dateText(assessment.createdAt));
  doc.keyValue('Recording doctor', assessment.doctorName || '');
  // A revised assessment says which record it replaced; the earlier prediction is
  // never reprinted as if it were current.
  if (assessment.supersededPrediction) {
    const previous = assessment.supersededPrediction;
    doc.keyValue('Revision of', `assessment from ${dateText(previous.createdAt) || 'an earlier date'}` +
      `${previous.predictedDisease ? ` (predicted then: ${previous.predictedDisease})` : ''}`);
  }

  doc.heading('Presenting complaint');
  doc.paragraph(assessment.reason || 'Presenting complaint not recorded.');
  doc.heading('Symptoms');
  doc.subheading('Reported by the patient');
  doc.paragraph((assessment.patientReported || []).map(humanize).join('; ') || 'No patient-reported symptoms recorded.');
  doc.subheading('Recorded by the doctor');
  doc.paragraph((assessment.clinicianAdded || []).map(humanize).join('; ') || 'No additional symptoms recorded.');
  doc.heading('Clinical observations and examination');
  doc.paragraph('Clinical observations (not interpreted by the model)',{size:9,gray:.4});
  doc.bullets(assessment.observations || [], 'None recorded.');
  doc.keyValue('Duration', assessment.symptomDuration || '');
  doc.subheading('Clinical note');
  doc.paragraph(assessment.clinicalNote || 'Examination findings and clinical notes not recorded.');
  doc.heading("Doctor's assessment and plan");
  doc.subheading('Clinical assessment — doctor authored');
  doc.paragraph(assessment.doctorAssessment || 'Not recorded.');
  doc.subheading('Treatment and follow-up plan — doctor authored');
  doc.paragraph(assessment.plan || 'Treatment plan has not been documented.');
  doc.paragraph('Structured medication, dosage and frequency information was not recorded in this assessment. Consult the doctor-authored plan for any instructions.',{size:9,gray:.4});

  const modelUnavailable = assessment.modelStatus === 'unavailable';
  doc.ensurePage();
  if (doc.y < BOTTOM_LIMIT + (modelUnavailable ? 72 : 142)) doc.newPage();
  if (!modelUnavailable) doc.heading('Model output');
  if (modelUnavailable) {
    // The record was saved while the service was down. Printing a blank
    // "predicted condition" would look like a missing result instead of an
    // explicit decision not to run the model.
    doc.paragraph('No condition was predicted. The model may have been skipped or unavailable. The doctor-authored assessment and plan are the clinical record.', { gray: 0.2 });
  } else {
    doc.paragraph('Experimental decision-support suggestion — not a confirmed diagnosis.',{size:9,bold:true});
    doc.keyValue('Predicted condition', assessment.predictedDisease || 'Not recorded');
    doc.keyValue('Model version', assessment.modelVersion || '');
    const modelSymptoms = [...(assessment.patientReported || []), ...(assessment.clinicianAdded || [])];
    doc.keyValue('Symptoms used by the model', String(modelSymptoms.length));
    // A confidence value is printed only when the model actually supplied one.
    if (typeof assessment.modelConfidence === 'number' && Number.isFinite(assessment.modelConfidence)) {
      doc.keyValue('Model confidence', `${(assessment.modelConfidence * 100).toFixed(1)}%`);
    } else {
      doc.paragraph('This model version does not provide a calibrated probability, so no confidence percentage is reported.', { size: 9, gray: 0.35 });
    }
    doc.paragraph(assessment.description || 'No description is available for this condition.', { gray: 0.2 });

    doc.heading('Guidance from the dataset');
    doc.paragraph('General dataset-associated guidance requiring clinician review. It is not a prescription, dose or individually validated treatment plan.', { size: 9, gray: 0.4 });
    doc.subheading('Precautions');
    doc.bullets(assessment.precautions, 'No precautions were available.');
    doc.subheading('Medication information');
    doc.bullets(assessment.medications, 'No medication information was available.');
    doc.subheading('Diet');
    doc.bullets(assessment.diet, 'No diet guidance was available.');
    doc.subheading('Workout');
    doc.bullets(assessment.workout, 'No workout guidance was available.');
  }

  doc.ensurePage();
  if(doc.y < BOTTOM_LIMIT + (modelUnavailable ? 70 : 110)) doc.newPage();
  if(modelUnavailable) doc.subheading('Follow-up and recording clinician');
  else doc.heading('Follow-up and recording clinician');
  if(assessment.followUpDate) doc.keyValue('Follow-up date',dateText(assessment.followUpDate));
  doc.paragraph(assessment.followUpInstructions || 'Separate follow-up instructions not recorded. See the doctor-authored plan.');
  doc.paragraph(`Recorded by ${assessment.doctorName || 'clinician not recorded'}${assessment.doctorCredentials ? ', '+assessment.doctorCredentials : ''}. Report created ${dateText(generatedAt)}.`,{size:9,gray:.35});

  if (!modelUnavailable) doc.heading('Disclaimer');
  else doc.space(6);
  if(!modelUnavailable) doc.paragraph(assessment.disclaimer
    || 'Experimental prototype: this output is decision support, not a confirmed diagnosis.', { size: 9, gray: 0.35 });

  doc.paragraph('HelloDoc is an experimental decision support prototype. Dataset suggestions require clinician review and are not individualized prescriptions. Confidential: share this report only with the patient and authorized care providers.',{size:9,gray:.35});
  const pages = doc.finish();
  return buildPdfBuffer(pages);
}

function buildPdfBuffer(pageContents) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const logoIndex = add(`<< /Type /XObject /Subtype /Image /Width 445 /Height 180 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${LOGO.length} >>\nstream\n${LOGO.toString('latin1')}\nendstream`);
  const fontRegular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const catalogIndex = add(null); // reserved
  const pagesIndex = add(null); // reserved

  const pageIndexes = [];
  for (const content of pageContents) {
    const stream = content.join('\n');
    const contentIndex = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    pageIndexes.push(add(
      `<< /Type /Page /Parent ${pagesIndex} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /XObject << /Logo ${logoIndex} 0 R >> /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> ` +
      `/Contents ${contentIndex} 0 R >>`
    ));
  }

  objects[catalogIndex - 1] = `<< /Type /Catalog /Pages ${pagesIndex} 0 R >>`;
  objects[pagesIndex - 1] = `<< /Type /Pages /Count ${pageIndexes.length} /Kids [${pageIndexes.map((i) => `${i} 0 R`).join(' ')}] >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogIndex} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

module.exports = { renderAssessmentReport, humanize };
