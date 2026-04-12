/**
 * tree-sitter-ingestion/parser.ts — Multi-language AST extraction
 *
 * Adopts GitNexus's Tree-sitter AST parsing for precise code intelligence.
 * Replaces LLM-based extraction with deterministic AST parsing.
 *
 * LIN-764: Fantomstykliste — Adoptér GitNexus Tree-sitter AST pipeline
 */

import Parser from 'tree-sitter'
import * as TypeScript from 'tree-sitter-typescript'
import * as Python from 'tree-sitter-python'
import { readFileSync, statSync, readdirSync, rmSync } from 'fs'
import { join, relative } from 'path'
import type { SyntaxNode } from 'tree-sitter'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ASTSymbol {
  name: string
  kind: 'class' | 'function' | 'method' | 'interface' | 'type' | 'variable' | 'import'
  line: number
  column: number
  endLine: number
  endColumn: number
  params?: string[]
  returnType?: string
  parentClass?: string
}

export interface ASTCallSite {
  caller: string
  callee: string
  line: number
  file: string
}

export interface ASTFile {
  path: string
  language: string
  symbols: ASTSymbol[]
  callSites: ASTCallSite[]
  imports: string[]
  exports: string[]
  error?: string
}

export interface ASTModule {
  name: string
  files: ASTFile[]
  symbolCount: number
  callSiteCount: number
}

// ─── Language Parsers ─────────────────────────────────────────────────────────

const parsers = new Map<string, { parser: Parser; grammar: unknown }>()

function getParser(language: string): Parser | null {
  if (!parsers.has(language)) {
    switch (language) {
      case 'typescript':
      case 'tsx': {
        const p = new Parser()
        const tsLang = (TypeScript as any).typescript ?? TypeScript
        p.setLanguage(tsLang)
        parsers.set(language, { parser: p, grammar: tsLang })
        break
      }
      case 'python': {
        const p = new Parser()
        const pyLang = (Python as any).default ?? Python
        p.setLanguage(pyLang)
        parsers.set(language, { parser: p, grammar: pyLang })
        break
      }
      default:
        return null
    }
  }
  return parsers.get(language)!.parser
}

function detectLanguage(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'py':
      return 'python'
    default:
      return null
  }
}

// ─── AST Extraction ───────────────────────────────────────────────────────────

function extractSymbols(root: SyntaxNode, filePath: string): ASTSymbol[] {
  const symbols: ASTSymbol[] = []
  let parentClass: string | undefined

  function walk(node: SyntaxNode, parent?: string) {
    const currentParent = parent ?? parentClass

    switch (node.type) {
      case 'class_declaration':
      case 'class_definition': {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          parentClass = name
          symbols.push({
            name,
            kind: node.type === 'class_definition' ? 'class' : 'class',
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
            endLine: node.endPosition.row + 1,
            endColumn: node.endPosition.column,
            parentClass: currentParent,
          })
        }
        break
      }

      case 'function_declaration':
      case 'arrow_function':
      case 'function_definition': {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          const params = extractParams(node)
          symbols.push({
            name,
            kind: 'function',
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
            endLine: node.endPosition.row + 1,
            endColumn: node.endPosition.column,
            params,
            parentClass: currentParent,
          })
        }
        break
      }

      case 'method_definition':
      case 'public_field_definition': {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            kind: 'method',
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
            endLine: node.endPosition.row + 1,
            endColumn: node.endPosition.column,
            parentClass: currentParent,
          })
        }
        break
      }

      case 'interface_declaration':
      case 'type_alias_declaration': {
        const nameNode = node.childForFieldName('name')
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            kind: node.type.startsWith('interface') ? 'interface' : 'type',
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
            endLine: node.endPosition.row + 1,
            endColumn: node.endPosition.column,
          })
        }
        break
      }

      case 'import_statement':
      case 'import_declaration': {
        const nameNode = node.childForFieldName('source') ?? node.lastChild
        if (nameNode) {
          symbols.push({
            name: nameNode.text.replace(/['"]/g, ''),
            kind: 'import',
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
            endLine: node.endPosition.row + 1,
            endColumn: node.endPosition.column,
          })
        }
        break
      }
    }

    // Recurse into children
    for (const child of node.children) {
      walk(child, currentParent)
    }
  }

  walk(root)
  return symbols
}

