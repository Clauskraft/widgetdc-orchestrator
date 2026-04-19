import { config } from '../config.js'

export interface VaultLayerMigrationCycleResult {
  backfilled: number
  promotedToCurated: number
  demotedToArchived: number
  durationMs: number
}

export interface VaultLayerMigrationCronResult extends VaultLayerMigrationCycleResult {
  endpoint: string
  summary: string
}

interface HttpResponseLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
}

type FetchLike = (input: string, init?: RequestInit) => Promise<HttpResponseLike>

function asFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function buildSummary(result: VaultLayerMigrationCycleResult): string {
  return `backfilled=${result.backfilled}, promoted=${result.promotedToCurated}, demoted=${result.demotedToArchived}, ${result.durationMs}ms`
}

export async function runVaultLayerMigrationCron(
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  now: () => number = () => Date.now(),
): Promise<VaultLayerMigrationCronResult> {
  const endpoint = `${config.backendUrl}/api/cron/vault-layer-migration`
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.backendApiKey}`,
      'X-Call-Id': `cron-vault-layer-migration-${now()}`,
    },
    signal: AbortSignal.timeout(120_000),
  })

  const body = await res.json().catch(() => null) as { success?: boolean; result?: Record<string, unknown>; error?: string } | null
  if (!res.ok || !body?.success) {
    const errorText = body?.error
      ?? await res.text().catch(() => '')
      ?? 'unknown error'
    throw new Error(`Vault layer migration cron failed: HTTP ${res.status} ${errorText}`.trim())
  }

  const result = body.result ?? {}
  const normalized: VaultLayerMigrationCycleResult = {
    backfilled: asFiniteNumber(result.backfilled),
    promotedToCurated: asFiniteNumber(result.promotedToCurated),
    demotedToArchived: asFiniteNumber(result.demotedToArchived),
    durationMs: asFiniteNumber(result.durationMs),
  }

  return {
    ...normalized,
    endpoint,
    summary: buildSummary(normalized),
  }
}
