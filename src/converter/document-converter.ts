/**
 * document-converter.ts — Own TypeScript document converter.
 *
 * Steals patterns from microsoft/markitdown (MIT license) but is
 * a 100% original implementation — ZERO runtime dependency on markitdown.
 *
 * Converts PDF, DOCX, XLSX, PPTX, MD, HTML, TXT → canonical text + structured metadata.
 * Output feeds into existing SRAG + Neo4j ingestion pipeline.
 *
 * Golden Rule: Steal IDEER og INDHOLD — aldrig runtime dependencies.
 */
import { logger } from '../logger.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConvertedDocument {
  source_type: string        // 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'md' | 'html' | 'txt'
  source_path: string
  text: string
  title?: string
  author?: string
  created_at?: string
  modified_at?: string
  page_count?: number
  word_count: number
  char_count: number
  language?: string
  headings: string[]
  links: Array<{ text: string; url: string }>
  tables: number
  images: number
  metadata: Record<string, unknown>
}

export interface ConvertOptions {
  max_text_length?: number     // Cap output text (default: 50000)
  extract_headings?: boolean   // Extract markdown/HTML headings (default: true)
  extract_links?: boolean      // Extract links (default: true)
  language?: string            // Override detected language
}

const DEFAULT_MAX_TEXT = 50000

// ─── Utility ─────────────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + `\n\n--- [truncated at ${max} chars] ---`
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function extractMarkdownHeadings(text: string): string[] {
  const headings: string[] = []
  for (const line of text.split('\n')) {
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) headings.push(match[2].trim())
  }
  return headings
}

function extractMarkdownLinks(text: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = []
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g
  let m
  while ((m = regex.exec(text)) !== null) {
    links.push({ text: m[1], url: m[2] })
  }
  return links
}

function countMarkdownTables(text: string): number {
  let count = 0
  for (const line of text.split('\n')) {
    if (/^\|/.test(line) && line.includes('|')) count++
  }
  // Each table has at least 3 lines (header + separator + 1 row)
  return Math.max(0, Math.floor(count / 3))
}

function countMarkdownImages(text: string): number {
  let count = 0
  const regex = /!\[.*?\]\(.*?\)/g
  while (regex.exec(text)) count++
  return count
}

function extractHtmlHeadings(html: string): string[] {
  const headings: string[] = []
  const regex = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi
  let m
  while ((m = regex.exec(html)) !== null) {
    headings.push(m[2].replace(/<[^>]*>/g, '').trim())
  }
  return headings
}

function extractHtmlLinks(html: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = []
  const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi
  let m
  while ((m = regex.exec(html)) !== null) {
    links.push({ text: m[2].replace(/<[^>]*>/g, '').trim(), url: m[1] })
  }
  return links
}

function countHtmlTables(html: string): number {
  let count = 0
  const regex = /<table[\s>]/gi
  while (regex.exec(html)) count++
  return count
}

function countHtmlImages(html: string): number {
  let count = 0
  const regex = /<img[\s>]/gi
  while (regex.exec(html)) count++
  return count
}

function stripHtml(html: string): string {
  // Remove script/style content first
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '')
  // Remove all tags
  text = text.replace(/<[^>]+>/g, ' ')
  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim()
  return text
}

function detectLanguage(text: string): string | undefined {
  // Simple heuristic: check for common language markers
  const markers: Record<string, RegExp> = {
    'da': /\b(og|den|der|for|som|med|til|at|en|det|er)\b/gi,
    'en': /\b(the|and|for|that|this|with|are|was|have|been)\b/gi,
    'de': /\b(und|der|die|das|ist|ein|eine|von|mit|sich|auf)\b/gi,
    'fr': /\b(les|des|est|sont|dans|pour|une|que|pas|avec|plus)\b/gi,
    'no': /\b(og|det|er|som|for|til|med|på|en|den|ikke|har)\b/gi,
    'sv': /\b(och|det|är|som|för|till|med|på|en|den|inte|har)\b/gi,
  }

  let bestLang: string | undefined
  let bestScore = 0
  const sample = text.slice(0, 2000)

  for (const [lang, regex] of Object.entries(markers)) {
    const matches = sample.match(regex)
    const score = matches ? matches.length : 0
    if (score > bestScore) {
      bestScore = score
      bestLang = lang
    }
  }

  return bestScore > 3 ? bestLang : undefined
}

