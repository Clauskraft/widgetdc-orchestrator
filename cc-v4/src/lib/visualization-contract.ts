export type VisualizationAudience = 'operator' | 'executive' | 'stakeholder'
export type VisualizationAbstractionLevel = 'service' | 'system' | 'enterprise'
export type VisualizationArtifactKind = 'compliance_audit' | 'deliverable_draft' | 'knowledge_artifact'
export type DeliverableVisualizationType = 'analysis' | 'roadmap' | 'assessment'

export type VisualizationContract = {
  family: string
  templateId: string
  audience: VisualizationAudience
  abstractionLevel: VisualizationAbstractionLevel
}

export type CanvasTemplate = {
  canvasTemplateId: string
  canvasKind: string
}

export type VisualizationProperties = Record<string, string>

type ResolveArtifactContractInput =
  | { kind: 'compliance_audit' }
  | { kind: 'deliverable_draft'; deliverableType: DeliverableVisualizationType }
  | { kind: 'knowledge_artifact' }

export function resolveArtifactVisualizationContract(input: ResolveArtifactContractInput): VisualizationContract {
  if (input.kind === 'compliance_audit') {
    return {
      family: 'evidence_audit',
      templateId: 'obsidian.audit.evidence.v1',
      audience: 'operator',
      abstractionLevel: 'service',
    }
  }

  if (input.kind === 'deliverable_draft') {
    return {
      family: 'executive_brief',
      templateId: `obsidian.deliverable.${input.deliverableType}.v1`,
      audience: 'executive',
      abstractionLevel: input.deliverableType === 'roadmap' ? 'system' : 'service',
    }
  }

  return {
    family: 'knowledge_artifact',
    templateId: 'obsidian.generic.note.v1',
    audience: 'stakeholder',
    abstractionLevel: 'system',
  }
}

export function buildVisualizationProperties(
  input: ResolveArtifactContractInput,
  extras: Record<string, string | number | boolean | null> = {}
): Record<string, string | number | boolean | null> {
  const contract = resolveArtifactVisualizationContract(input)
  return {
    ...extras,
    visualization_family: contract.family,
    template_id: contract.templateId,
    audience: contract.audience,
    abstraction_level: contract.abstractionLevel,
  }
}

export function resolveCanvasTemplate(input: ResolveArtifactContractInput): CanvasTemplate {
  if (input.kind === 'compliance_audit') {
    return {
      canvasTemplateId: 'obsidian.canvas.audit-risk-map.v1',
      canvasKind: 'compliance_audit_canvas',
    }
  }

  if (input.kind === 'deliverable_draft') {
    return {
      canvasTemplateId: `obsidian.canvas.deliverable.${input.deliverableType}.v1`,
      canvasKind: 'deliverable_draft_canvas',
    }
  }

  return {
    canvasTemplateId: 'obsidian.canvas.generic-note.v1',
    canvasKind: 'knowledge_artifact_canvas',
  }
}

type CanvasNode = {
  id: string
  type: 'text'
  x: number
  y: number
  width: number
  height: number
  color?: string
  text: string
}

type CanvasEdge = {
  id: string
  fromNode: string
  fromSide: 'top' | 'right' | 'bottom' | 'left'
  toNode: string
  toSide: 'top' | 'right' | 'bottom' | 'left'
  color?: string
  label?: string
}

export type CanvasPayload = {
  title: string
  kind: string
  folder: string
  properties: Record<string, string | number | boolean | null>
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

function splitSections(markdown: string): string[] {
  return markdown
    .split(/\n##\s+/)
    .map((part, index) => index === 0 ? part.trim() : `## ${part.trim()}`)
    .filter(Boolean)
}

function truncate(value: string, max = 280): string {
  return value.length > max ? `${value.slice(0, max).trim()}…` : value
}

export function buildCanvasPayload(
  input: ResolveArtifactContractInput,
  args: {
    title: string
    markdown: string
    client?: string
    sourceTool: string
    status?: string
    citationsCount?: number
  }
): CanvasPayload {
  const contract = resolveArtifactVisualizationContract(input)
  const canvasTemplate = resolveCanvasTemplate(input)
  const sections = splitSections(args.markdown).slice(0, 4)
  const titleNode: CanvasNode = {
    id: 'title',
    type: 'text',
    x: 0,
    y: 0,
    width: 360,
    height: 180,
    color: '2',
    text: `# ${args.title}\n\nFamily: ${contract.family}\nTemplate: ${contract.templateId}\nAudience: ${contract.audience}\nAbstraction: ${contract.abstractionLevel}`,
  }
  const sectionNodes: CanvasNode[] = sections.map((section, index) => ({
    id: `section-${index + 1}`,
    type: 'text',
    x: 420 * ((index % 2) + 1),
    y: Math.floor(index / 2) * 260,
    width: 360,
    height: 220,
    color: index % 2 === 0 ? '4' : '5',
    text: truncate(section, 420),
  }))

  const edges: CanvasEdge[] = sectionNodes.map((node, index) => ({
    id: `edge-${index + 1}`,
    fromNode: 'title',
    fromSide: 'right',
    toNode: node.id,
    toSide: 'left',
    color: '3',
    label: index === 0 ? 'primary flow' : 'supporting section',
  }))

  return {
    title: args.title,
    kind: canvasTemplate.canvasKind,
    folder: input.kind === 'compliance_audit' ? 'WidgeTDC/Compliance Audits' : 'WidgeTDC/Deliverables',
    properties: {
      client: args.client ?? 'Unknown',
      source_tool: args.sourceTool,
      status: args.status ?? 'success',
      citations_count: args.citationsCount ?? 0,
      visualization_family: contract.family,
      template_id: contract.templateId,
      audience: contract.audience,
      abstraction_level: contract.abstractionLevel,
      canvas_template_id: canvasTemplate.canvasTemplateId,
    },
    nodes: [titleNode, ...sectionNodes],
    edges,
  }
}

export function parseFrontmatter(content: string): { properties: VisualizationProperties; body: string } {
  if (!content.startsWith('---\n')) {
    return { properties: {}, body: content }
  }

  const end = content.indexOf('\n---\n', 4)
  if (end === -1) {
    return { properties: {}, body: content }
  }

  const rawFrontmatter = content.slice(4, end)
  const body = content.slice(end + 5)
  const properties: VisualizationProperties = {}

  for (const line of rawFrontmatter.split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^"(.*)"$/, '$1')
    if (key) properties[key] = value
  }

  return { properties, body }
}

export function resolveVisualizationContractFromProperties(properties: VisualizationProperties): (VisualizationContract & { rationale: string }) | null {
  const kind = properties.widgetdc_kind as VisualizationArtifactKind | undefined
  if (!kind) return null

  const fallback =
    kind === 'deliverable_draft'
      ? resolveArtifactVisualizationContract({
          kind,
          deliverableType: properties.template_id?.split('.').at(-2) as DeliverableVisualizationType || 'analysis',
        })
      : resolveArtifactVisualizationContract({ kind })

  const family = properties.visualization_family ?? fallback.family
  const templateId = properties.template_id ?? fallback.templateId
  const audience = (properties.audience as VisualizationAudience | undefined) ?? fallback.audience
  const abstractionLevel = (properties.abstraction_level as VisualizationAbstractionLevel | undefined) ?? fallback.abstractionLevel

  return {
    family,
    templateId,
    audience,
    abstractionLevel,
    rationale: `Deterministic route from kind=${kind}, audience=${audience}, abstraction=${abstractionLevel} to family=${family} and template=${templateId}.`,
  }
}
