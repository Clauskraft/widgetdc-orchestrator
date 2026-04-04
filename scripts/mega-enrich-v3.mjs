// v3: Uses raptor.index for RAG-integrated enrichment
const BACKEND = 'https://backend-production-d3da.up.railway.app'
const BACKEND_KEY = 'Heravej_22'

async function raptorIndex(content, title, domain) {
  try {
    const res = await fetch(`${BACKEND}/api/mcp/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BACKEND_KEY}` },
      body: JSON.stringify({
        tool: 'raptor.index',
        payload: {
          content,
          metadata: { title, domain },
          orgId: 'default',
        }
      }),
      signal: AbortSignal.timeout(25000),
    })
    const data = await res.json()
    return data?.result?.success === true ? data.result.data : null
  } catch { return null }
}

const KNOWLEDGE = [
  // Finance (10)
  { title: 'Stripe Payments', domain: 'Finance', content: 'Stripe payment processing platform. Stripe Connect for marketplaces. Radar fraud prevention. PCI DSS Level 1. Used by Shopify Amazon Klarna. $95B valuation. Founded by Collison brothers.' },
  { title: 'Adyen Unified Payments', domain: 'Finance', content: 'Adyen unified payments Dutch fintech. Acquiring processing risk management. Used by Uber Spotify Microsoft. NYSE listed ADYEN. European PSP leader.' },
  { title: 'Plaid Open Banking', domain: 'Finance', content: 'Plaid open banking API. Bank account connectivity. PSD2 compliant. Venmo Robinhood Coinbase customers. Enables fintech apps to connect to bank accounts securely.' },
  { title: 'BlackRock Aladdin', domain: 'Finance', content: 'BlackRock Aladdin portfolio management platform. 21T AUM managed. Risk analytics. Used by pension funds sovereign wealth. Industry standard for institutional investors.' },
  { title: 'Bloomberg Terminal', domain: 'Finance', content: 'Bloomberg Terminal financial data platform. 325K subscribers. News analytics trading. Microsoft partnership. Wall Street standard for traders and analysts.' },
  { title: 'Visa Network', domain: 'Finance', content: 'Visa payment network. 3.8B cards worldwide. Tokenization security. Visa Direct real-time payments. Fintech partnerships. NYSE listed V.' },
  { title: 'Klarna BNPL', domain: 'Finance', content: 'Klarna Buy Now Pay Later Swedish fintech. 150M users. Macys HM partners. Regulator scrutiny. Pioneer in BNPL e-commerce financing.' },
  { title: 'Revolut Digital Bank', domain: 'Finance', content: 'Revolut digital bank 30M users. Crypto trading stock investing. EU banking license. Challenges traditional banking. UK headquartered fintech unicorn.' },
  { title: 'SWIFT gpi', domain: 'Finance', content: 'SWIFT gpi global payment innovation. Cross-border payments tracking. ISO 20022 messaging standard. 11000 banks worldwide. International wire transfer network.' },
  { title: 'Refinitiv LSEG', domain: 'Finance', content: 'Refinitiv Eikon LSEG London Stock Exchange. Financial data analytics. Reuters news integration. FTSE Russell indices. Used by hedge funds and investment banks.' },

  // AI vendors (10)
  { title: 'OpenAI ChatGPT', domain: 'AI', content: 'OpenAI offers ChatGPT GPT-4 DALL-E Whisper. Enterprise API with Azure partnership. SOC 2 compliant. Foundation model market leader. Used by Salesforce Stripe Klarna.' },
  { title: 'Anthropic Claude', domain: 'AI', content: 'Anthropic develops Claude AI assistant. Constitutional AI methodology. Partnerships with AWS Google Cloud. Used by Notion Zoom Slack. Safety-focused LLM reasoning.' },
  { title: 'Google Gemini', domain: 'AI', content: 'Google Gemini multimodal LLM family. Integrated with Workspace Vertex AI. Competes OpenAI. Used by Snap Shopify Best Buy. Rebrand from Bard.' },
  { title: 'Microsoft Copilot', domain: 'AI', content: 'Microsoft Copilot embedded in Office 365 GitHub Windows. Built on OpenAI models. Enterprise-grade with Azure. Used by Accenture KPMG. Productivity AI.' },
  { title: 'Mistral AI', domain: 'AI', content: 'Mistral AI French open-source LLM company. Models Mistral 7B Mixtral Large. EU sovereign AI alternative. Azure Microsoft partnership. Apache 2.0 licensed.' },
  { title: 'Hugging Face Hub', domain: 'AI', content: 'Hugging Face hosts ML models datasets. Transformers library. 500K models. Inference API. Enterprise partners AWS Google Microsoft. Open-source ML community leader.' },
  { title: 'LangChain Framework', domain: 'AI', content: 'LangChain LLM application framework. RAG agents memory chains. LangGraph workflows. LangSmith observability. Python TypeScript SDKs.' },
  { title: 'Pinecone Vector DB', domain: 'AI', content: 'Pinecone managed vector database. Billion-scale similarity search. Used by Gong Notion. Partners with Cohere OpenAI. Serverless pricing model.' },
  { title: 'Cohere Enterprise LLMs', domain: 'AI', content: 'Cohere enterprise LLMs. Command Embed Rerank models. Oracle Google partnerships. Focus on retrieval augmented generation. Multilingual support.' },
  { title: 'NVIDIA AI Infrastructure', domain: 'AI', content: 'NVIDIA GPUs CUDA TensorRT Triton Inference Server. H100 A100 B200 chips. NeMo framework. DGX enterprise systems. Dominant AI infrastructure vendor.' },

  // Cybersecurity (10)
  { title: 'Palo Alto Networks', domain: 'Cybersecurity', content: 'Palo Alto Networks Prisma Cloud Cortex XSIAM Next-Gen Firewalls. Zero Trust architecture. SASE leader. Used by Deloitte Accenture enterprise customers.' },
  { title: 'CrowdStrike Falcon', domain: 'Cybersecurity', content: 'CrowdStrike Falcon endpoint protection. AI-driven threat detection. MDR services. SOC 2 certified. Used by Goldman Sachs Target. Public company listed CRWD.' },
  { title: 'Okta Identity', domain: 'Cybersecurity', content: 'Okta identity management SSO MFA Zero Trust access. Partners with Microsoft Google. Used by Slack Zoom. Auth0 acquisition. Public company OKTA.' },
  { title: 'Zscaler Zero Trust', domain: 'Cybersecurity', content: 'Zscaler Zero Trust Exchange cloud-native security. SASE architecture. Replaces traditional VPN. Used by Siemens GE. ZIA ZPA products.' },
  { title: 'SentinelOne XDR', domain: 'Cybersecurity', content: 'SentinelOne XDR platform autonomous AI protection. Singularity platform. MITRE ATT&CK coverage. ISO 27001 certified. Storyline technology.' },
  { title: 'Wiz CNAPP', domain: 'Cybersecurity', content: 'Wiz Cloud-Native Application Protection Platform. Multi-cloud security AWS Azure GCP. Used by Salesforce BMW. Fastest-growing cybersecurity unicorn.' },
  { title: 'Snyk DevSec', domain: 'Cybersecurity', content: 'Snyk developer security platform. SCA SAST container Kubernetes scanning. GitHub GitLab integrations. Used by Google Salesforce.' },
  { title: 'Darktrace AI', domain: 'Cybersecurity', content: 'Darktrace Enterprise Immune System. AI-based threat detection. Antigena autonomous response. Used by Rolls-Royce. British cybersecurity firm.' },
  { title: 'Tenable Vulnerability', domain: 'Cybersecurity', content: 'Tenable Nessus vulnerability scanner. Tenable.io cloud platform. Exposure management. Used by JPMorgan Siemens. Public company TENB.' },
  { title: 'Rapid7 SIEM', domain: 'Cybersecurity', content: 'Rapid7 InsightVM vulnerability management. InsightIDR SIEM. Metasploit penetration testing. Used by NASA AWS. Public company RPD.' },

  // Cloud Platforms (10)
  { title: 'AWS Services', domain: 'Cloud', content: 'Amazon Web Services EC2 S3 RDS Lambda. 200 services. Market leader. Partners with Accenture Deloitte for migration. Founded by Jeff Bezos.' },
  { title: 'Microsoft Azure', domain: 'Cloud', content: 'Microsoft Azure cloud OpenAI Cosmos DB AKS. Sovereign regions in EU. Partners with SAP Oracle. Used by BMW Unilever. Satya Nadella CEO.' },
  { title: 'Google Cloud Platform', domain: 'Cloud', content: 'Google Cloud Platform BigQuery Vertex AI GKE. Anthos multi-cloud. Partners with Deloitte Accenture. Used by Spotify PayPal.' },
  { title: 'Snowflake Data Cloud', domain: 'Cloud', content: 'Snowflake Data Cloud platform. Data warehousing sharing apps. Multi-cloud AWS Azure GCP. Used by Capital One BlackRock. NYSE SNOW.' },
  { title: 'Databricks Lakehouse', domain: 'Cloud', content: 'Databricks Lakehouse Platform. Unified analytics ML. Delta Lake MLflow. Partners with AWS Azure. Used by Shell HSBC. Co-founded by Apache Spark creators.' },
  { title: 'Oracle Cloud OCI', domain: 'Cloud', content: 'Oracle Cloud Infrastructure Autonomous Database. Partnerships with Microsoft Azure NVIDIA. Used by Zoom FedEx. Larry Ellison chairman.' },
  { title: 'Salesforce Platform', domain: 'Cloud', content: 'Salesforce CRM platform Sales Cloud Service Cloud Marketing Cloud Slack Tableau MuleSoft. Einstein AI. 150K customers. Marc Benioff CEO.' },
  { title: 'SAP S4HANA', domain: 'Cloud', content: 'SAP S4HANA ERP platform. Cloud and on-prem. HANA in-memory database. RISE with SAP migration. Partners with Accenture Deloitte. German software giant.' },
  { title: 'ServiceNow Platform', domain: 'Cloud', content: 'ServiceNow Now Platform ITSM ITOM HR CSM workflows. Generative AI. Used by Deloitte Accenture. Bill McDermott CEO. NYSE listed NOW.' },
  { title: 'Workday HCM', domain: 'Cloud', content: 'Workday HCM and financials cloud SaaS. Adaptive Planning. Used by Netflix Target. Partners with Accenture Deloitte. Founded by PeopleSoft veterans.' },

  // Consulting (10)
  { title: 'McKinsey Digital', domain: 'Consulting', content: 'McKinsey Digital transformation services. QuantumBlack AI lab. Lilli AI assistant. Partners with OpenAI BCG Accenture Capgemini. 45K employees global.' },
  { title: 'BCG Platinion', domain: 'Consulting', content: 'BCG Boston Consulting Group Platinion tech consulting. GENE AI chatbot. Digital BCG strategy. Partners with MIT. 32K employees worldwide.' },
  { title: 'Accenture Song', domain: 'Consulting', content: 'Accenture Song creative services. Accenture Federal Services. SAP Salesforce Microsoft partner. 743K employees globally. NYSE listed ACN.' },
  { title: 'Deloitte Technology', domain: 'Consulting', content: 'Deloitte technology consulting. Monitor strategy. Human Capital. SAP Workday Salesforce partner. 415K employees. Big Four auditing firm.' },
  { title: 'PwC Digital', domain: 'Consulting', content: 'PwC digital transformation consulting. Strategy Plus. Cloud migration services. SAP Oracle partner. 328K employees. Big Four auditing firm.' },
  { title: 'EY Consulting', domain: 'Consulting', content: 'EY Ernst Young consulting services. Tax audit advisory. SAP Microsoft partner. 395K employees. Sustainability reporting expertise.' },
  { title: 'KPMG Advisory', domain: 'Consulting', content: 'KPMG advisory services. Risk and regulatory compliance. SAP Workday partner. 273K employees. Big Four auditor. Cyber and cloud practice.' },
  { title: 'Capgemini Engineering', domain: 'Consulting', content: 'Capgemini Engineering French IT services. SAP Salesforce Microsoft partner. Sogeti testing. 340K employees. Inviso acquisitions.' },
  { title: 'IBM Consulting', domain: 'Consulting', content: 'IBM Consulting Watson AI consulting. Red Hat integration. Hybrid cloud strategy. SAP Salesforce partner. Formerly IBM Global Services.' },
  { title: 'TCS Digital', domain: 'Consulting', content: 'Tata Consultancy Services TCS Indian IT giant. SAP Microsoft partner. BFSI retail verticals. 600K employees. Mumbai based.' },
]

async function main() {
  console.log(`=== MEGA ENRICH v3: ${KNOWLEDGE.length} chunks via raptor.index ===\n`)
  const t0 = Date.now()

  const BATCH = 5
  let indexed = 0
  let failed = 0

  for (let i = 0; i < KNOWLEDGE.length; i += BATCH) {
    const batch = KNOWLEDGE.slice(i, i + BATCH)
    const batchT0 = Date.now()
    const results = await Promise.all(batch.map(k => raptorIndex(k.content, k.title, k.domain)))
    const batchOk = results.filter(r => r !== null).length
    indexed += batchOk
    failed += (batch.length - batchOk)
    console.log(`Batch ${Math.floor(i/BATCH)+1}/${Math.ceil(KNOWLEDGE.length/BATCH)}: ${batchOk}/${batch.length} indexed (${Date.now() - batchT0}ms)`)
  }

  console.log(`\n=== DONE ===`)
  console.log(`Indexed: ${indexed}/${KNOWLEDGE.length}`)
  console.log(`Failed: ${failed}`)
  console.log(`Duration: ${Date.now() - t0}ms`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