// ─── Text extractors (pattern-steal from markitdown, own implementation) ────

/**
 * Plain text: pass through with normalization.
 * Pattern: markitdown's PlainTextConverter — simple identity transform.
 */
function convertText(content: string, opts: ConvertOptions): ConvertedDocument {
  const text = truncate(content.replace(/\r\n/g, '\n'), opts.max_text_length ?? DEFAULT_MAX_TEXT)
  return {
    source_type: 'txt',
    source_path: '',
    text,
    word_count: countWords(text),
    char_count: text.length,
    language: opts.language ?? detectLanguage(text),
    headings: [],
    links: [],
    tables: 0,
    images: 0,
    metadata: {},
  }
}

/**
 * Markdown: extract text, headings, links, tables, images.
 * Pattern: markitdown's MarkdownConverter — structural extraction without rendering.
 */
function convertMarkdown(content: string, opts: ConvertOptions): ConvertedDocument {
  const text = truncate(content, opts.max_text_length ?? DEFAULT_MAX_TEXT)
  return {
    source_type: 'md',
    source_path: '',
    text,
    word_count: countWords(text),
    char_count: text.length,
    language: opts.language ?? detectLanguage(text),
    headings: opts.extract_headings !== false ? extractMarkdownHeadings(text) : [],
    links: opts.extract_links !== false ? extractMarkdownLinks(text) : [],
    tables: countMarkdownTables(text),
    images: countMarkdownImages(text),
    metadata: {},
  }
}

/**
 * HTML: strip tags, extract structure (headings, links, tables).
 * Pattern: markitdown's HtmlConverter — DOM-free text extraction + regex structure detection.
 */
function convertHtml(content: string, opts: ConvertOptions): ConvertedDocument {
  const text = truncate(stripHtml(content), opts.max_text_length ?? DEFAULT_MAX_TEXT)
  return {
    source_type: 'html',
    source_path: '',
    text,
    word_count: countWords(text),
    char_count: text.length,
    language: opts.language ?? detectLanguage(text),
    headings: opts.extract_headings !== false ? extractHtmlHeadings(content) : [],
    links: opts.extract_links !== false ? extractHtmlLinks(content) : [],
    tables: countHtmlTables(content),
    images: countHtmlImages(content),
    metadata: {},
  }
}

/**
 * PDF: extract text using pdf-parse (already in our deps).
 * Pattern: markitdown's PdfConverter — text extraction via PDF parser, no OCR.
 */
async function convertPdf(content: string | Buffer, opts: ConvertOptions): Promise<ConvertedDocument> {
  let text = ''
  try {
    // pdf-parse is already a dependency — use it for text extraction
    const pdfParse = (await import('pdf-parse')).default
    const buffer = typeof content === 'string' ? Buffer.from(content, 'base64') : content
    const data = await pdfParse(buffer)
    text = data.text
  } catch (err) {
    logger.warn({ err: String(err) }, 'PDF text extraction failed, returning raw content')
    text = typeof content === 'string' ? content : content.toString('utf-8')
  }

  text = truncate(text, opts.max_text_length ?? DEFAULT_MAX_TEXT)
  return {
    source_type: 'pdf',
    source_path: '',
    text,
    word_count: countWords(text),
    char_count: text.length,
    language: opts.language ?? detectLanguage(text),
    headings: extractMarkdownHeadings(text), // PDFs sometimes contain markdown
    links: opts.extract_links !== false ? extractMarkdownLinks(text) : [],
    tables: countMarkdownTables(text),
    images: 0, // PDF images require OCR — out of scope
    metadata: {},
  }
}

/**
 * DOCX: extract text using mammoth (already in our deps).
 * Pattern: markitdown's DocxConverter — XML-based text extraction from OOXML.
 */
