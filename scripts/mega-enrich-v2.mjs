// v2: Uses cma.memory.store for automatic embedding generation
// This makes entities searchable via SRAG + autonomous.graphrag

const BACKEND = 'https://backend-production-d3da.up.railway.app'
const BACKEND_KEY = 'Heravej_22'

async function storeMemory(content, domain, source) {
  try {
    const res = await fetch(`${BACKEND}/api/mcp/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BACKEND_KEY}` },
      body: JSON.stringify({
        tool: 'cma.memory.store',
        payload: {
          content,
          type: 'knowledge',
          domain,
          source,
        }
      }),
      signal: AbortSignal.timeout(20000),
    })
    const data = await res.json()
    return data?.result?.success === true
  } catch { return false }
}

// 60 rich knowledge chunks — each becomes a searchable memory with embeddings
const KNOWLEDGE = [
  // AI ecosystem (12)
  { domain: 'AI', content: 'OpenAI ChatGPT GPT-4 DALL-E Whisper enterprise API. Azure partnership. SOC 2 compliant. Used by Salesforce Stripe Klarna. Foundation model market leader.' },
  { domain: 'AI', content: 'Anthropic Claude constitutional AI methodology. AWS Google Cloud partnerships. Used by Notion Zoom Slack. Safety-focused LLM with strong reasoning.' },
  { domain: 'AI', content: 'Google Gemini multimodal LLM family. Workspace Vertex AI integration. Competes OpenAI. Snap Shopify Best Buy customers. Bard rebrand.' },
  { domain: 'AI', content: 'Microsoft Copilot in Office 365 GitHub Windows. Built on OpenAI. Azure enterprise. Accenture KPMG using it. Productivity AI leader.' },
  { domain: 'AI', content: 'Mistral AI French open-source LLM. Mistral 7B Mixtral Large models. EU sovereign AI alternative. Azure Microsoft partnership. Apache 2.0 licensed.' },
  { domain: 'AI', content: 'Hugging Face model hub. Transformers library. 500K models. Inference API. AWS Google Microsoft partners. Open-source ML community leader.' },
  { domain: 'AI', content: 'LangChain LLM application framework. RAG agents memory chains. LangGraph workflows. LangSmith observability. Python TypeScript SDKs.' },
  { domain: 'AI', content: 'Pinecone managed vector database. Similarity search at billion-scale. Gong Notion customers. Cohere OpenAI partnerships. Serverless pricing.' },
  { domain: 'AI', content: 'Cohere enterprise LLMs. Command Embed Rerank models. Oracle Google partnerships. Focus on RAG. Multilingual support strong.' },
  { domain: 'AI', content: 'NVIDIA GPUs CUDA TensorRT Triton. H100 A100 B200 chips. NeMo framework. DGX systems. Dominant AI infrastructure vendor.' },
  { domain: 'AI', content: 'Weaviate open-source vector database. Hybrid search. Multi-modal. Kubernetes deployment. Used by Unilever Stack Overflow.' },
  { domain: 'AI', content: 'LlamaIndex RAG framework. Data connectors agents. Query engines. Pinecone Weaviate integrations. Multi-modal indexes.' },

  // Cybersecurity (12)
  { domain: 'Cybersecurity', content: 'Palo Alto Networks Prisma Cloud Cortex XSIAM Next-Gen Firewalls. Zero Trust. Deloitte Accenture enterprise customers. SASE leader.' },
  { domain: 'Cybersecurity', content: 'CrowdStrike Falcon endpoint protection. AI-driven threat detection. MDR services. Goldman Sachs Target customers. SOC 2 certified.' },
  { domain: 'Cybersecurity', content: 'Okta identity management SSO MFA. Zero Trust access. Microsoft Google partners. Slack Zoom customers. Auth0 acquisition.' },
  { domain: 'Cybersecurity', content: 'Zscaler Zero Trust Exchange cloud-native. SASE architecture. Replaces VPN. Siemens GE customers. ZIA ZPA products.' },
  { domain: 'Cybersecurity', content: 'SentinelOne XDR autonomous AI protection. Singularity platform. MITRE ATT&CK coverage. ISO 27001 certified. Storyline technology.' },
  { domain: 'Cybersecurity', content: 'Wiz CNAPP cloud-native protection. Multi-cloud AWS Azure GCP. Salesforce BMW customers. Fastest-growing cybersecurity unicorn.' },
  { domain: 'Cybersecurity', content: 'Snyk developer security platform. SCA SAST container Kubernetes scanning. GitHub GitLab integrations. Google Salesforce customers.' },
  { domain: 'Cybersecurity', content: 'Tenable Nessus vulnerability scanner. Tenable.io cloud platform. Exposure management. JPMorgan Siemens customers. Public company.' },
  { domain: 'Cybersecurity', content: 'Darktrace Enterprise Immune System. AI behavioral threat detection. Antigena autonomous response. Rolls-Royce customers. British firm.' },
  { domain: 'Cybersecurity', content: 'Rapid7 InsightVM InsightIDR SIEM XDR. Metasploit framework. NASA AWS customers. Public company. Nexpose legacy.' },
  { domain: 'Cybersecurity', content: 'NIS2 directive EU 2022/2555. Cybersecurity obligations. 6000 entities scope. Effective July 2025. Supersedes NIS Directive.' },
  { domain: 'Cybersecurity', content: 'DORA Digital Operational Resilience Act. EU financial sector ICT risk. Effective January 2025. Banks insurance investment firms.' },

  // Finance (12)
  { domain: 'Finance', content: 'Stripe payment processing. Connect marketplaces. Radar fraud prevention. PCI DSS Level 1. Shopify Amazon customers. $95B valuation.' },
  { domain: 'Finance', content: 'Bloomberg Terminal financial data. 325K subscribers. News analytics trading. Microsoft partnership. Wall Street standard.' },
  { domain: 'Finance', content: 'Refinitiv Eikon LSEG. Financial data analytics. Reuters news. FTSE Russell indices. Hedge fund customers. London Stock Exchange.' },
  { domain: 'Finance', content: 'BlackRock Aladdin portfolio management. 21T AUM managed. Risk analytics. Pension funds sovereign wealth. Industry standard.' },
  { domain: 'Finance', content: 'Plaid open banking API. Bank account connectivity. PSD2 compliant. Venmo Robinhood Coinbase customers. Visa acquisition blocked.' },
  { domain: 'Finance', content: 'Adyen unified payments Dutch fintech. Acquiring processing risk. Uber Spotify Microsoft customers. NYSE listed ADYEN.' },
  { domain: 'Finance', content: 'Revolut digital bank 30M users. Crypto trading stock investing. EU license. Challenges traditional banking. UK headquartered.' },
  { domain: 'Finance', content: 'Klarna BNPL Swedish fintech. 150M users. Macys H&M partners. Regulator scrutiny. Buy Now Pay Later leader.' },
  { domain: 'Finance', content: 'SWIFT gpi global payment innovation. Cross-border tracking. ISO 20022 messaging. 11000 banks. International wire transfers.' },
  { domain: 'Finance', content: 'Visa payment network 3.8B cards. Tokenization. Visa Direct real-time. Fintech partnerships. NYSE listed V.' },
  { domain: 'Finance', content: 'CSRD Corporate Sustainability Reporting Directive EU. Mandatory sustainability reporting. ESG disclosures. Large EU companies.' },
  { domain: 'Finance', content: 'Basel III capital requirements banks. Risk-weighted assets. CET1 Tier1 capital ratios. BIS standards. Liquidity coverage.' },

  // Consulting (12)
  { domain: 'Consulting', content: 'PwC digital transformation Strategy&. Cloud migration services. SAP Oracle partner. Big Four auditing. 328K employees global.' },
  { domain: 'Consulting', content: 'Deloitte technology consulting Monitor strategy. Human Capital. SAP Workday Salesforce partner. Global presence. 415K employees.' },
  { domain: 'Consulting', content: 'EY Ernst Young consulting. Tax audit advisory. SAP Microsoft partner. Sustainability reporting. 395K employees. Big Four.' },
  { domain: 'Consulting', content: 'KPMG advisory services risk regulatory. SAP Workday partner. Big Four auditor. Cyber cloud practice. 273K employees.' },
  { domain: 'Consulting', content: 'McKinsey Digital transformation. QuantumBlack AI lab. Lilli AI assistant. OpenAI BCG Accenture Capgemini partnerships. 45K employees.' },
  { domain: 'Consulting', content: 'BCG Boston Consulting Group. Platinion tech. GENE AI chatbot. Digital BCG strategy. MIT partnership. 32K employees.' },
  { domain: 'Consulting', content: 'Accenture Song creative. Federal Services. SAP Salesforce Microsoft partner. 743K employees globally. NYSE listed ACN.' },
  { domain: 'Consulting', content: 'Capgemini Engineering French IT. SAP Salesforce Microsoft partner. Inviso acquisition. Sogeti testing. 340K employees.' },
  { domain: 'Consulting', content: 'IBM Consulting formerly IGS. Watson AI consulting. Red Hat integration. Hybrid cloud strategy. SAP Salesforce partner.' },
  { domain: 'Consulting', content: 'TCS Tata Consultancy Services Indian IT giant. SAP Microsoft partner. BFSI retail verticals. 600K employees. Mumbai based.' },
  { domain: 'Consulting', content: 'Netcompany Danish IT consulting. TOGAF framework. Microsoft Azure partner. NIS2 compliant. Public sector specialist.' },
  { domain: 'Consulting', content: 'Implement Consulting Group Nordic. SAP S/4HANA specialist. SAFe Agile. ISO 27001. Public sector focus Denmark Sweden.' },

  // Cloud & Platforms (12)
  { domain: 'Cloud', content: 'AWS Amazon Web Services EC2 S3 RDS Lambda. 200 services. Market leader. Accenture Deloitte migration partners. Jeff Bezos founded.' },
  { domain: 'Cloud', content: 'Microsoft Azure cloud OpenAI Cosmos DB AKS. Sovereign EU regions. SAP Oracle partners. BMW Unilever customers. Satya Nadella.' },
  { domain: 'Cloud', content: 'Google Cloud Platform BigQuery Vertex AI GKE. Anthos multi-cloud. Deloitte Accenture partners. Spotify PayPal customers.' },
  { domain: 'Cloud', content: 'Snowflake Data Cloud. Warehousing sharing apps. Multi-cloud AWS Azure GCP. Capital One BlackRock customers. NYSE SNOW.' },
  { domain: 'Cloud', content: 'Databricks Lakehouse Platform. Unified analytics ML. Delta Lake MLflow. AWS Azure partners. Shell HSBC customers.' },
  { domain: 'Cloud', content: 'Oracle Cloud Infrastructure OCI. Autonomous Database. Microsoft Azure NVIDIA partnerships. Zoom FedEx customers. Larry Ellison.' },
  { domain: 'Cloud', content: 'Salesforce CRM Sales Service Marketing Cloud. Slack Tableau MuleSoft. Einstein AI. 150K customers. Marc Benioff CEO.' },
  { domain: 'Cloud', content: 'SAP S/4HANA ERP cloud on-prem. HANA in-memory DB. RISE with SAP migration. Accenture Deloitte partners. German software giant.' },
  { domain: 'Cloud', content: 'ServiceNow Now Platform ITSM ITOM HR CSM. Generative AI. Deloitte Accenture customers. Bill McDermott CEO. NYSE NOW.' },
  { domain: 'Cloud', content: 'Workday HCM financials cloud SaaS. Adaptive Planning. Netflix Target customers. Accenture Deloitte partners. Founded by PeopleSoft veterans.' },
  { domain: 'Cloud', content: 'Kubernetes container orchestration CNCF project. Google origin. EKS GKE AKS managed services. De facto standard.' },
  { domain: 'Cloud', content: 'Docker container runtime. Compose Swarm. Desktop enterprise. DockerHub registry. Industry standard containerization.' },
]

async function main() {
  console.log(`=== MEGA ENRICH v2: ${KNOWLEDGE.length} knowledge chunks via cma.memory.store ===\n`)
  const t0 = Date.now()

  const BATCH = 10
  let stored = 0
  for (let i = 0; i < KNOWLEDGE.length; i += BATCH) {
    const batch = KNOWLEDGE.slice(i, i + BATCH)
    const batchT0 = Date.now()
    const results = await Promise.all(batch.map(k => storeMemory(k.content, k.domain, 'mega-enrich-v2')))
    const batchStored = results.filter(r => r).length
    stored += batchStored
    console.log(`Batch ${Math.floor(i/BATCH)+1}/${Math.ceil(KNOWLEDGE.length/BATCH)}: ${batchStored}/${batch.length} stored (${Date.now() - batchT0}ms)`)
  }

  console.log(`\n=== DONE ===`)
  console.log(`Total stored: ${stored}/${KNOWLEDGE.length}`)
  console.log(`Duration: ${Date.now() - t0}ms`)
  console.log(`\nNow embeddings are auto-generated. Run measure-kpi.mjs to test.`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
