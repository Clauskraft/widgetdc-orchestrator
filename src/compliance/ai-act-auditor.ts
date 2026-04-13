/**
 * ai-act-auditor.ts — EU AI Act Annex III compliance gap auditor.
 *
 * Crosswalks a client's tech stack against EU AI Act Annex III requirements.
 * Returns gap report with severity, affected articles, and remediation steps.
 *
 * V1: "Upload klient-stack → få AI-Act Annex III gap-rapport på 5 min"
 *
 * Constraints:
 * - NO new node types — uses existing :OSCALControl, :ComplianceGap from Phantom BOM
 * - AgentResponse wire format on output
 * - MERGE idempotency on all persistence
 */
import { logger } from '../logger.js'
import type { AgentRequest, AgentResponse } from '@widgetdc/contracts/agent'
import { agentSuccess, agentFailure } from '../agent/agent-interface.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StackItem {
  name: string
  category: string           // 'ml-model' | 'data-pipeline' | 'deployment' | 'monitoring' | 'governance'
  provider?: string
  description?: string
  risk_level?: 'minimal' | 'limited' | 'high' | 'unacceptable'
  data_types?: string[]      // PII categories processed
  has_human_oversight?: boolean
  has_risk_assessment?: boolean
  has_transparency_notice?: boolean
  has_data_governance?: boolean
  has_monitoring?: boolean
  has_documentation?: boolean
  logs_retention_days?: number
}

export interface GapItem {
  article: string
  requirement: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  status: 'compliant' | 'partial' | 'non-compliant' | 'not-assessed'
  evidence?: string
  remediation: string
  affected_components: string[]
  deadline: string           // EU AI Act phase-in deadline
}

export interface AuditReport {
  audit_id: string
  audited_at: string
  stack_items_count: number
  total_gaps: number
  critical_gaps: number
  high_gaps: number
  medium_gaps: number
  low_gaps: number
  compliance_score: number    // 0-100
  gaps: GapItem[]
  summary: string
}

// ─── EU AI Act Annex III Requirements Matrix ─────────────────────────────────