async function convertDocx(content: string | Buffer, opts: ConvertOptions): Promise<ConvertedDocument> {
  let text = ''
  let headings: string[] = []
  try {
    // mammoth is already a dependency — use it for DOCX extraction
    const mammoth = await import('mammoth')
    const buffer = typeof content === 'string' ? Buffer.from(content, 'base64') : content
    const result = await mammoth.extractRawText({ buffer })
    text = result.value

    // Also extract headings from the document structure
    const docResult = await mammoth.convertToHtml({ buffer })
    headings = extractHtmlHeadings(docResult.value)
  } catch (err) {
    logger.warn({ err: String(err) }, 'DOCX text extraction failed, returning raw content')
    text = typeof content === 'string' ? content : content.toString('utf-8')
  }

  text = truncate(text, opts.max_text_length ?? DEFAULT_MAX_TEXT)
  return {
    source_type: 'docx',
    source_path: '',
    text,
    word_count: countWords(text),
    char_count: text.length,
    language: opts.language ?? detectLanguage(text),
    headings: opts.extract_headings !== false ? headings : [],
    links: opts.extract_links !== false ? extractMarkdownLinks(text) : [],
    tables: 0, // Would require full OOXML parsing — defer to Phase 4
    images: 0,
    metadata: {},
  }
}

/**
 * XLSX: convert to markdown table format.
 * Pattern: markitdown's XlsxConverter — row-by-row text extraction as markdown tables.
 */
async function convertXlsx(content: string | Buffer, opts: ConvertOptions): Promise<ConvertedDocument> {
  let text = ''
  let tableCount = 0
  try {
    const xlsx = await import('xlsx')
    const buffer = typeof content === 'string' ? Buffer.from(content, 'base64') : content
    const workbook = xlsx.read(buffer, { type: 'buffer' })

    const parts: string[] = []
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      const json = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][]

      if (json.length === 0) continue
      tableCount++

      // Convert to markdown table
      const headers = json[0]?.map(h => String(h ?? '')) ?? []
      const headerRow = `| ${headers.join(' | ')} |`
      const separator = `| ${headers.map(() => '---').join(' | ')} |`
      const dataRows = json.slice(1).map(row =>
        `| ${headers.map((_, i) => String(row[i] ?? '')).join(' | ')} |`
      )

      parts.push(`## ${sheetName}\n\n${headerRow}\n${separator}\n${dataRows.join('\n')}`)
    }
    text = parts.join('\n\n')
  } catch (err) {
    logger.warn({ err: String(err) }, 'XLSX conversion failed')
    text = typeof content === 'string' ? content : content.toString('utf-8')
  }

  text = truncate(text, opts.max_text_length ?? DEFAULT_MAX_TEXT)
  return {
    source_type: 'xlsx',
    source_path: '',
    text,
    word_count: countWords(text),
    char_count: text.length,
    language: opts.language ?? detectLanguage(text),
    headings: opts.extract_headings !== false ? extractMarkdownHeadings(text) : [],
    links: [],
    tables: tableCount,
    images: 0,
    metadata: {},
  }
}

/**
 * PPTX: extract slide text as sequential content.
 * Pattern: markitdown's PptxConverter — slide-by-slide text extraction.
 */
async function convertPptx(content: string | Buffer, opts: ConvertOptions): Promise<ConvertedDocument> {
  let text = ''
  let slideCount = 0
  try {
    // Use xlsx (which also supports PPTX via jszip) or fall back to raw extraction
    const xlsx = await import('xlsx')
    const buffer = typeof content === 'string' ? Buffer.from(content, 'base64') : content
    const workbook = xlsx.read(buffer, { type: 'buffer' })

    const parts: string[] = []
    for (const sheetName of workbook.SheetNames) {
      slideCount++
      const sheet = workbook.Sheets[sheetName]
      const json = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][]
      const slideText = json.map(row => row.filter(Boolean).join(' ')).filter(Boolean).join('\n')
      if (slideText) {
        parts.push(`## Slide ${slideCount}\n\n${slideText}`)
      }
    }
    text = parts.join('\n\n')
  } catch (err) {
    logger.warn({ err: String(err) }, 'PPTX conversion failed')
    text = typeof content === 'string' ? content : content.toString('utf-8')
  }

  text = truncate(text, opts.max_text_length ?? DEFAULT_MAX_TEXT)
  return {
    source_type: 'pptx',
    source_path: '',
    text,
    word_count: countWords(text),
    char_count: text.length,
    language: opts.language ?? detectLanguage(text),
    headings: opts.extract_headings !== false ? extractMarkdownHeadings(text) : [],
    links: [],
    tables: 0,
    images: 0,
    metadata: { slide_count: slideCount },
  }
}

