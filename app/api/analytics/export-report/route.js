export const runtime = "nodejs";

import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat } from "docx";

// Parse the AI analysis text into sections
function parseSections(text) {
  const SECTION_LABELS = {
    SECTION_1: "Popular Flows",
    SECTION_2: "Drop-off & Friction",
    SECTION_3: "Engagement Highlights",
    SECTION_4: "Why People Aren't Buying",
  };

  const sectionMap = {};
  let current = null;
  for (const line of text.split("\n")) {
    const match = line.match(/SECTION_(\d+)/);
    if (match) {
      current = `SECTION_${match[1]}`;
      sectionMap[current] = [];
    } else if (current) {
      sectionMap[current].push(line);
    }
  }
  return { sectionMap, SECTION_LABELS };
}

// ── DOCX Generator ──────────────────────────────────────────────
function buildDocx(analysisText, date, userCount) {
  const { sectionMap, SECTION_LABELS } = parseSections(analysisText);

  const children = [];

  // Title
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: `TrueHue User Behavior Analysis`, bold: true, size: 36 })],
    }),
    new Paragraph({
      children: [new TextRun({ text: `Date: ${date}  ·  ${userCount} active users`, color: "7B241C", size: 22 })],
      spacing: { after: 400 },
    })
  );

  const SECTION_KEYS = ["SECTION_1", "SECTION_2", "SECTION_3", "SECTION_4"];

  for (const key of SECTION_KEYS) {
    const label = SECTION_LABELS[key];
    const lines = (sectionMap[key] || []);
    if (!lines.filter(l => l.trim()).length) continue;

    // Section heading
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: label, bold: true, color: "AB1F10", size: 28 })],
        spacing: { before: 400, after: 160 },
      })
    );

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "---") continue;

      // Numbered header: "1. **Heading:**"
      const numMatch = trimmed.match(/^(\d+)\.\s+\*\*(.+?)\*\*:?\s*(.*)$/);
      if (numMatch) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: `${numMatch[1]}. ${numMatch[2]}${numMatch[3] ? " — " + numMatch[3] : ""}`, bold: true, size: 24 })],
            spacing: { before: 200, after: 80 },
          })
        );
        continue;
      }

      // Subheading: **text**
      if (trimmed.match(/^\*\*[^*]+\*\*:?$/) && !trimmed.startsWith("-")) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: trimmed.replace(/\*\*/g, "").replace(/:$/, ""), bold: true, size: 22, color: "7B241C" })],
            spacing: { before: 160, after: 60 },
          })
        );
        continue;
      }

      // Bullet
      if (trimmed.match(/^[-•]\s+/)) {
        const content = trimmed.replace(/^[-•]\s+/, "").replace(/\*\*/g, "");
        const indent = line.match(/^\s+/) ? line.match(/^\s+/)[0].length : 0;
        children.push(
          new Paragraph({
            numbering: { reference: "bullets", level: indent > 2 ? 1 : 0 },
            children: [new TextRun({ text: content, size: 20 })],
          })
        );
        continue;
      }

      // Table row — skip (too complex for docx inline, render as plain text)
      if (trimmed.startsWith("|")) {
        const cells = trimmed.split("|").map(c => c.trim()).filter(Boolean);
        if (cells.every(c => c.match(/^[-:]+$/))) continue; // separator row
        children.push(
          new Paragraph({
            children: [new TextRun({ text: cells.join("   ·   "), size: 20, color: "4A2020" })],
            spacing: { after: 60 },
          })
        );
        continue;
      }

      // Plain text
      if (trimmed) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: trimmed.replace(/\*\*/g, ""), size: 20, color: "4A2020" })],
            spacing: { after: 80 },
          })
        );
      }
    }
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
            { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 1080, hanging: 360 } } } },
          ],
        },
      ],
    },
    styles: {
      default: { document: { run: { font: "Arial", size: 20 } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal",
          run: { size: 36, bold: true, font: "Arial", color: "1A0A09" },
          paragraph: { spacing: { before: 0, after: 200 } } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 28, bold: true, font: "Arial", color: "AB1F10" },
          paragraph: { spacing: { before: 400, after: 160 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 24, bold: true, font: "Arial", color: "1A0A09" },
          paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 1 } },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

// ── PDF Generator ────────────────────────────────────────────────
async function buildPdf(analysisText, date, userCount) {
  // Dynamic import since reportlab is Python — we use a subprocess approach via a temp script
  // Instead, we use a pure-JS PDF approach with pdfkit via a script
  const { execSync } = await import("child_process");
  const { writeFileSync, readFileSync, unlinkSync } = await import("fs");
  const { join } = await import("path");
  const os = await import("os");

  const tmpDir = os.tmpdir();
  const scriptPath = join(tmpDir, `truehue_pdf_${Date.now()}.py`);
  const outPath = join(tmpDir, `truehue_report_${Date.now()}.pdf`);

  const { sectionMap, SECTION_LABELS } = parseSections(analysisText);

  // Build a list of content items for Python to render
  const items = [];
  items.push({ type: "title", text: `TrueHue User Behavior Analysis` });
  items.push({ type: "subtitle", text: `${date}  ·  ${userCount} active users` });

  const SECTION_KEYS = ["SECTION_1", "SECTION_2", "SECTION_3", "SECTION_4"];
  for (const key of SECTION_KEYS) {
    const label = SECTION_LABELS[key];
    const lines = (sectionMap[key] || []);
    if (!lines.filter(l => l.trim()).length) continue;

    items.push({ type: "section", text: label });

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "---") continue;

      const numMatch = trimmed.match(/^(\d+)\.\s+\*\*(.+?)\*\*:?\s*(.*)$/);
      if (numMatch) {
        items.push({ type: "h2", text: `${numMatch[1]}. ${numMatch[2]}${numMatch[3] ? " — " + numMatch[3] : ""}` });
        continue;
      }
      if (trimmed.match(/^\*\*[^*]+\*\*:?$/) && !trimmed.startsWith("-")) {
        items.push({ type: "subheading", text: trimmed.replace(/\*\*/g, "").replace(/:$/, "") });
        continue;
      }
      if (trimmed.match(/^[-•]\s+/)) {
        const indent = line.match(/^\s+/) ? line.match(/^\s+/)[0].length > 2 : false;
        items.push({ type: "bullet", text: trimmed.replace(/^[-•]\s+/, "").replace(/\*\*/g, ""), indent });
        continue;
      }
      if (trimmed.startsWith("|")) {
        const cells = trimmed.split("|").map(c => c.trim()).filter(Boolean);
        if (cells.every(c => c.match(/^[-:]+$/))) continue;
        items.push({ type: "tablerow", cells });
        continue;
      }
      if (trimmed) {
        items.push({ type: "text", text: trimmed.replace(/\*\*/g, "") });
      }
    }
  }

  const itemsJson = JSON.stringify(items).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  const pythonScript = `
import json
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
from reportlab.lib.enums import TA_LEFT

items = json.loads('${itemsJson}')

doc = SimpleDocTemplate(
    '${outPath}',
    pagesize=A4,
    rightMargin=2*cm, leftMargin=2*cm,
    topMargin=2*cm, bottomMargin=2*cm,
    title="TrueHue Analysis"
)

RED = colors.HexColor('#AB1F10')
DARK_RED = colors.HexColor('#7B241C')
DARK = colors.HexColor('#1A0A09')
MUTED = colors.HexColor('#4A2020')
CREAM = colors.HexColor('#FFF8F7')

styles = getSampleStyleSheet()

title_style = ParagraphStyle('TH_Title', parent=styles['Normal'],
    fontSize=24, fontName='Helvetica-Bold', textColor=RED,
    spaceAfter=6, spaceBefore=0)

subtitle_style = ParagraphStyle('TH_Sub', parent=styles['Normal'],
    fontSize=11, fontName='Helvetica', textColor=DARK_RED,
    spaceAfter=20)

section_style = ParagraphStyle('TH_Section', parent=styles['Normal'],
    fontSize=15, fontName='Helvetica-Bold', textColor=RED,
    spaceBefore=20, spaceAfter=8)

h2_style = ParagraphStyle('TH_H2', parent=styles['Normal'],
    fontSize=12, fontName='Helvetica-Bold', textColor=DARK,
    spaceBefore=10, spaceAfter=4)

subheading_style = ParagraphStyle('TH_Subhead', parent=styles['Normal'],
    fontSize=11, fontName='Helvetica-Bold', textColor=DARK_RED,
    spaceBefore=8, spaceAfter=2)

bullet_style = ParagraphStyle('TH_Bullet', parent=styles['Normal'],
    fontSize=10, fontName='Helvetica', textColor=DARK,
    leftIndent=16, bulletIndent=4, spaceAfter=3,
    leading=14)

bullet_indent_style = ParagraphStyle('TH_BulletIn', parent=styles['Normal'],
    fontSize=10, fontName='Helvetica', textColor=MUTED,
    leftIndent=32, bulletIndent=20, spaceAfter=2,
    leading=14)

text_style = ParagraphStyle('TH_Text', parent=styles['Normal'],
    fontSize=10, fontName='Helvetica', textColor=MUTED,
    spaceAfter=4, leading=14)

tablerow_style = ParagraphStyle('TH_Table', parent=styles['Normal'],
    fontSize=10, fontName='Helvetica', textColor=DARK,
    spaceAfter=3, leading=13)

story = []

for item in items:
    t = item.get('type')
    text = item.get('text', '')

    if t == 'title':
        story.append(Paragraph(text, title_style))
    elif t == 'subtitle':
        story.append(Paragraph(text, subtitle_style))
        story.append(HRFlowable(width="100%", thickness=1, color=RED, spaceAfter=16))
    elif t == 'section':
        story.append(Spacer(1, 8))
        story.append(Paragraph(text.upper(), section_style))
        story.append(HRFlowable(width="100%", thickness=0.5, color=DARK_RED, spaceAfter=6))
    elif t == 'h2':
        story.append(Paragraph(text, h2_style))
    elif t == 'subheading':
        story.append(Paragraph(text, subheading_style))
    elif t == 'bullet':
        bullet_char = u'\\u2022'
        style = bullet_indent_style if item.get('indent') else bullet_style
        story.append(Paragraph(f'{bullet_char} {text}', style))
    elif t == 'tablerow':
        cells = item.get('cells', [])
        story.append(Paragraph('  ·  '.join(cells), tablerow_style))
    elif t == 'text':
        story.append(Paragraph(text, text_style))

doc.build(story)
print('ok')
`;

  writeFileSync(scriptPath, pythonScript);
  try {
    execSync(`python3 "${scriptPath}"`, { timeout: 30000 });
    const pdfBuffer = readFileSync(outPath);
    return pdfBuffer;
  } finally {
    try { unlinkSync(scriptPath); } catch {}
    try { unlinkSync(outPath); } catch {}
  }
}

// ── Handler ──────────────────────────────────────────────────────
export async function POST(req) {
  try {
    const { text, date, userCount, format } = await req.json();
    if (!text) return new Response(JSON.stringify({ error: "No analysis text" }), { status: 400 });

    if (format === "docx") {
      const buffer = await buildDocx(text, date, userCount);
      return new Response(buffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="truehue-analysis-${date}.docx"`,
        },
      });
    }

    if (format === "pdf") {
      const buffer = await buildPdf(text, date, userCount);
      return new Response(buffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="truehue-analysis-${date}.pdf"`,
        },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid format" }), { status: 400 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}