const ANNEX_III_REQUIREMENTS = [
  {
    article: 'Art. 8',
    requirement: 'Risk Management System',
    check: (item: StackItem): GapItem => {
      if (item.risk_level === 'high' || item.risk_level === 'unacceptable') {
        return {
          article: 'Art. 8',
          requirement: 'Risk Management System for high-risk AI',
          severity: item.risk_level === 'unacceptable' ? 'critical' : 'high',
          status: item.has_risk_assessment ? 'partial' : 'non-compliant',
          evidence: item.has_risk_assessment ? 'Risk assessment documented' : 'No risk assessment found',
          remediation: 'Implement continuous risk management process per Annex III. Document all known and foreseeable risks. Define risk mitigation measures.',
          affected_components: [item.name],
          deadline: '2026-08-02',
        }
      }
      return {
        article: 'Art. 8',
        requirement: 'Risk Management System',
        severity: 'low',
        status: item.has_risk_assessment ? 'compliant' : 'not-assessed',
        evidence: item.risk_level ? `Risk level: ${item.risk_level}` : 'Risk level not classified',
        remediation: 'Consider risk assessment for future classification',
        affected_components: [item.name],
        deadline: '2026-08-02',
      }
    },
  },
  {
    article: 'Art. 9',
    requirement: 'Data & Data Governance',
    check: (item: StackItem): GapItem => {
      const hasPII = item.data_types?.some(d => ['personal', 'biometric', 'health', 'financial', 'behavioral'].includes(d))
      if (hasPII && !item.has_data_governance) {
        return {
          article: 'Art. 9',
          requirement: 'Data governance for AI systems using personal data',
          severity: 'high',
          status: 'non-compliant',
          evidence: `PII data types detected: ${item.data_types?.join(', ')}`,
          remediation: 'Implement data governance framework: data collection, processing, retention policies. Document data lineage and quality controls.',
          affected_components: [item.name],
          deadline: '2026-08-02',
        }
      }
      return {
        article: 'Art. 9',
        requirement: 'Data governance',
        severity: item.has_data_governance ? 'low' : 'medium',
        status: item.has_data_governance ? 'compliant' : (hasPII ? 'non-compliant' : 'not-assessed'),
        evidence: hasPII ? 'PII processing without governance' : 'No PII detected',
        remediation: item.has_data_governance ? 'Maintain current governance' : 'Document data processing practices',
        affected_components: [item.name],
        deadline: '2026-08-02',
      }
    },
  },
  {
    article: 'Art. 10',
    requirement: 'Technical Documentation',
    check: (item: StackItem): GapItem => ({
      article: 'Art. 10',
      requirement: 'Technical documentation for high-risk AI systems',
      severity: item.has_documentation ? 'low' : 'medium',
      status: item.has_documentation ? 'compliant' : 'partial',
      evidence: item.has_documentation ? 'Documentation present' : 'Documentation missing or incomplete',
      remediation: 'Create technical documentation per Annex IV: system architecture, training data, performance metrics, validation results.',
      affected_components: [item.name],
      deadline: '2026-08-02',
    }),
  },
  {
    article: 'Art. 12',
    requirement: 'Record-Keeping & Logging',
    check: (item: StackItem): GapItem => {
      const hasLogging = item.logs_retention_days && item.logs_retention_days >= 90
      return {
        article: 'Art. 12',
        requirement: 'Automatically generated logs for high-risk AI systems',
        severity: hasLogging ? 'low' : 'medium',
        status: hasLogging ? 'compliant' : (item.logs_retention_days ? 'partial' : 'non-compliant'),
        evidence: item.logs_retention_days ? `Logs retained: ${item.logs_retention_days} days` : 'No logging configured',
        remediation: 'Implement automatic logging with minimum 90-day retention. Include: input data, output, timestamp, operator ID, system state.',
        affected_components: [item.name],
        deadline: '2026-08-02',
      }
    },
  },
  {
    article: 'Art. 13',
    requirement: 'Transparency & Information to Users',
    check: (item: StackItem): GapItem => ({
      article: 'Art. 13',
      requirement: 'Transparency obligations — users must be informed they interact with AI',
      severity: item.has_transparency_notice ? 'low' : 'high',
      status: item.has_transparency_notice ? 'compliant' : 'non-compliant',
      evidence: item.has_transparency_notice ? 'Transparency notice present' : 'No transparency notice found',
      remediation: 'Implement clear user notification: "This system uses AI technology." Provide instructions for use, performance characteristics, and limitations.',
      affected_components: [item.name],
      deadline: '2026-08-02',
    }),
  },
  {
    article: 'Art. 14',
    requirement: 'Human Oversight',
    check: (item: StackItem): GapItem => ({
      article: 'Art. 14',
      requirement: 'Human oversight measures for high-risk AI systems',
      severity: item.has_human_oversight ? 'medium' : 'critical',
      status: item.has_human_oversight ? 'compliant' : 'non-compliant',
      evidence: item.has_human_oversight ? 'Human oversight implemented' : 'No human oversight mechanism found',
      remediation: 'Implement human-in-the-loop oversight: (1) Manual override capability, (2) Human review before critical decisions, (3) Stop/interrupt button, (4) Training for human overseers.',
      affected_components: [item.name],
      deadline: '2026-08-02',
    }),
  },
  {
    article: 'Art. 15',
    requirement: 'Accuracy, Robustness & Cybersecurity',
    check: (item: StackItem): GapItem => ({
      article: 'Art. 15',
      requirement: 'Achieve appropriate levels of accuracy, robustness, and cybersecurity',
      severity: item.has_monitoring ? 'medium' : 'high',
      status: item.has_monitoring ? 'partial' : 'non-compliant',
      evidence: item.has_monitoring ? 'Monitoring in place' : 'No accuracy/robustness monitoring detected',
      remediation: 'Implement: (1) Accuracy metrics with thresholds, (2) Robustness testing against adversarial inputs, (3) Cybersecurity measures per ENISA guidelines, (4) Regular performance validation.',
      affected_components: [item.name],
      deadline: '2026-08-02',
    }),
  },
]

// ─── Audit Engine ─────────────────────────────────────────────────────────────

/**
 * Run a full EU AI Act Annex III compliance audit against a tech stack.
 */
export function runAudit(stack: StackItem[]): AuditReport {
  const allGaps: GapItem[] = []

  for (const item of stack) {
    for (const req of ANNEX_III_REQUIREMENTS) {
      const gap = req.check(item)
      allGaps.push(gap)
    }
  }

  const criticalGaps = allGaps.filter(g => g.severity === 'critical').length
  const highGaps = allGaps.filter(g => g.severity === 'high').length
  const mediumGaps = allGaps.filter(g => g.severity === 'medium').length
  const lowGaps = allGaps.filter(g => g.severity === 'low').length

  // Compliance score: weighted inverse of gaps
  const maxPossible = stack.length * ANNEX_III_REQUIREMENTS.length
  const weightedScore = (
    (allGaps.filter(g => g.status === 'compliant').length * 1.0 +
     allGaps.filter(g => g.status === 'partial').length * 0.5) /
    maxPossible
  ) * 100

  const summary = generateSummary(allGaps, stack.length, weightedScore)

  return {
    audit_id: `ai-act-${Date.now().toString(36)}`,
    audited_at: new Date().toISOString(),
    stack_items_count: stack.length,
    total_gaps: allGaps.length,
    critical_gaps: criticalGaps,
    high_gaps: highGaps,
    medium_gaps: mediumGaps,
    low_gaps: lowGaps,
    compliance_score: Math.round(weightedScore * 10) / 10,
    gaps: allGaps,
    summary,
  }
}

