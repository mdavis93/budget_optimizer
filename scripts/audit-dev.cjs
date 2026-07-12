#!/usr/bin/env node
/**
 * Full dev/build dependency-tree audit gate.
 *
 * Complements the production-critical gate (`pnpm audit --prod --audit-level
 * critical`) by failing the build on any advisory at or above HIGH across the
 * entire tree, except advisories explicitly deferred to a tracked migration
 * plan (see IGNORED_GHSAS).
 *
 * The ignore list lives here (rather than in pnpm's auditConfig) because the
 * location pnpm reads that setting from is version-sensitive and emits
 * deprecation warnings; a small script keeps the gate behaviour stable and
 * self-documenting across pnpm upgrades.
 */
const { execSync } = require('node:child_process');

const THRESHOLD = 'high';
const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

// Allowlist for advisories deferred to a tracked major migration. Empty after
// the Electron 33 → 42 upgrade; add GHSA ids here (never silently widen the
// severity threshold) when an advisory is genuinely blocked on planned work.
const IGNORED_GHSAS = new Set([]);

function getAuditReport() {
  try {
    return execSync('pnpm audit --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    // pnpm audit exits non-zero whenever advisories exist; the JSON report is
    // still emitted on stdout, so reuse it rather than treating this as fatal.
    return err.stdout ? err.stdout.toString() : '';
  }
}

const raw = getAuditReport();
if (!raw.trim()) {
  console.error('audit:dev: no audit output received from `pnpm audit --json`.');
  process.exit(1);
}

const report = JSON.parse(raw);
const advisories = Object.values(report.advisories ?? {});
const threshold = SEVERITY_RANK[THRESHOLD];

const blocking = advisories.filter(
  (a) => SEVERITY_RANK[a.severity] >= threshold && !IGNORED_GHSAS.has(a.github_advisory_id)
);

if (blocking.length > 0) {
  console.error(`audit:dev: ${blocking.length} advisory(ies) at or above ${THRESHOLD}:`);
  for (const a of blocking) {
    console.error(`  - [${a.severity}] ${a.module_name} (${a.github_advisory_id}): ${a.title}`);
  }
  console.error('Resolve them (bump/override) or, if deferred to a migration plan, add the GHSA to IGNORED_GHSAS with a justification.');
  process.exit(1);
}

console.log(`audit:dev: clean at or above ${THRESHOLD} (${IGNORED_GHSAS.size} deferred advisory(ies) ignored).`);
