#!/usr/bin/env node
/**
 * Converts AUDIT_REPORT.md to a formatted Word document.
 * Preprocesses mermaid diagrams and custom code-citation fences for DOCX compatibility.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const inputPath = path.join(root, 'AUDIT_REPORT.md');
const outputPath = path.join(root, 'AUDIT_REPORT.docx');
const preprocessedPath = path.join(root, 'AUDIT_REPORT.docx.md');

function preprocessMarkdown(source) {
  let md = source;

  // Replace mermaid code blocks with readable placeholders
  md = md.replace(/```mermaid\n([\s\S]*?)```/g, (_match, diagram) => {
    const lines = diagram
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 12);
    const summary = lines.join(' → ');
    return `\n> **Diagram (flowchart):** ${summary}\n>\n> *Full interactive diagram available in AUDIT_REPORT.md.*\n`;
  });

  // Normalize custom code-citation fences (startLine:endLine:filepath) to standard fenced blocks
  md = md.replace(/```(\d+:\d+:[^\n]+)\n([\s\S]*?)```/g, (_match, cite, code) => {
    return `\n\`\`\`\n// ${cite}\n${code}\`\`\`\n`;
  });

  // Word handles tables better without over-wide separator rows; keep as-is

  return md;
}

async function main() {
  const { convertMarkdownToBuffer } = await import('@mohtasham/md-to-docx');

  const optionsPath = path.join(__dirname, 'audit-docx-options.json');
  const options = JSON.parse(fs.readFileSync(optionsPath, 'utf8'));

  const source = fs.readFileSync(inputPath, 'utf8');
  const processed = preprocessMarkdown(source);
  fs.writeFileSync(preprocessedPath, processed, 'utf8');

  const buffer = await convertMarkdownToBuffer(processed, options);
  fs.writeFileSync(outputPath, buffer);

  fs.unlinkSync(preprocessedPath);

  console.log(`Wrote ${outputPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