// ─── Main convert function ───────────────────────────────────────────────────

export interface ConvertInput {
  content: string | Buffer    // File content (string for text formats, Buffer/base64 for binary)
  mimeType: string            // MIME type for format detection
  sourcePath?: string         // Original file path/URL
  options?: ConvertOptions
}

/**
 * Convert any supported document format to canonical text + metadata.
 *
 * Steals patterns from microsoft/markitdown (MIT) — zero runtime dependency.
 * Each converter is a pure TypeScript implementation of the same extraction logic.
 */
export async function convertDocument(input: ConvertInput): Promise<ConvertedDocument> {
  const { content, mimeType, sourcePath, options = {} } = input
  const opts = {
    maxTextLength: options.maxTextLength ?? DEFAULT_MAX_TEXT,
    extractHeadings: options.extractHeadings ?? true,
    extractLinks: options.extractLinks ?? true,
    language: options.language,
  }

  // Determine format from MIME type
  let format = mimeType.toLowerCase()
  // Map common MIME types to our handlers
  if (format.includes('markdown') || format.includes('x-markdown')) format = 'markdown'
  else if (format.includes('html') || format.includes('xml')) format = 'html'
  else if (format.includes('pdf')) format = 'pdf'
  else if (format.includes('wordprocessingml') || format.includes('docx')) format = 'docx'
  else if (format.includes('spreadsheetml') || format.includes('xlsx')) format = 'xlsx'
  else if (format.includes('presentationml') || format.includes('pptx')) format = 'pptx'
  else if (format.includes('text/plain') || format === 'txt') format = 'txt'

  // Fallback: detect from file extension in sourcePath
  if (format === 'application/octet-stream' || format === 'binary') {
    const ext = sourcePath?.split('.').pop()?.toLowerCase() ?? ''
    if (['md', 'markdown'].includes(ext)) format = 'markdown'
    else if (['html', 'htm'].includes(ext)) format = 'html'
    else if (ext === 'pdf') format = 'pdf'
    else if (ext === 'docx') format = 'docx'
    else if (ext === 'xlsx') format = 'xlsx'
    else if (ext === 'pptx') format = 'pptx'
    else if (ext === 'txt') format = 'txt'
  }

  let result: ConvertedDocument

  switch (format) {
    case 'markdown':
      result = convertMarkdown(typeof content === 'string' ? content : content.toString('utf-8'), opts)
      break
    case 'html':
      result = convertHtml(typeof content === 'string' ? content : content.toString('utf-8'), opts)
      break
    case 'txt':
      result = convertText(typeof content === 'string' ? content : content.toString('utf-8'), opts)
      break
    case 'pdf':
      result = await convertPdf(content, opts)
      break
    case 'docx':
      result = await convertDocx(content, opts)
      break
    case 'xlsx':
      result = await convertXlsx(content, opts)
      break
    case 'pptx':
      result = await convertPptx(content, opts)
      break
    default:
      // Unknown format — treat as plain text
      logger.warn({ mimeType, sourcePath }, 'Unknown format, treating as plain text')
      result = convertText(typeof content === 'string' ? content : content.toString('utf-8'), opts)
  }

  // Set source path
  result.source_path = sourcePath ?? ''

  logger.info({
    source_type: result.source_type,
    source_path: sourcePath,
    word_count: result.word_count,
    char_count: result.char_count,
    headings: result.headings.length,
    links: result.links.length,
    tables: result.tables,
  }, 'Document converted')

  return result
}

/**
 * Convert to markdown-like text for SRAG ingestion.
 * Convenience wrapper — returns just the text content.
 */
export async function convertToText(input: ConvertInput): Promise<string> {
  const result = await convertDocument(input)
  return result.text
}
