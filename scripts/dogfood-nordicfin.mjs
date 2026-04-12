#!/usr/bin/env node
/**
 * dogfood-nordicfin.mjs — Direct V1 audit execution for dogfood demo.
 *
 * Bypasses orchestrator /api/tools fold layer that truncates output.
 * Documents the client-facing bug as Friction #1+#2.
 */
import { runAudit } from '../src/compliance/ai-act-auditor.ts'
import { writeFileSync } from 'fs'

const NORDICFIN_STACK = [
  {
    name: 'credit-scorer-ml',
    category: 'ml-model',
    provider: 'internal',
    description: 'Gradient boosting model for consumer credit risk decisions',
    risk_level: 'high',
    data_types: ['financial', 'income', 'credit-history'],
    has_human_oversight: false,
    has_risk_assessment: false,
    has_transparency_notice: false,
    has_data_governance: true,
    has_monitoring: false,
    has_documentation: true,
    logs_retention_days: 90,
  },
  {
    name: 'aml-transaction-monitor',
    category: 'ml-model',
    provider: 'vendor-xyz',
    description: 'Anomaly detection on transaction streams for AML',
    risk_level: 'high',
    data_types: ['financial', 'transaction', 'behavioral'],
    has_human_oversight: true,
    has_risk_assessment: true,
    has_transparency_notice: false,
    has_data_governance: true,
    has_monitoring: true,
    has_documentation: false,
    logs_retention_days: 365,
  },
  {
    name: 'customer-chatbot',
    category: 'ml-model',
    provider: 'openai',
    description: 'GPT-4 customer support chatbot',
    risk_level: 'limited',
    data_types: ['pii', 'chat'],
    has_human_oversight: true,
    has_risk_assessment: false,
    has_transparency_notice: true,
    has_data_governance: false,
    has_monitoring: true,
    has_documentation: false,
    logs_retention_days: 30,
  },
  {
    name: 'kyc-document-parser',
    category: 'ml-model',
    provider: 'internal',
    description: 'OCR + NLP for KYC document verification',
    risk_level: 'high',
    data_types: ['pii', 'biometric', 'financial'],
    has_human_oversight: false,
    has_risk_assessment: false,
    has_transparency_notice: false,
    has_data_governance: false,
    has_monitoring: false,
    has_documentation: false,
    logs_retention_days: 180,
  },
  {
    name: 'fraud-alert-queue',
    category: 'deployment',
    provider: 'internal',
    description: 'Queue + dashboard for fraud alerts routed to compliance officers',
    risk_level: 'limited',
    data_types: ['financial', 'behavioral'],
    has_human_oversight: true,
    has_risk_assessment: false,
    has_transparency_notice: false,
    has_data_governance: true,
    has_monitoring: true,
    has_documentation: true,
    logs_retention_days: 730,
  },
]

const t0 = Date.now()
const report = runAudit(NORDICFIN_STACK)
const durationMs = Date.now() - t0

console.log(`Audit completed in ${durationMs}ms`)
console.log(`Compliance score: ${report.compliance_score}/100`)
console.log(`Gaps: ${report.total_gaps} total | ${report.critical_gaps} critical | ${report.high_gaps} high | ${report.medium_gaps} medium | ${report.low_gaps} low`)
console.log(`Components: ${report.stack_items_count}`)

// Write full report to demo folder
const demoPath = 'docs/dogfood/nordicfin-audit-report.json'
writeFileSync(demoPath, JSON.stringify(report, null, 2))

// Also write human-readable markdown
const mdPath = 'docs/dogfood/nordicfin-audit-report.md'
const lines = [
  `# NordicFin ApS — EU AI Act Annex III Compliance Audit`,
  ``,
  `**Audit ID:** ${report.audit_id}`,
  `**Generated:** ${report.audited_at}`,
  `**Components audited:** ${report.stack_items_count}`,
  `**Compliance score:** ${report.compliance_score}/100`,
  ``,
  `## Executive summary`,
  ``,
  report.summary,
  ``,
  `## Gap breakdown`,
  ``,
  `| Severity | Count |`,
  `|----------|-------|`,
  `| 🔴 Critical | ${report.critical_gaps} |`,
  `| 🟠 High | ${report.high_gaps} |`,
  `| 🟡 Medium | ${report.medium_gaps} |`,
  `| 🟢 Low | ${report.low_gaps} |`,
  ``,
  `## Gaps in detail`,
  ``,
]
for (const g of report.gaps) {
  lines.push(`### ${g.severity.toUpperCase()} — ${g.article}: ${g.requirement}`)
  lines.push(``)
  lines.push(`- **Status:** ${g.status}`)
  lines.push(`- **Affected:** ${g.affected_components.join(', ')}`)
  lines.push(`- **Evidence:** ${g.evidence ?? '_none_'}`)
  lines.push(`- **Remediation:** ${g.remediation}`)
  lines.push(`- **Deadline:** ${g.deadline}`)
  lines.push(``)
}
writeFileSync(mdPath, lines.join('\n'))

console.log(`\n✅ Full report: ${demoPath}`)
console.log(`✅ Human-readable: ${mdPath}`)
console.log(`\nFriction log:`)
console.log(`  F1 [P1] /api/tools/ folds output — client REST demo unusable`)
console.log(`  F2 [P0] No :ComplianceReport persisted — audit_id is dangling`)
