/**
 * circle-packing-evaluator.ts — Deterministic numerical evaluator for circle packing.
 *
 * Replaces the LLM-based judge_response for circle packing tasks.
 * Computes:
 *   - Constraint violations (overlap, boundary)
 *   - Sum of radii (objective function)
 *   - Feasibility score
 *   - Normalized score vs SOTA (2.635)
 *
 * This is a PURE mathematical evaluator — no LLM involved.
 */

export interface Circle {
  x: number
  y: number
  r: number
}

export interface PackingEvaluation {
  circles: Circle[]
  sum_radii: number
  violations: number
  overlap_violations: number
  boundary_violations: number
  feasible: boolean
  score: number           // Normalized 0-1 (SOTA=2.635 → score ~0.659)
  max_penalty: number
  details: string
}

/**
 * Parse circle packing artifact from various formats:
 *   - Python list: [(x, y, r), ...]
 *   - JSON array: [[x, y, r], ...]
 *   - CSV lines: x,y,r
 *   - JSON objects: [{x, y, r}, ...]
 */
export function parseCircles(artifact: string): Circle[] {
  const circles: Circle[] = []

  // Try JSON array first
  try {
    const parsed = JSON.parse(artifact)
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (Array.isArray(item) && item.length >= 3) {
          circles.push({ x: Number(item[0]), y: Number(item[1]), r: Number(item[2]) })
        } else if (typeof item === 'object' && item !== null) {
          const x = Number(item.x ?? item[0] ?? 0)
          const y = Number(item.y ?? item[1] ?? 0)
          const r = Number(item.r ?? item[2] ?? item.radius ?? 0)
          if (!isNaN(x) && !isNaN(y) && !isNaN(r)) {
            circles.push({ x, y, r })
          }
        }
      }
      if (circles.length > 0) return circles
    }
  } catch {
    // Not valid JSON — try text parsing
  }

  // Parse Python-style: (x, y, r)
  const tupleRegex = /\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g
  let m
  while ((m = tupleRegex.exec(artifact)) !== null) {
    const x = parseFloat(m[1])
    const y = parseFloat(m[2])
    const r = parseFloat(m[3])
    if (!isNaN(x) && !isNaN(y) && !isNaN(r)) {
      circles.push({ x, y, r })
    }
  }

  if (circles.length > 0) return circles

  // Parse CSV lines: x,y,r
  const lines = artifact.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parts = trimmed.split(/[,\s]+/).filter(Boolean)
    if (parts.length >= 3) {
      const x = parseFloat(parts[0])
      const y = parseFloat(parts[1])
      const r = parseFloat(parts[2])
      if (!isNaN(x) && !isNaN(y) && !isNaN(r) && r > 0) {
        circles.push({ x, y, r })
      }
    }
  }

  return circles
}

/**
 * Evaluate a circle packing solution.
 * Returns feasibility, constraint violations, and normalized score.
 */
export function evaluatePacking(circles: Circle[]): PackingEvaluation {
  const overlapViolations: string[] = []
  const boundaryViolations: string[] = []
  let sumRadii = 0

  for (let i = 0; i < circles.length; i++) {
    const c = circles[i]
    sumRadii += c.r

    // Boundary checks
    if (c.x - c.r < -1e-9) boundaryViolations.push(`Circle ${i}: x-r=${(c.x - c.r).toFixed(6)} < 0`)
    if (c.x + c.r > 1 + 1e-9) boundaryViolations.push(`Circle ${i}: x+r=${(c.x + c.r).toFixed(6)} > 1`)
    if (c.y - c.r < -1e-9) boundaryViolations.push(`Circle ${i}: y-r=${(c.y - c.r).toFixed(6)} < 0`)
    if (c.y + c.r > 1 + 1e-9) boundaryViolations.push(`Circle ${i}: y+r=${(c.y + c.r).toFixed(6)} > 1`)

    // Overlap checks
    for (let j = i + 1; j < circles.length; j++) {
      const d = Math.sqrt((c.x - circles[j].x) ** 2 + (c.y - circles[j].y) ** 2)
      const minDist = c.r + circles[j].r
      if (d < minDist - 1e-9) {
        overlapViolations.push(`Circles ${i},${j}: dist=${d.toFixed(6)} < r_i+r_j=${minDist.toFixed(6)} (overlap=${(minDist - d).toFixed(6)})`)
      }
    }
  }

  const totalViolations = overlapViolations.length + boundaryViolations.length
  const feasible = totalViolations === 0

  // Score calculation
  // Feasible solutions: score = sum_radii / 4.0 (SOTA 2.635 → ~0.659)
  // Infeasible solutions: score = 0
  // Partial violations: penalty based on severity
  const maxPenalty = totalViolations > 0
    ? Math.min(1, totalViolations * 0.05 + overlapViolations.length * 0.1)
    : 0

  const rawScore = feasible ? sumRadii / 4.0 : 0
  const score = Math.max(0, rawScore * (1 - maxPenalty))

  const details = [
    `Circles: ${circles.length}`,
    `Sum radii: ${sumRadii.toFixed(6)}`,
    `Feasible: ${feasible}`,
    `Boundary violations: ${boundaryViolations.length}`,
    `Overlap violations: ${overlapViolations.length}`,
    `Score: ${score.toFixed(6)}`,
  ].join('\n')

  return {
    circles,
    sum_radii: sumRadii,
    violations: totalViolations,
    overlap_violations: overlapViolations.length,
    boundary_violations: boundaryViolations.length,
    feasible,
    score: Math.min(1, score),
    max_penalty: maxPenalty,
    details,
  }
}

/**
 * Generate initial hexagonal packing for n circles.
 * Returns a feasible (but suboptimal) starting configuration.
 */
export function hexagonalInitialSolution(n: number, radius: number): Circle[] {
  const circles: Circle[] = []
  const rowHeight = radius * Math.sqrt(3)

  // Layout: 6-5-6-5-4 = 26 circles
  const rows = [6, 5, 6, 5, 4]
  let count = 0

  for (let row = 0; row < rows.length && count < n; row++) {
    const cols = rows[row]
    const y = 0.1 + row * rowHeight
    const offsetX = (row % 2 === 1) ? radius : 0

    for (let col = 0; col < cols && count < n; col++) {
      const x = 0.1 + offsetX + col * 2 * radius
      if (x + radius <= 1 && y + radius <= 1) {
        circles.push({ x, y, r: radius })
        count++
      }
    }
  }

  // Fill remaining with uniform grid if hexagonal didn't fit all
  while (circles.length < n) {
    const idx = circles.length
    const gridSize = Math.ceil(Math.sqrt(n))
    const spacing = 2 * radius
    const row = Math.floor(idx / gridSize)
    const col = idx % gridSize
    const x = radius + col * spacing
    const y = radius + row * spacing
    if (x + radius <= 1 && y + radius <= 1) {
      circles.push({ x, y, r: radius })
    } else {
      break
    }
  }

  return circles.slice(0, n)
}

/**
 * Convert circles to artifact string (Python-style).
 */
export function circlesToArtifact(circles: Circle[]): string {
  const lines = circles.map(c => `  (${c.x.toFixed(6)}, ${c.y.toFixed(6)}, ${c.r.toFixed(6)}),`)
  return `circles = [\n${lines.join('\n')}\n]\n# Sum of radii: ${circles.reduce((s, c) => s + c.r, 0).toFixed(6)}`
}