function extractParams(node: SyntaxNode): string[] {
  const params: string[] = []
  const paramNode = node.childForFieldName('parameters')
  if (paramNode) {
    for (const child of paramNode.children) {
      if (child.type === 'identifier' || child.type === 'typed_parameter') {
        params.push(child.text.split(':')[0].trim())
      }
    }
  }
  return params
}

function extractCallSites(root: SyntaxNode, filePath: string): ASTCallSite[] {
  const calls: ASTCallSite[] = []
  let currentFunction: string | undefined

  function walk(node: SyntaxNode) {
    // Track current function
    if (
      node.type === 'function_declaration' ||
      node.type === 'function_definition' ||
      node.type === 'method_definition'
    ) {
      const nameNode = node.childForFieldName('name')
      if (nameNode) currentFunction = nameNode.text
    }

    // Find function calls
    if (node.type === 'call_expression') {
      const funcNode = node.childForFieldName('function')
      if (funcNode && currentFunction) {
        calls.push({
          caller: currentFunction,
          callee: funcNode.text,
          line: node.startPosition.row + 1,
          file: filePath,
        })
      }
    }

    for (const child of node.children) {
      walk(child)
    }
  }

  walk(root)
  return calls
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a single file and extract AST symbols + call sites.
 */
export function parseFile(filePath: string, baseDir?: string): ASTFile | null {
  const language = detectLanguage(filePath)
  if (!language) return null

  const parser = getParser(language)
  if (!parser) return null

  try {
    const content = readFileSync(filePath, 'utf8')
    if (content.length > 32 * 1024 * 1024) {
      return {
        path: baseDir ? relative(baseDir, filePath) : filePath,
        language,
        symbols: [],
        callSites: [],
        imports: [],
        exports: [],
        error: 'File too large (>32MB)',
      }
    }

    const tree = parser.parse(content)
    const symbols = extractSymbols(tree.rootNode, filePath)
    const callSites = extractCallSites(tree.rootNode, filePath)
    const imports = symbols.filter(s => s.kind === 'import').map(s => s.name)
    const exports = symbols
      .filter(s => ['class', 'function', 'interface', 'type', 'variable'].includes(s.kind))
      .map(s => s.name)

    return {
      path: baseDir ? relative(baseDir, filePath) : filePath,
      language,
      symbols,
      callSites,
      imports,
      exports,
    }
  } catch (err) {
    return {
      path: baseDir ? relative(baseDir, filePath) : filePath,
      language,
      symbols: [],
      callSites: [],
      imports: [],
      exports: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Parse a directory and extract AST modules.
 */
export function parseDirectory(dir: string, maxFiles = 500): ASTModule[] {
  const files: ASTFile[] = []
  let count = 0

  function walk(d: string) {
    if (count >= maxFiles) return
    const entries = readdirSync(d, { withFileTypes: true })
    for (const entry of entries) {
      if (count >= maxFiles) return
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue
      const full = join(d, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (detectLanguage(entry.name)) {
        const result = parseFile(full, dir)
        if (result) files.push(result)
        count++
      }
    }
  }

  walk(dir)

  // Group files by directory module
  const modules = new Map<string, ASTFile[]>()
  for (const f of files) {
    const parts = f.path.split(/[\\/]/)
    let key: string
    if (parts.length >= 3 && parts[0] === 'src') {
      key = `src/${parts[1]}`
    } else if (parts.length >= 2) {
      key = parts[0]
    } else {
      key = '__root__'
    }
    if (!modules.has(key)) modules.set(key, [])
    modules.get(key)!.push(f)
  }

  const result: ASTModule[] = []
  for (const [name, modFiles] of modules) {
    const symbolCount = modFiles.reduce((s, f) => s + f.symbols.length, 0)
    const callSiteCount = modFiles.reduce((s, f) => s + f.callSites.length, 0)
    result.push({ name, files: modFiles, symbolCount, callSiteCount })
  }

  return result
}