function generateSummary(gaps: GapItem[], stackCount: number, score: number): string {
  const critical = gaps.filter(g => g.severity === 'critical').length
  const high = gaps.filter(g => g.severity === 'high').length
  const nonCompliant = gaps.filter(g => g.status === 'non-compliant').length

  if (critical > 0) {
    return `CRITICAL: ${critical} critical gaps found across ${stackCount} component(s). Immediate remediation required before AI Act enforcement deadline (Aug 2026). ${nonCompliant} components are non-compliant.`
  }
  if (high > 0) {
    return `HIGH RISK: ${high} high-severity gaps found. Score: ${score.toFixed(1)}/100. ${nonCompliant} non-compliant items require prioritized remediation.`
  }
  if (score >= 80) {
    return `GOOD: ${score.toFixed(1)}/100 compliance score. Minor gaps identified. Continue monitoring and maintain documentation.`
  }
  return `MODERATE: ${score.toFixed(1)}/100 compliance score. ${nonCompliant} non-compliant items. Schedule remediation plan.`
}

// ─── MCP Tool Handler ────────────────────────────────────────────────────────

/**
 * Process an AgentRequest to run an AI Act compliance audit.
 * Input: stack JSON in request.context.stack
 * Output: AgentResponse with audit report
 */
export async function handleComplianceAudit(request: AgentRequest): Promise<AgentResponse> {
  try {
    const stackData = request.context?.stack
    if (!stackData) {
      return agentFailure(request, 'No stack data provided. Include stack as JSON in context.stack')
    }

    const stack: StackItem[] = Array.isArray(stackData)
      ? stackData as StackItem[]
      : typeof stackData === 'string'
        ? JSON.parse(stackData) as StackItem[]
        : []

    if (stack.length === 0) {
      return agentFailure(request, 'Stack must be a non-empty array of StackItem objects')
    }

    const report = runAudit(stack)

    // P0 FIX: Persist to Neo4j as :ComplianceReport node
    await persistComplianceReport(report)

    // Build human-readable output
    const lines = [
      `# EU AI Act Annex III Compliance Audit`,
      ``,
      `**Audit ID:** ${report.audit_id}`,
      `**Date:** ${report.audited_at}`,
      `**Components Audited:** ${report.stack_items_count}`,
      `**Compliance Score:** ${report.compliance_score}/100`,
      ``,
      `## Gap Summary`,
      `| Severity | Count |`,
      `|----------|-------|`,
      `| 🔴 Critical | ${report.critical_gaps} |`,
      `| 🟠 High | ${report.high_gaps} |`,
      `| 🟡 Medium | ${report.medium_gaps} |`,
      `| 🟢 Low | ${report.low_gaps} |`,
      ``,
      `## Assessment`,
      report.summary,
      ``,
      `## Top Remediation Actions`,
    ]

    // Add top 5 most critical gaps
    const sorted = [...report.gaps].sort((a, b) => {
      const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 }
      return (sevOrder[a.severity] ?? 4) - (sevOrder[b.severity] ?? 4)
    }).slice(0, 5)

    for (const gap of sorted) {
      lines.push(``)
      lines.push(`### ${gap.article}: ${gap.requirement}`)
      lines.push(`- **Severity:** ${gap.severity}`)
      lines.push(`- **Status:** ${gap.status}`)
      lines.push(`- **Evidence:** ${gap.evidence || 'N/A'}`)
      lines.push(`- **Remediation:** ${gap.remediation}`)
      lines.push(`- **Deadline:** ${gap.deadline}`)
      lines.push(`- **Affected:** ${gap.affected_components.join(', ')}`)
    }

    return agentSuccess(request, lines.join('\n'), { input: 0, output: lines.length * 10 })
  } catch (err) {
    return agentFailure(request, err instanceof Error ? err.message : String(err))
  }
}

/**
 * Persist compliance report as :ComplianceReport node in Neo4j.
 * Uses MERGE idempotency on audit_id.
 */
export async function persistComplianceReport(report: AuditReport): Promise<void> {
  try {
    const { config } = await import('../config.js')
    await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.backendApiKey ? { 'Authorization': `Bearer ${config.backendApiKey}` } : {}),
      },
      body: JSON.stringify({
        tool: 'graph.write_cypher',
        payload: {
          query: `MERGE (cr:ComplianceReport {audit_id: $audit_id})
                  SET cr.framework = $framework,
                      cr.score = $score,
                      cr.critical_gaps = $critical_gaps,
                      cr.high_gaps = $high_gaps,
                      cr.medium_gaps = $medium_gaps,
                      cr.low_gaps = $low_gaps,
                      cr.total_gaps = $total_gaps,
                      cr.components_audited = $components_audited,
                      cr.generated_at = datetime($generated_at),
                      cr.persisted_at = datetime()`,
          params: {
            audit_id: report.audit_id,
            framework: 'EU AI Act Annex III',
            score: report.compliance_score,
            critical_gaps: report.critical_gaps,
            high_gaps: report.high_gaps,
            medium_gaps: report.medium_gaps,
            low_gaps: report.low_gaps,
            total_gaps: report.total_gaps,
            components_audited: report.stack_items_count,
            generated_at: report.audited_at,
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    }).catch(() => {})
  } catch {
    // Non-fatal — report returned regardless of persistence
  }
}
