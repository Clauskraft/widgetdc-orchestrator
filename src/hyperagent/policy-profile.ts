/**
 * selectProfile — W5 of SYSTEM_WIRING_PLAN.md
 *
 * Chooses the right HyperAgent PolicyProfile for a /produce request based on
 * the product_type and compliance_tier of the incoming features.  Keeps the
 * orchestrator's gating logic local to one place so changes to product mix
 * don't require touching the main hyperagent module.
 */

export type PolicyProfileId = 'read_only' | 'staged_write' | 'production_write'

export interface ProduceRequestLike {
  product_type?: 'architecture' | 'document' | 'presentation' | 'diagram' | 'pdf' | 'code'
}

export interface RequestFeaturesLike {
  compliance_tier?: 'public' | 'internal' | 'legal' | 'health' | 'sensitive'
  task_type?: string
  pii_present?: boolean
}

export function selectProfile(
  req: ProduceRequestLike,
  features: RequestFeaturesLike = {},
): PolicyProfileId {
  // legal / health compliance always requires production_write for
  // crypto-shred + audit-chain + customer-facing evidence.
  if (features.compliance_tier === 'legal' || features.compliance_tier === 'health') {
    return 'production_write'
  }

  // Architecture runs persist :ArchitectureBOM + :PhantomComponent — staged
  // write is enough (no external side-effects).
  if (req.product_type === 'architecture') {
    return 'staged_write'
  }

  // Document / presentation / pdf / diagram — plan writes a :ProductionOrder
  // and composer artefacts.  Staged-write covers these.
  if (req.product_type === 'document' || req.product_type === 'presentation' ||
      req.product_type === 'pdf' || req.product_type === 'diagram') {
    return 'staged_write'
  }

  // Code generation can have wider blast radius — require production_write.
  if (req.product_type === 'code') {
    return 'production_write'
  }

  // Fallback: read-only (e.g. /patterns lookup doesn't hit /produce).
  return 'read_only'
}
