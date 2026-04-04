const RLM = 'https://rlm-engine-production.up.railway.app'
const BACKEND = 'https://backend-production-d3da.up.railway.app'
const BACKEND_KEY = 'Heravej_22'

async function streamA2A(skillId, prompt, timeout = 60000) {
  const artifacts = []
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(`${RLM}/a2a/tasks/sendSubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', parts: [{ type: 'text', text: prompt }] }], skill_id: skillId }),
      signal: ctrl.signal,
    })
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const ev = JSON.parse(line.slice(5).trim())
            if (ev.event === 'task_artifact_update' && ev.artifact?.parts) {
              for (const p of ev.artifact.parts) if (p.type === 'text' && p.text) artifacts.push(p.text)
            }
          } catch {}
        }
      }
    }
  } finally { clearTimeout(t) }
  return artifacts
}

function parseEntities(text) {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  const match = cleaned.match(/\{[\s\S]*"entities"[\s\S]*\}/)
  if (!match) return []
  try { return JSON.parse(match[0]).entities || [] } catch { return [] }
}

async function mergeBatch(entities, filename, domain) {
  let merged = 0
  for (const e of entities) {
    const safeLabel = (e.type || 'Knowledge').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64)
    try {
      const res = await fetch(`${BACKEND}/api/mcp/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BACKEND_KEY}` },
        body: JSON.stringify({
          tool: 'graph.write_cypher',
          payload: {
            query: `MERGE (n:${safeLabel} {name: $name}) SET n.domain = $domain, n.source = 'mega-enrich', n.updatedAt = datetime() WITH n MERGE (d:TDCDocument {filename: $filename}) MERGE (n)-[:EXTRACTED_FROM]->(d) RETURN n.name`,
            params: { name: e.name, domain, filename }
          }
        }),
      })
      const data = await res.json()
      if (data?.result?.success !== false) merged++
    } catch {}
  }
  return merged
}

const DOCS = [
  { filename: 'OpenAI_ChatGPT.md', domain: 'AI', content: 'OpenAI offers ChatGPT GPT-4 DALL-E Whisper. Enterprise API with Azure partnership. SOC 2 compliant. Used by Salesforce Stripe.' },
  { filename: 'Anthropic_Claude.md', domain: 'AI', content: 'Anthropic develops Claude AI assistant. Constitutional AI methodology. Partnerships with AWS Google Cloud. Used by Notion Zoom.' },
  { filename: 'Google_Gemini.md', domain: 'AI', content: 'Google Gemini is multimodal LLM family. Integrated with Workspace Vertex AI. Used by Snap Shopify.' },
  { filename: 'Microsoft_Copilot.md', domain: 'AI', content: 'Microsoft Copilot embedded in Office 365 GitHub Windows. Built on OpenAI models. Enterprise-grade with Azure. Used by Accenture KPMG.' },
  { filename: 'Mistral_AI.md', domain: 'AI', content: 'Mistral AI is French open-source LLM company. Models Mistral 7B Mixtral Large. EU sovereign AI alternative. Partnered with Microsoft Azure.' },
  { filename: 'HuggingFace.md', domain: 'AI', content: 'Hugging Face hosts ML models and datasets. Transformers library. Inference API. Enterprise partners AWS Google Microsoft.' },
  { filename: 'LangChain_Framework.md', domain: 'AI', content: 'LangChain is LLM application framework. Supports RAG agents memory. LangGraph for workflows. LangSmith for observability.' },
  { filename: 'Pinecone_VectorDB.md', domain: 'AI', content: 'Pinecone is managed vector database. Similarity search at scale. Used by Gong Notion. Partners with Cohere OpenAI.' },
  { filename: 'Cohere_LLM.md', domain: 'AI', content: 'Cohere provides enterprise LLMs. Command Embed Rerank models. Oracle partnership. Focus on retrieval augmented generation.' },
  { filename: 'NVIDIA_AI.md', domain: 'AI', content: 'NVIDIA provides GPUs CUDA TensorRT Triton Inference Server. H100 A100 chips. NeMo framework. DGX enterprise systems.' },
  { filename: 'Palo_Alto_Networks.md', domain: 'Cybersecurity', content: 'Palo Alto Networks offers Prisma Cloud Cortex XSIAM Next-Gen Firewalls. Zero Trust architecture. Used by Deloitte Accenture.' },
  { filename: 'CrowdStrike_Falcon.md', domain: 'Cybersecurity', content: 'CrowdStrike Falcon endpoint protection. AI-driven threat detection. MDR services. SOC 2 certified. Used by Goldman Sachs Target.' },
  { filename: 'Okta_Identity.md', domain: 'Cybersecurity', content: 'Okta provides identity management SSO MFA. Zero Trust. Partners with Microsoft Google. Used by Slack Zoom.' },
  { filename: 'Zscaler_ZTNA.md', domain: 'Cybersecurity', content: 'Zscaler Zero Trust Exchange. Cloud-native security. SASE architecture. Replaces traditional VPN. Used by Siemens GE.' },
  { filename: 'SentinelOne_XDR.md', domain: 'Cybersecurity', content: 'SentinelOne XDR platform. Autonomous AI protection. Singularity platform. MITRE ATT and CK coverage. ISO 27001 certified.' },
  { filename: 'Wiz_CNAPP.md', domain: 'Cybersecurity', content: 'Wiz Cloud-Native Application Protection Platform. Multi-cloud security AWS Azure GCP. Used by Salesforce BMW.' },
  { filename: 'Snyk_DevSec.md', domain: 'Cybersecurity', content: 'Snyk developer security platform. SCA SAST container scanning. GitHub integration. Used by Google Salesforce.' },
  { filename: 'Tenable_VM.md', domain: 'Cybersecurity', content: 'Tenable Nessus vulnerability scanner. Tenable.io cloud platform. Exposure management. Used by JPMorgan Siemens.' },
  { filename: 'Darktrace_AI.md', domain: 'Cybersecurity', content: 'Darktrace Enterprise Immune System. AI-based threat detection. Antigena autonomous response. Used by Rolls-Royce City of Las Vegas.' },
  { filename: 'Rapid7_InsightVM.md', domain: 'Cybersecurity', content: 'Rapid7 InsightVM vulnerability management. InsightIDR SIEM. Metasploit penetration testing. Used by NASA AWS.' },
  { filename: 'Stripe_Payments.md', domain: 'Finance', content: 'Stripe payment processing platform. Stripe Connect for marketplaces. Radar fraud prevention. PCI DSS Level 1. Used by Shopify Amazon.' },
  { filename: 'Bloomberg_Terminal.md', domain: 'Finance', content: 'Bloomberg Terminal financial data platform. 325K subscribers. News analytics trading. Partnership with Microsoft.' },
  { filename: 'Refinitiv_Eikon.md', domain: 'Finance', content: 'Refinitiv Eikon LSEG. Financial data and analytics. Reuters news integration. FTSE Russell indices. Used by hedge funds.' },
  { filename: 'BlackRock_Aladdin.md', domain: 'Finance', content: 'BlackRock Aladdin portfolio management platform. 21T AUM managed. Risk analytics. Used by pension funds sovereign wealth.' },
  { filename: 'Plaid_OpenBanking.md', domain: 'Finance', content: 'Plaid open banking API. Connects apps to bank accounts. PSD2 compliant. Used by Venmo Robinhood Coinbase.' },
  { filename: 'Adyen_Payments.md', domain: 'Finance', content: 'Adyen unified payments platform. Dutch fintech. Acquiring processing risk management. Used by Uber Spotify Microsoft.' },
  { filename: 'Revolut_Banking.md', domain: 'Finance', content: 'Revolut digital bank. 30M users. Crypto trading stock investing. EU license. Challenges traditional banking.' },
  { filename: 'Klarna_BNPL.md', domain: 'Finance', content: 'Klarna Buy Now Pay Later. Swedish fintech. 150M users. Partners with Macys H and M. Scrutinized by regulators.' },
  { filename: 'SWIFT_gpi.md', domain: 'Finance', content: 'SWIFT gpi global payment innovation. Cross-border payments tracking. ISO 20022 messaging. 11000 banks worldwide.' },
  { filename: 'Visa_Network.md', domain: 'Finance', content: 'Visa payment network. 3.8B cards. Tokenization. Visa Direct real-time payments. Partnerships with fintechs.' },
  { filename: 'PwC_Digital.md', domain: 'Consulting', content: 'PwC digital transformation consulting. Strategy and. Cloud migration services. SAP Oracle partner. Big Four auditing firm.' },
  { filename: 'Deloitte_Tech.md', domain: 'Consulting', content: 'Deloitte technology consulting. Monitor strategy. Human Capital. SAP Workday Salesforce partner. Global presence.' },
  { filename: 'EY_Consulting.md', domain: 'Consulting', content: 'EY Ernst and Young consulting services. Tax audit advisory. SAP Microsoft partner. Sustainability reporting expertise.' },
  { filename: 'KPMG_Advisory.md', domain: 'Consulting', content: 'KPMG advisory services. Risk and regulatory compliance. SAP Workday partner. Big Four auditor. Cyber and cloud practice.' },
  { filename: 'McKinsey_Digital.md', domain: 'Consulting', content: 'McKinsey Digital transformation. QuantumBlack AI lab. Lilli AI assistant. Partners with OpenAI BCG Accenture Capgemini.' },
  { filename: 'BCG_Platinion.md', domain: 'Consulting', content: 'BCG Boston Consulting Group. Platinion tech consulting. GENE AI chatbot. Digital BCG strategy. Partners with MIT.' },
  { filename: 'Accenture_Song.md', domain: 'Consulting', content: 'Accenture Song creative services. Accenture Federal Services. SAP Salesforce Microsoft partner. 700K employees globally.' },
  { filename: 'Capgemini_Engineering.md', domain: 'Consulting', content: 'Capgemini Engineering. French IT services. SAP Salesforce Microsoft partner. Inviso acquisitions. Sogeti testing.' },
  { filename: 'IBM_Consulting.md', domain: 'Consulting', content: 'IBM Consulting formerly IGS. Watson AI consulting. Red Hat integration. Hybrid cloud strategy. SAP Salesforce partner.' },
  { filename: 'TCS_Digital.md', domain: 'Consulting', content: 'Tata Consultancy Services digital services. Indian IT giant. SAP Microsoft partner. BFSI retail verticals. 600K employees.' },
  { filename: 'AWS_Services.md', domain: 'Cloud', content: 'Amazon Web Services. EC2 S3 RDS Lambda. 200 services. Market leader. Partners with Accenture Deloitte for migration.' },
  { filename: 'Azure_Cloud.md', domain: 'Cloud', content: 'Microsoft Azure cloud. Azure OpenAI Cosmos DB AKS. Sovereign regions in EU. Partners with SAP Oracle. Used by BMW Unilever.' },
  { filename: 'GCP_Platform.md', domain: 'Cloud', content: 'Google Cloud Platform. BigQuery Vertex AI GKE. Anthos multi-cloud. Partners with Deloitte Accenture. Used by Spotify PayPal.' },
  { filename: 'Snowflake_DataCloud.md', domain: 'Cloud', content: 'Snowflake Data Cloud platform. Data warehousing sharing apps. Multi-cloud AWS Azure GCP. Used by Capital One BlackRock.' },
  { filename: 'Databricks_Lakehouse.md', domain: 'Cloud', content: 'Databricks Lakehouse Platform. Unified analytics ML. Delta Lake MLflow. Partners with AWS Azure. Used by Shell HSBC.' },
  { filename: 'Oracle_Cloud.md', domain: 'Cloud', content: 'Oracle Cloud Infrastructure OCI. Autonomous Database. Partnerships with Microsoft Azure NVIDIA. Used by Zoom FedEx.' },
  { filename: 'Salesforce_Platform.md', domain: 'Cloud', content: 'Salesforce CRM platform. Sales Cloud Service Cloud Marketing Cloud Slack Tableau MuleSoft. Einstein AI. 150K customers.' },
  { filename: 'SAP_S4HANA.md', domain: 'Cloud', content: 'SAP S4HANA ERP platform. Cloud and on-prem. HANA in-memory database. RISE with SAP migration. Partners with Accenture Deloitte.' },
  { filename: 'ServiceNow_Platform.md', domain: 'Cloud', content: 'ServiceNow Now Platform. ITSM ITOM HR CSM workflows. AI with Generative AI. Used by Deloitte Accenture major enterprises.' },
  { filename: 'Workday_HCM.md', domain: 'Cloud', content: 'Workday HCM and financials. Cloud-native SaaS. Adaptive Planning. Used by Netflix Target. Partners with Accenture Deloitte.' },
]

async function main() {
  console.log(`=== MEGA ENRICHMENT: ${DOCS.length} docs via RLM streams ===\n`)
  const t0 = Date.now()

  const BATCH_SIZE = 10
  let totalExtracted = 0
  let totalMerged = 0

  for (let i = 0; i < DOCS.length; i += BATCH_SIZE) {
    const batch = DOCS.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(DOCS.length / BATCH_SIZE)
    console.log(`Batch ${batchNum}/${totalBatches}: ${batch.length} docs...`)
    const batchT0 = Date.now()

    const extractions = await Promise.all(batch.map(async doc => {
      const arts = await streamA2A('cognitive-reasoning',
        `Extract named entities. Reply ONLY as JSON: {"entities":[{"name":"...","type":"Organization|Framework|Product|Regulation|Service|Technology"}]}\n\nDocument: ${doc.content}`
      )
      return { ...doc, entities: parseEntities(arts.join(' ')) }
    }))

    const batchExtracted = extractions.reduce((s, e) => s + e.entities.length, 0)
    totalExtracted += batchExtracted

    const mergeResults = await Promise.all(extractions.map(doc => mergeBatch(doc.entities, doc.filename, doc.domain)))
    const batchMerged = mergeResults.reduce((s, m) => s + m, 0)
    totalMerged += batchMerged

    console.log(`  -> ${batchExtracted} extracted, ${batchMerged} merged (${Date.now() - batchT0}ms)`)
  }

  console.log(`\n=== PIPELINE COMPLETE ===`)
  console.log(`Docs: ${DOCS.length}`)
  console.log(`Entities extracted: ${totalExtracted}`)
  console.log(`Entities merged: ${totalMerged}`)
  console.log(`Duration: ${Date.now() - t0}ms`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
