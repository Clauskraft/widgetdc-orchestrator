/**
 * agentic-runner.ts — Python agentic-kit MCP wrapper
 *
 * Spawns Python subprocesses to execute agentic-kit modules via run_mcp.py.
 * Passes through env vars (NEO4J_URI, NEO4J_PASSWORD, LINEAR_API_KEY, etc.)
 * from process.env or the orchestrator's config.
 *
 * Usage:
 *   const result = await spawnPythonAgentic('mrp_recalculate', {})
 *   // => { status: "success", clusters_recalculated: 3 }
 */

import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

// Resolve the agentic-kit directory relative to this file
// In production: dist/tools/agentic-runner.js → src/tools/agentic-runner.ts → agentic-kit/
const AGENTIC_KIT_DIR = resolveAgenticKitDir()

function resolveAgenticKitDir(): string {
  // Try multiple locations for dev vs production
  const candidates = [
    // Railway production: repo root /agentic-kit/
    path.resolve(__dirname, '..', '..', 'agentic-kit'),
    // Local dev: orchestrator root /agentic-kit/
    path.resolve(__dirname, '..', '..', '..', 'agentic-kit'),
    // Fallback: absolute path (for local Windows dev)
    'C:\\Users\\claus\\Projetcs\\widgetdc-orchestrator\\agentic-kit',
  ]

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'run_mcp.py'))) {
      return dir
    }
  }

  // Last resort: return the first candidate (will fail at runtime with clear error)
  return candidates[0]
}

/**
 * Spawn a Python subprocess to run an agentic-kit command.
 *
 * @param command - The agentic-kit command (e.g., 'mrp_recalculate')
 * @param args - JSON-serializable arguments passed as second CLI arg
 * @param timeoutMs - Timeout in ms (default: 30s)
 * @returns Parsed JSON result from the Python script
 */
export async function spawnPythonAgentic(
  command: string,
  args: Record<string, unknown>,
  timeoutMs: number = 30_000,
): Promise<Record<string, unknown>> {
  const pythonPath = process.env.PYTHON_PATH || process.env.PYTHON || 'python3'
  const scriptPath = path.join(AGENTIC_KIT_DIR, 'run_mcp.py')
  const argsJson = JSON.stringify(args)

  // Build env for subprocess — inherit from orchestrator + enforce required vars
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONUNBUFFERED: '1', // Don't buffer stdout/stderr
  }

  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, [scriptPath, command, argsJson], {
      env,
      cwd: AGENTIC_KIT_DIR,
      timeout: timeoutMs,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (err: Error) => {
      if (err.message.includes('ENOENT')) {
        reject(new Error(
          `Python not found: '${pythonPath}'. Set PYTHON_PATH env var or install Python 3.12+. ` +
          `Agentic-kit dir: ${AGENTIC_KIT_DIR}`,
        ))
      } else {
        reject(err)
      }
    })

    child.on('close', (code: number | null) => {
      // stdout may contain the JSON result; stderr may contain logs
      // The last line of stdout should be the JSON result
      const lines = stdout.trim().split('\n')
      const lastLine = lines[lines.length - 1] ?? ''

      if (code === 0) {
        try {
          const result = JSON.parse(lastLine)
          resolve(result)
        } catch (parseErr) {
          reject(new Error(
            `Failed to parse agentic-kit output as JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}\n` +
            `Stdout: ${stdout.slice(0, 500)}\n` +
            `Stderr: ${stderr.slice(0, 500)}`,
          ))
        }
      } else {
        // Try to parse error from stderr (last JSON line)
        const errLines = stderr.trim().split('\n')
        const lastErrLine = errLines[errLines.length - 1] ?? ''
        let errorMsg = `Agentic-kit command '${command}' exited with code ${code}`

        try {
          const errResult = JSON.parse(lastErrLine)
          errorMsg += `: ${errResult.error || JSON.stringify(errResult)}`
        } catch {
          // Fallback: use stderr content or exit code
          if (stderr.trim()) {
            errorMsg += `: ${stderr.trim().slice(0, 300)}`
          }
        }

        reject(new Error(errorMsg))
      }
    })

    // Timeout handling
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL')
      }, 2000)
      reject(new Error(
        `Agentic-kit command '${command}' timed out after ${timeoutMs}ms. ` +
        `Stdout so far: ${stdout.slice(0, 300)}\n` +
        `Stderr so far: ${stderr.slice(0, 300)}`,
      ))
    }, timeoutMs)

    child.on('close', () => clearTimeout(timer))
    child.on('error', () => clearTimeout(timer))
  })
}

/**
 * Check if Python + agentic-kit is available.
 * Returns { available: true, python_path, agentic_kit_dir } or { available: false, error }.
 */
export async function checkAgenticKitHealth(): Promise<{
  available: boolean
  python_path?: string
  agentic_kit_dir?: string
  error?: string
}> {
  const pythonPath = process.env.PYTHON_PATH || process.env.PYTHON || 'python3'

  // Check Python exists
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(pythonPath, ['--version'], { timeout: 5000 })
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Python exited ${code}`)))
      child.on('error', reject)
    })
  } catch {
    return { available: false, error: `Python '${pythonPath}' not found or not executable` }
  }

  // Check run_mcp.py exists
  if (!fs.existsSync(path.join(AGENTIC_KIT_DIR, 'run_mcp.py'))) {
    return { available: false, error: `run_mcp.py not found in ${AGENTIC_KIT_DIR}` }
  }

  // Check required env vars
  const missing: string[] = []
  if (!process.env.NEO4J_URI) missing.push('NEO4J_URI')
  if (!process.env.NEO4J_PASSWORD) missing.push('NEO4J_PASSWORD')

  if (missing.length > 0) {
    return {
      available: true, // Python + scripts exist, but env incomplete
      python_path: pythonPath,
      agentic_kit_dir: AGENTIC_KIT_DIR,
      error: `Missing env vars: ${missing.join(', ')} (commands requiring Neo4j will fail)`,
    }
  }

  return {
    available: true,
    python_path: pythonPath,
    agentic_kit_dir: AGENTIC_KIT_DIR,
  }
}
