// v5: Deep expansion — Consulting → IT Tools → Code → AI Tools
const BACKEND = 'https://backend-production-d3da.up.railway.app'
const BACKEND_KEY = 'Heravej_22'

async function raptorIndex(content, title, domain) {
  try {
    const res = await fetch(`${BACKEND}/api/mcp/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BACKEND_KEY}` },
      body: JSON.stringify({
        tool: 'raptor.index',
        payload: { content, metadata: { title, domain }, orgId: 'default' }
      }),
      signal: AbortSignal.timeout(25000),
    })
    const data = await res.json()
    return data?.result?.success === true ? data.result.data : null
  } catch { return null }
}

const KNOWLEDGE = [
  // ============ CONSULTING METHODOLOGIES & PRACTICES (40) ============
  { title: 'McKinsey 7-Step Problem Solving', domain: 'Consulting', content: 'McKinsey 7-step problem solving method. Define problem, disaggregate, prioritize, workplan, analyze, synthesize, communicate. MECE principle mutually exclusive collectively exhaustive. Hypothesis-driven approach. Used across McKinsey engagements globally.' },
  { title: 'BCG Growth-Share Matrix', domain: 'Consulting', content: 'BCG Growth-Share Matrix 4 quadrants stars cash cows question marks dogs. Portfolio strategy tool. Market growth vs relative market share. Classic BCG framework from Bruce Henderson 1970. Used for capital allocation decisions.' },
  { title: 'Bain Net Promoter System', domain: 'Consulting', content: 'Bain Net Promoter System NPS customer loyalty metric. Would you recommend 0-10 scale. Promoters detractors passives. Fred Reichheld Bain. Used by Apple Amazon Zappos. Predicts revenue growth.' },
  { title: 'Deloitte Greenhouse', domain: 'Consulting', content: 'Deloitte Greenhouse immersive lab experiences. Design thinking workshops. Strategy acceleration. Digital transformation labs. Executive engagement format. Used for C-suite problem solving sessions.' },
  { title: 'Accenture myConcerto', domain: 'Consulting', content: 'Accenture myConcerto SAP transformation platform. Intelligent enterprise. Cloud migration accelerator. RISE with SAP methodology. Used for S4HANA implementations. Industry-specific reference architectures.' },
  { title: 'PwC BXT Framework', domain: 'Consulting', content: 'PwC BXT Business eXperience Technology framework. Integrated consulting model. Combines strategy design technology. Customer-centric transformation. Used for enterprise digital programs.' },
  { title: 'EY Wavespace', domain: 'Consulting', content: 'EY Wavespace global network growth innovation centers. Design thinking. Co-innovation with clients. 40+ locations worldwide. Focus on emerging technology adoption.' },
  { title: 'KPMG Ignition Centers', domain: 'Consulting', content: 'KPMG Ignition Centers digital transformation hubs. Client co-creation spaces. Data analytics labs. AI experimentation. Strategic decision support for executives.' },
  { title: 'Oliver Wyman Strategy', domain: 'Consulting', content: 'Oliver Wyman management consulting. Financial services specialization. Risk management expertise. Marsh McLennan subsidiary. Insurance banking transformation. Used by major European banks.' },
  { title: 'Roland Berger Strategy', domain: 'Consulting', content: 'Roland Berger European strategy consulting. Automotive industry expertise. Industrial goods transformation. German headquarters. 50 offices worldwide. Restructuring turnaround specialists.' },
  { title: 'AT Kearney Supply Chain', domain: 'Consulting', content: 'AT Kearney Kearney global management consulting. Procurement supply chain expertise. Chief Procurement Officer studies. Digital supply networks. Used by Fortune 500 manufacturers.' },
  { title: 'LEK Consulting', domain: 'Consulting', content: 'LEK Consulting strategy firm. Life sciences expertise. M&A due diligence. Private equity advisory. Healthcare transformation. Boston London headquarters.' },
  { title: 'Bain Results Delivery', domain: 'Consulting', content: 'Bain Results Delivery methodology. Change management framework. Program management office setup. KPI tracking accountability. Used for large transformation programs. Focus on measurable outcomes.' },
  { title: 'McKinsey Three Horizons', domain: 'Consulting', content: 'McKinsey Three Horizons framework growth strategy. H1 core business H2 emerging H3 future options. Portfolio innovation balance. Used for strategic planning beyond 3 years.' },
  { title: 'BCG DigitalBCG', domain: 'Consulting', content: 'BCG DigitalBCG unit. Build operate transfer model. Digital ventures platform businesses. BCG X tech build. Gamma AI analytics. Platinion architecture.' },
  { title: 'Stakeholder Mapping', domain: 'Consulting', content: 'Stakeholder mapping power-interest matrix. Salience model prominence urgency legitimacy. RACI responsibility assignment. Influence mapping. Change management foundation. Used in transformation projects.' },
  { title: 'Current State Future State', domain: 'Consulting', content: 'Current state future state gap analysis. As-is to-be architecture. Process mapping. Capability assessment. Used in business process reengineering. Target operating model TOM design.' },
  { title: 'Business Case Development', domain: 'Consulting', content: 'Business case development NPV IRR payback period. Cost benefit analysis. Scenario sensitivity modeling. Risk-adjusted returns. Used for investment approval. Board-level decision support.' },
  { title: 'Value Stream Mapping', domain: 'Consulting', content: 'Value stream mapping lean methodology. Identify waste muda. Current state future state. Takt time cycle time. Toyota Production System origin. Used in operational excellence programs.' },
  { title: 'Operating Model Design', domain: 'Consulting', content: 'Target operating model TOM design. Structure processes people technology governance. Capability-based approach. Business architecture. Used in org restructuring M&A integration.' },
  { title: 'Benchmarking Studies', domain: 'Consulting', content: 'Benchmarking studies best practice comparison. Process metrics KPI comparison. Peer group analysis. Industry leaders identification. Used for performance gap analysis. McKinsey Global Institute reports.' },
  { title: 'Change Management ADKAR', domain: 'Consulting', content: 'ADKAR change management Prosci model. Awareness Desire Knowledge Ability Reinforcement. Individual change focus. Used in large transformations. Kotter 8-step alternative.' },
  { title: 'Kotter 8-Step Change', domain: 'Consulting', content: 'Kotter 8-step change model. Urgency coalition vision communication empowerment wins consolidation anchoring. Organizational change management. Harvard Business School. Used in transformation programs.' },
  { title: 'Hypothesis-Driven Consulting', domain: 'Consulting', content: 'Hypothesis-driven approach consulting. Issue tree decomposition. Day 1 hypothesis. Pyramid principle communication. Barbara Minto methodology. Used in McKinsey BCG Bain engagements.' },
  { title: 'Pyramid Principle', domain: 'Consulting', content: 'Pyramid Principle Barbara Minto. Top-down communication. SCQA situation complication question answer. MECE grouping. Used in consulting presentations executive writing.' },
  { title: 'Due Diligence Framework', domain: 'Consulting', content: 'Commercial due diligence CDD framework. Market sizing competitive positioning. Management assessment. Financial technical operational DD. Used in M&A private equity transactions.' },
  { title: 'Synergy Analysis', domain: 'Consulting', content: 'Synergy analysis M&A revenue cost synergies. Run-rate realization timeline. Integration management office IMO. Day 1 Day 100 planning. Used in post-merger integration.' },
  { title: 'Cost Transformation', domain: 'Consulting', content: 'Cost transformation zero-based budgeting ZBB. Activity-based costing. SG&A optimization. Shared services consolidation. Used for 15-30 percent cost reduction programs. Kraft Heinz 3G Capital.' },
  { title: 'Capability Maturity Model', domain: 'Consulting', content: 'Capability Maturity Model CMM levels 1-5. Initial repeatable defined managed optimizing. Process improvement framework. SEI Carnegie Mellon origin. CMMI evolution.' },
  { title: 'McKinsey Horizon Scanning', domain: 'Consulting', content: 'McKinsey horizon scanning weak signals trends emerging technology. Strategic foresight. Scenario planning. Used for long-term strategy. Technology quarterly reports.' },
  { title: 'Workshop Facilitation', domain: 'Consulting', content: 'Workshop facilitation design thinking. Double diamond discover define develop deliver. Miro Mural collaboration. Ideation convergence. Used in innovation sprints.' },
  { title: 'Storyline Development', domain: 'Consulting', content: 'Storyline development consulting deck. Ghost deck outline. Key messages per page. Action title headers. Used in McKinsey BCG Bain client presentations.' },
  { title: 'Strategy Map Kaplan', domain: 'Consulting', content: 'Strategy map Kaplan Norton. Balanced Scorecard extension. Financial customer process learning perspectives. Cause-effect relationships. Strategic objectives linkage.' },
  { title: 'Capability-Based Planning', domain: 'Consulting', content: 'Capability-based planning CBP. Business capability map. Heat mapping. Investment prioritization. TOGAF aligned. Used in enterprise architecture strategy.' },
  { title: 'Ecosystem Strategy', domain: 'Consulting', content: 'Ecosystem strategy platform business models. BCG Accenture research. Orchestrator roles. Partner network value creation. Used by Alibaba Amazon Tencent Apple.' },
  { title: 'Scenario Planning Shell', domain: 'Consulting', content: 'Scenario planning Shell methodology Pierre Wack. 2x2 matrix scenarios. Weak signals horizon scanning. Long-term strategy formulation. Used for uncertainty navigation.' },
  { title: 'Agile Transformation', domain: 'Consulting', content: 'Agile transformation enterprise scale. SAFe LeSS Spotify model. Tribes squads chapters guilds. ING Spotify success stories. Consulting firms McKinsey Deloitte enable.' },
  { title: 'Digital Maturity Assessment', domain: 'Consulting', content: 'Digital maturity assessment framework. 5-level scale nascent emerging established advanced leading. Capability pillars strategy operations technology culture. Used for transformation roadmap.' },
  { title: 'Lean Portfolio Management', domain: 'Consulting', content: 'Lean portfolio management SAFe framework. Value streams funding. Epic prioritization. WSJF weighted shortest job first. Used in large agile enterprises.' },
  { title: 'Transformation PMO', domain: 'Consulting', content: 'Transformation PMO program management office. Initiative tracking. Benefits realization. Executive steering committee. Used in enterprise change programs. McKinsey Deloitte implementations.' },

  // ============ IT TOOLS & ENTERPRISE SOFTWARE (40) ============
  { title: 'Jira Software', domain: 'IT Tools', content: 'Atlassian Jira issue tracking agile project management. Scrum Kanban boards. Jira Query Language JQL. Integrations GitHub Slack Confluence. Used by 180K customers globally. Data Center Cloud editions.' },
  { title: 'Confluence Wiki', domain: 'IT Tools', content: 'Atlassian Confluence team workspace documentation. Spaces pages templates. Jira integration. Whiteboards databases. Used for knowledge management. 75K customers enterprise.' },
  { title: 'ServiceNow ITSM', domain: 'IT Tools', content: 'ServiceNow IT Service Management ITSM. Incident problem change management. ITIL aligned. Now Assist AI. Self-service portal. Used by 85 percent Fortune 500.' },
  { title: 'Zendesk Support', domain: 'IT Tools', content: 'Zendesk customer support ticketing. Agent workspace. Omnichannel email chat voice. AI suggested responses. Used by Airbnb Uber Slack. Public company ZEN NYSE.' },
  { title: 'Freshservice ITSM', domain: 'IT Tools', content: 'Freshworks Freshservice IT service management. Asset management. Change enablement. Workflow automator. Used by mid-market enterprises. Alternative to ServiceNow.' },
  { title: 'Notion Workspace', domain: 'IT Tools', content: 'Notion all-in-one workspace docs wikis databases. Blocks-based editing. AI integration. Teams collaboration. 30M users. Used by OpenAI Loom Figma. Enterprise plan.' },
  { title: 'Asana Work Management', domain: 'IT Tools', content: 'Asana work management platform. Projects tasks goals. Timeline Gantt. Workflow builder. Used by Deloitte Amazon. Dustin Moskovitz co-founder. Public company ASAN.' },
  { title: 'Monday.com WorkOS', domain: 'IT Tools', content: 'Monday.com Work OS platform. Boards automations integrations. Customizable workflows. 180K customers. Monday CRM Dev marketer. Israeli SaaS. Public MNDY.' },
  { title: 'Trello Boards', domain: 'IT Tools', content: 'Atlassian Trello Kanban boards. Cards lists boards. Power-Ups integrations. Butler automation. Used for simple project tracking. 50M users.' },
  { title: 'Slack Messaging', domain: 'IT Tools', content: 'Slack team messaging channels DMs. Huddles Canvas Lists. App directory 2600 apps. Salesforce acquisition 2021. Enterprise Grid. Used by 200K orgs.' },
  { title: 'Microsoft Teams', domain: 'IT Tools', content: 'Microsoft Teams collaboration chat meetings. Office 365 integration. Copilot AI assistant. Channels breakout rooms. 320M monthly users. Largest enterprise communication platform.' },
  { title: 'Zoom Workplace', domain: 'IT Tools', content: 'Zoom Workplace video meetings webinars. Zoom Phone Rooms. AI Companion. Zoom Team Chat. 300K enterprise customers. Eric Yuan CEO.' },
  { title: 'Figma Design', domain: 'IT Tools', content: 'Figma collaborative design tool. Vector editing prototyping. FigJam whiteboard. Dev Mode for handoff. Adobe acquisition blocked. 4M users. Used by Microsoft Google.' },
  { title: 'Miro Whiteboard', domain: 'IT Tools', content: 'Miro online whiteboard collaboration. Templates brainstorming diagrams. Workshop facilitation. 60M users. Integrations Jira Asana Slack. Enterprise plan.' },
  { title: 'Lucidchart Diagrams', domain: 'IT Tools', content: 'Lucidchart intelligent diagramming. Flowcharts ERDs architecture diagrams. Lucid Visual Collaboration Suite. Used by 99 percent Fortune 500. SaaS company.' },
  { title: 'Tableau Analytics', domain: 'IT Tools', content: 'Salesforce Tableau data visualization analytics. Drag-drop dashboards. Tableau Prep. Einstein AI insights. CRM Analytics. Used by 80K accounts globally.' },
  { title: 'Power BI Microsoft', domain: 'IT Tools', content: 'Microsoft Power BI business intelligence. Dashboards reports datasets. DirectQuery Import. Fabric integration. Copilot AI. Leader Gartner BI Magic Quadrant.' },
  { title: 'Looker Studio', domain: 'IT Tools', content: 'Google Looker LookML modeling. Looker Studio free dashboards. BigQuery integration. Data Apps. Google acquisition 2020 2.6B. Used for embedded analytics.' },
  { title: 'dbt Data Build Tool', domain: 'IT Tools', content: 'dbt data build tool analytics engineering. SQL transformations. Modeling testing documentation. dbt Cloud managed service. Used by JetBlue Hubspot Shopify. Tristan Handy founder.' },
  { title: 'Snowflake Data Cloud IT', domain: 'IT Tools', content: 'Snowflake Data Cloud warehousing. Separation of storage compute. Time Travel zero copy cloning. Snowpark. Streamlit. Used by 10K customers. NYSE SNOW.' },
  { title: 'Databricks Lakehouse IT', domain: 'IT Tools', content: 'Databricks Lakehouse Platform unified analytics. Delta Lake Unity Catalog. MLflow Mosaic AI. Spark creators. 12K customers. $43B valuation.' },
  { title: 'Fivetran ELT', domain: 'IT Tools', content: 'Fivetran automated data pipelines. 500 connectors. Incremental updates. SaaS source extraction. Zero maintenance. Used by Hubspot Docusign Square. George Fraser CEO.' },
  { title: 'Airbyte Open Source', domain: 'IT Tools', content: 'Airbyte open source data integration. 350 connectors. Custom connector builder. Self-hosted cloud. Alternative Fivetran. Python-based. 100K community users.' },
  { title: 'Segment CDP', domain: 'IT Tools', content: 'Twilio Segment customer data platform CDP. Event collection routing. Unified customer profiles. 300 destinations. Identity resolution. Used by IBM Intuit.' },
  { title: 'Workday Enterprise', domain: 'IT Tools', content: 'Workday HCM Financials Planning. Cloud ERP. Continuous release model. Object data model. 10K customers. NYSE WDAY. Used by Amazon Netflix.' },
  { title: 'SAP S4HANA Enterprise', domain: 'IT Tools', content: 'SAP S4HANA next-generation ERP. In-memory HANA database. Fiori UX. Cloud Public Private editions. RISE with SAP bundle. 2027 deadline ECC end of life.' },
  { title: 'Oracle NetSuite', domain: 'IT Tools', content: 'Oracle NetSuite cloud ERP. Mid-market focus. SuiteCloud platform. Financials CRM inventory ecommerce. 36K customers. Acquired by Oracle 2016 9.3B.' },
  { title: 'Microsoft Dynamics 365', domain: 'IT Tools', content: 'Microsoft Dynamics 365 business apps. Sales Customer Service Finance Supply Chain. Power Platform integration. Copilot AI embedded. Used by mid to large enterprises.' },
  { title: 'Salesforce Sales Cloud', domain: 'IT Tools', content: 'Salesforce Sales Cloud CRM opportunity management. Einstein AI forecasting. Sales Engagement. Pardot marketing automation. 150K customers. Marc Benioff founder.' },
  { title: 'HubSpot CRM', domain: 'IT Tools', content: 'HubSpot CRM marketing sales service. Free tier. Inbound methodology. Marketing Hub Sales Hub Service Hub. Used by 205K customers. Brian Halligan founder.' },
  { title: 'Okta Identity Cloud', domain: 'IT Tools', content: 'Okta Workforce Identity Customer Identity Auth0. SSO MFA lifecycle management. 19K customers. Integration network 7000 apps. Public OKTA.' },
  { title: 'JumpCloud Directory', domain: 'IT Tools', content: 'JumpCloud open directory platform. Device identity access. MDM alternative. Cross-platform Mac Windows Linux. Used by mid-market as Active Directory alternative.' },
  { title: 'CrowdStrike Falcon Platform', domain: 'IT Tools', content: 'CrowdStrike Falcon endpoint XDR. Cloud-native agent. Threat Graph. Charlotte AI. MDR services. Used by Goldman Sachs Shell Airbnb.' },
  { title: 'Veeam Backup', domain: 'IT Tools', content: 'Veeam Backup Replication data protection. VMware Hyper-V AWS Azure. Immutable backups. Instant recovery. Used by 450K customers globally.' },
  { title: 'Rubrik Data Security', domain: 'IT Tools', content: 'Rubrik Zero Trust Data Security. Cloud data management. Ransomware recovery. Sensitive data discovery. IPO 2024 NYSE RBRK. Used by Home Depot Shell.' },
  { title: 'Pure Storage', domain: 'IT Tools', content: 'Pure Storage all-flash enterprise storage. FlashArray FlashBlade. Evergreen subscription model. Used by Siemens Meta. Portworx Kubernetes data. NYSE PSTG.' },
  { title: 'VMware vSphere', domain: 'IT Tools', content: 'VMware vSphere server virtualization. vCenter ESXi. vSAN NSX. Broadcom acquisition 2023 61B. Cloud Foundation. Tanzu Kubernetes.' },
  { title: 'Red Hat OpenShift', domain: 'IT Tools', content: 'Red Hat OpenShift enterprise Kubernetes. IBM subsidiary. OperatorHub. OpenShift AI. Used by Deutsche Bank Volkswagen. Hybrid multi-cloud focus.' },
  { title: 'Cloudflare Platform', domain: 'IT Tools', content: 'Cloudflare global network CDN DDoS WAF. Workers edge compute. R2 object storage. Pages Access Tunnel. 20 percent of internet traffic. NYSE NET.' },
  { title: 'Datadog Observability', domain: 'IT Tools', content: 'Datadog cloud monitoring observability. APM logs RUM synthetics. 700 integrations. Cloud Security Management. 28K customers. NASDAQ DDOG.' },

  // ============ CODE & PROGRAMMING (40) ============
  { title: 'TypeScript Language', domain: 'Code', content: 'TypeScript Microsoft typed superset JavaScript. Anders Hejlsberg creator. Interfaces generics decorators. Structural typing. Used by 78 percent professional developers 2024 survey. Angular React Next.js.' },
  { title: 'Python 3.12', domain: 'Code', content: 'Python 3.12 modern features. Type hints PEP 695. Pattern matching. Async await. No-GIL experimental PEP 703. Used in AI ML data science. FastAPI Django Flask.' },
  { title: 'Go Programming', domain: 'Code', content: 'Go Golang Google language. Goroutines channels concurrency. Fast compilation. Static binaries. Used in Kubernetes Docker Terraform. Cloud-native infrastructure lingua franca.' },
  { title: 'Rust Systems Language', domain: 'Code', content: 'Rust memory-safe systems programming. Ownership borrowing. No null undefined behavior. Used in Linux kernel Firefox Discord. Solana blockchain. Mozilla Foundation origin.' },
  { title: 'Java Modern', domain: 'Code', content: 'Java 21 LTS virtual threads Project Loom. Records sealed classes. Pattern matching. GraalVM native image. Spring Boot ecosystem. Used by 60 percent enterprises.' },
  { title: 'Kotlin JetBrains', domain: 'Code', content: 'Kotlin JetBrains language Android official. Null safety coroutines. Interoperable Java. Kotlin Multiplatform. Used by Google Netflix Uber. Spring Boot support.' },
  { title: 'Swift Apple', domain: 'Code', content: 'Swift Apple programming language iOS macOS. Protocol-oriented. SwiftUI declarative UI. Swift concurrency async await. Server-side Vapor. Swift 6 data race safety.' },
  { title: 'C Sharp .NET', domain: 'Code', content: 'C Sharp Microsoft .NET language. .NET 9 performance. ASP.NET Core. Blazor WebAssembly. LINQ pattern matching records. Used in enterprise gaming Unity.' },
  { title: 'React Framework', domain: 'Code', content: 'React Meta Facebook UI library. Components hooks Server Components. React 19 actions use hook. Concurrent rendering. Used by 35 percent web dev 2024. Next.js Remix.' },
  { title: 'Next.js Vercel', domain: 'Code', content: 'Next.js React framework Vercel. App Router Server Components. Streaming SSR ISR. Image optimization. Used by TikTok Netflix Nike. Middleware Edge runtime.' },
  { title: 'Vue.js Framework', domain: 'Code', content: 'Vue.js progressive JavaScript framework. Composition API Vue 3. Nuxt SSR. Pinia state management. Used by Alibaba GitLab Louis Vuitton. Evan You creator.' },
  { title: 'Svelte SvelteKit', domain: 'Code', content: 'Svelte compiled frontend framework. No virtual DOM. Runes reactivity. SvelteKit full-stack. Used by The New York Times Spotify. Rich Harris creator Vercel.' },
  { title: 'Angular Framework', domain: 'Code', content: 'Angular Google full framework. TypeScript first. Signals reactivity. Standalone components. Angular 18 features. Used by enterprise Google internal apps.' },
  { title: 'Node.js Runtime', domain: 'Code', content: 'Node.js V8 JavaScript runtime. Event loop non-blocking IO. npm registry largest. Used for backend APIs. Express Fastify NestJS. OpenJS Foundation.' },
  { title: 'Deno Runtime', domain: 'Code', content: 'Deno TypeScript JavaScript runtime. Secure by default. Built-in tools. Deno Deploy edge. Ryan Dahl Node.js creator. Fresh web framework.' },
  { title: 'Bun Runtime', domain: 'Code', content: 'Bun fast JavaScript runtime Zig. Node.js compatible. Built-in bundler test runner. SQLite FFI. Jarred Sumner. Backed by investors. Elysia framework.' },
  { title: 'Express.js', domain: 'Code', content: 'Express minimal Node.js web framework. Middleware routing. Most popular Node server. Used for REST APIs. OpenJS Foundation. TJ Holowaychuk origin.' },
  { title: 'FastAPI Python', domain: 'Code', content: 'FastAPI Python async web framework. Pydantic validation. Automatic OpenAPI. Type hints. Used by Netflix Microsoft Uber. Sebastián Ramírez creator. High performance.' },
  { title: 'Django Python', domain: 'Code', content: 'Django Python batteries-included web framework. ORM admin forms. Django REST Framework. Used by Instagram Pinterest Spotify. Mature ecosystem.' },
  { title: 'Spring Boot Java', domain: 'Code', content: 'Spring Boot Java framework. Auto-configuration starters. Spring Cloud microservices. GraalVM native support. Used in banking Fortune 500 backends.' },
  { title: 'PostgreSQL Database', domain: 'Code', content: 'PostgreSQL open source relational database. JSONB full-text search. Extensions PostGIS TimescaleDB pgvector. Logical replication. Used by Instagram Apple Reddit.' },
  { title: 'MySQL Database', domain: 'Code', content: 'MySQL Oracle relational database. InnoDB engine. Group replication. MySQL HeatWave analytics. Used by Facebook YouTube Twitter origin. Wordpress standard.' },
  { title: 'MongoDB NoSQL', domain: 'Code', content: 'MongoDB document database NoSQL. Atlas managed cloud. Change streams aggregation. Time series collections. Vector search. Used by Adobe Forbes eBay.' },
  { title: 'Redis Cache', domain: 'Code', content: 'Redis in-memory data store. Strings hashes lists sets. Streams pub/sub. Redis Stack JSON search vector. Used by Twitter GitHub StackOverflow.' },
  { title: 'Git Version Control', domain: 'Code', content: 'Git distributed version control Linus Torvalds 2005. Commits branches merges. Worktrees bisect rebase. GitHub GitLab Bitbucket. Used by 94 percent developers.' },
  { title: 'GitHub Copilot', domain: 'Code', content: 'GitHub Copilot AI pair programmer. OpenAI Codex powered. Chat inline completions. Enterprise trust center. 1.8M paid users. 77K orgs. Microsoft GitHub.' },
  { title: 'Docker Containers', domain: 'Code', content: 'Docker containerization platform. Dockerfile image registry. Docker Compose multi-container. Docker Desktop. Used by 13M developers. OCI image spec origin.' },
  { title: 'Kubernetes Code', domain: 'Code', content: 'Kubernetes container orchestration. Pods deployments services. Helm charts operators. CNCF graduated. Used by 96 percent cloud-native orgs. Google Borg origin.' },
  { title: 'Terraform IaC', domain: 'Code', content: 'HashiCorp Terraform infrastructure as code. HCL language. Providers AWS Azure GCP. State management backends. OpenTofu fork. IBM acquisition 2024.' },
  { title: 'GraphQL APIs', domain: 'Code', content: 'GraphQL query language APIs. Schema types resolvers. Apollo Server Client. Federation subgraphs. Used by Facebook GitHub Shopify. Relay framework.' },
  { title: 'REST API Design', domain: 'Code', content: 'REST representational state transfer. Resources verbs HATEOAS. OpenAPI Swagger specification. Roy Fielding dissertation. Standard enterprise API style.' },
  { title: 'gRPC Protocol', domain: 'Code', content: 'gRPC Google RPC framework. Protocol Buffers. HTTP/2 streaming. Polyglot SDKs. Used by Netflix Square Dropbox. Service mesh compatibility.' },
  { title: 'Vite Build Tool', domain: 'Code', content: 'Vite frontend build tool Evan You. ESBuild dev server. Rollup production. Fast HMR. Used by Vue React Svelte projects. Modern JavaScript tooling standard.' },
  { title: 'ESLint TypeScript', domain: 'Code', content: 'ESLint JavaScript TypeScript linter. Plugin ecosystem. Rules configuration. Flat config. typescript-eslint. Used universally. Prettier integration.' },
  { title: 'Vitest Testing', domain: 'Code', content: 'Vitest Vite-native testing. Jest compatible API. Browser mode. In-source testing. Snapshot testing. Used with Vue React Svelte. Fast isolation.' },
  { title: 'Playwright E2E', domain: 'Code', content: 'Playwright Microsoft E2E testing. Chromium Firefox WebKit. Auto-wait trace viewer. TypeScript Python Java .NET. VS Code integration. Used by Adobe Disney.' },
  { title: 'Cypress Testing', domain: 'Code', content: 'Cypress JavaScript E2E testing. Time travel debugging. Component testing. Cloud dashboard. Network stubbing. Used by Slack Netflix Home Depot.' },
  { title: 'Prisma ORM', domain: 'Code', content: 'Prisma Node.js TypeScript ORM. Schema-first. Auto-generated client. Migrations. Prisma Studio. Used by 1M developers. Accel investors.' },
  { title: 'Drizzle ORM', domain: 'Code', content: 'Drizzle TypeScript SQL ORM. Schema-first zero-dependency. Drizzle Kit migrations. PostgreSQL MySQL SQLite. Lightweight alternative Prisma.' },
  { title: 'WebAssembly Wasm', domain: 'Code', content: 'WebAssembly Wasm portable binary format. Rust C++ Go compilation targets. WASI system interface. Component model. Used in Figma AutoCAD browser performance.' },

  // ============ AI TOOLS & ML PLATFORMS (40) ============
  { title: 'Claude Code CLI', domain: 'AI Tools', content: 'Claude Code Anthropic official CLI. Agentic coding assistant. Tool use file edits. Skills MCP servers. Plan mode. Subagents. Used by enterprise dev teams.' },
  { title: 'Cursor IDE', domain: 'AI Tools', content: 'Cursor AI-native code editor VS Code fork. Chat command composer. Claude GPT-4 models. Codebase indexing. 30K paying users. Agent mode. $400M raised.' },
  { title: 'Windsurf Editor', domain: 'AI Tools', content: 'Windsurf Codeium AI editor. Cascade agent. Supercomplete. Flow awareness. Free tier. Alternative to Cursor. OpenAI acquisition attempt 2025.' },
  { title: 'GitHub Copilot Workspace', domain: 'AI Tools', content: 'GitHub Copilot Workspace natural language to code. Plan implementation. Multi-file edits. Issue to PR workflow. GitHub Next preview program.' },
  { title: 'Replit Agent', domain: 'AI Tools', content: 'Replit Agent AI app builder. Natural language to full-stack. Database deployment integrated. Replit AI platform. Used for prototyping teaching. Amjad Masad CEO.' },
  { title: 'Anthropic Claude API', domain: 'AI Tools', content: 'Anthropic Claude API enterprise LLM. Claude Opus Sonnet Haiku 4.5. Tool use computer use. 1M context window. Message Batches API. Constitutional AI methodology.' },
  { title: 'OpenAI API', domain: 'AI Tools', content: 'OpenAI API GPT models. Assistants API function calling. DALL-E Whisper TTS. Realtime API WebSocket. Structured outputs JSON schema. Used by Stripe Klarna Salesforce.' },
  { title: 'Google Gemini API', domain: 'AI Tools', content: 'Google Gemini 1.5 2.0 API. 2M context. Multimodal vision video. Vertex AI integration. Function calling. Used by Snap Shopify Samsung.' },
  { title: 'Vertex AI Google', domain: 'AI Tools', content: 'Google Cloud Vertex AI ML platform. Model Garden 160 models. AutoML custom training. Agent Builder. Used by Wayfair Wendys Etsy. Gemini models.' },
  { title: 'AWS Bedrock', domain: 'AI Tools', content: 'Amazon Bedrock foundation models service. Claude Llama Mistral Titan. Agents Knowledge Bases. Guardrails. Used by Moody Genesys Intuit. Bedrock Studio.' },
  { title: 'Azure OpenAI Service', domain: 'AI Tools', content: 'Microsoft Azure OpenAI GPT-4 DALL-E. Enterprise data isolation. Regional deployments. Fine-tuning. Used by Carmax Mercedes KPMG Unilever Coca-Cola.' },
  { title: 'LangChain Framework AI', domain: 'AI Tools', content: 'LangChain LLM application framework Python JS. Chains agents tools memory. LangGraph stateful agents. LangSmith observability. Used by Ally Rakuten Lincoln.' },
  { title: 'LlamaIndex Framework', domain: 'AI Tools', content: 'LlamaIndex data framework LLM applications. Ingestion indexing querying. LlamaCloud enterprise. Workflows agents. Used for RAG production systems.' },
  { title: 'Hugging Face Hub AI', domain: 'AI Tools', content: 'Hugging Face Hub 1.5M models datasets. Transformers library Python. Inference API Endpoints. Spaces Gradio. Enterprise private hubs. Used by Google Meta Microsoft.' },
  { title: 'Pinecone Vector Database', domain: 'AI Tools', content: 'Pinecone managed vector DB. Serverless billion-scale. Metadata filtering. Hybrid sparse dense. Used by Notion Gong Clubhouse. Semantic search RAG.' },
  { title: 'Weaviate Vector DB', domain: 'AI Tools', content: 'Weaviate open source vector database. Multi-modal. GraphQL API. Modules generative search. Weaviate Cloud Services. Used by Stack Overflow Instacart.' },
  { title: 'Qdrant Vector DB', domain: 'AI Tools', content: 'Qdrant open source vector search engine Rust. Filtering quantization. Hybrid search. Cloud managed. Used by Deloitte Johnson Johnson Bayer.' },
  { title: 'Chroma Vector DB', domain: 'AI Tools', content: 'Chroma open source embedding database. Python JavaScript. In-memory persistent. LLM application focused. Simple developer experience. Used by LangChain LlamaIndex defaults.' },
  { title: 'Milvus Vector DB', domain: 'AI Tools', content: 'Milvus open source vector database Zilliz. Billion-scale. GPU acceleration. Multi-tenancy. LF AI Data Foundation graduated. Used by eBay IKEA Walmart.' },
  { title: 'pgvector PostgreSQL', domain: 'AI Tools', content: 'pgvector PostgreSQL extension vector similarity search. HNSW IVFFlat indexes. Cosine L2 inner product. Used in Supabase Neon Railway. Low infrastructure overhead.' },
  { title: 'Supabase Platform', domain: 'AI Tools', content: 'Supabase open source Firebase alternative. PostgreSQL realtime auth storage. Edge Functions. Vector pgvector AI. Used by Mozilla GitHub PwC. Free tier.' },
  { title: 'Ollama Local LLMs', domain: 'AI Tools', content: 'Ollama run LLMs locally. Llama Mistral Gemma Phi models. Model Library. API compatible OpenAI. macOS Windows Linux. 100K GitHub stars.' },
  { title: 'LM Studio', domain: 'AI Tools', content: 'LM Studio desktop LLM runner. GGUF models. Local inference server. Multi-model sessions. Used by developers prototyping offline AI. Free.' },
  { title: 'vLLM Inference', domain: 'AI Tools', content: 'vLLM high-throughput LLM inference engine. PagedAttention. Continuous batching. OpenAI compatible server. Used by enterprises self-hosting. Berkeley origin.' },
  { title: 'Together AI', domain: 'AI Tools', content: 'Together AI inference platform open source models. Llama Mixtral DeepSeek. Fine-tuning. GPU clusters. Used for cost-effective OpenAI alternative.' },
  { title: 'Groq LPU Inference', domain: 'AI Tools', content: 'Groq LPU language processing unit. 500 tokens/sec Llama. Ultra-low latency. Custom chip architecture. Used for real-time AI. Jonathan Ross ex-Google TPU.' },
  { title: 'Fireworks AI', domain: 'AI Tools', content: 'Fireworks AI inference fine-tuning. Open models proprietary FireLLaVA. Function calling JSON mode. Fast serving. Used by Upwork Notion Cursor.' },
  { title: 'Replicate Platform', domain: 'AI Tools', content: 'Replicate run ML models API. Cog container format. Public model library. Stable Diffusion Flux LLMs. Pay per second. Used by Figma Unsplash Character.' },
  { title: 'Perplexity AI', domain: 'AI Tools', content: 'Perplexity AI answer engine. Real-time web search citations. Pro search deep research. Spaces collections. API Sonar. Used as ChatGPT Google alternative.' },
  { title: 'Mistral AI Platform', domain: 'AI Tools', content: 'Mistral AI French open source LLMs. Mistral Large Mixtral. Codestral code. Le Chat assistant. La Plateforme API. Azure partnership. EU sovereignty.' },
  { title: 'Cohere Enterprise', domain: 'AI Tools', content: 'Cohere enterprise LLMs retrieval. Command R R+ models. Embed Rerank APIs. North data platform. Oracle Fujitsu partnerships. Aidan Gomez CEO.' },
  { title: 'LangSmith Observability', domain: 'AI Tools', content: 'LangSmith LLM observability LangChain. Traces prompts evaluations. Hub datasets. Debugging monitoring production LLM apps. Used by 1000s AI teams.' },
  { title: 'Weights Biases MLOps', domain: 'AI Tools', content: 'Weights Biases W&B experiment tracking. Sweeps hyperparameter. Reports Artifacts Registry. Models launch. Used by OpenAI NVIDIA Cohere Stability.' },
  { title: 'MLflow Open Source', domain: 'AI Tools', content: 'MLflow Databricks open source MLOps. Tracking projects models registry. Deployment serving. LLMOps integrations. Used by Accenture Meta ExxonMobil.' },
  { title: 'Haystack Framework', domain: 'AI Tools', content: 'Haystack deepset NLP framework production LLM. Pipelines components. RAG agents. REST API ready. Used by Airbus Netapp. Open source.' },
  { title: 'Instructor Library', domain: 'AI Tools', content: 'Instructor structured outputs LLMs Python. Pydantic integration. Function calling mode. JSON schema. Retries validation. Used in production for reliable LLM outputs.' },
  { title: 'DSPy Framework', domain: 'AI Tools', content: 'DSPy Stanford programming LLMs. Signatures modules optimizers. Prompt programming vs engineering. Metrics-driven. Used for research production.' },
  { title: 'CrewAI Agents', domain: 'AI Tools', content: 'CrewAI multi-agent framework Python. Role-based collaboration. Tasks crews tools. LangChain compatible. Used for autonomous agent workflows.' },
  { title: 'AutoGen Microsoft', domain: 'AI Tools', content: 'Microsoft AutoGen multi-agent conversation framework. Agent patterns. Code execution. Used for complex LLM workflows. Research paper origin.' },
  { title: 'ElevenLabs Voice AI', domain: 'AI Tools', content: 'ElevenLabs voice AI synthesis cloning. Multilingual 29 languages. Conversational API. Studio long-form. Used by publishers game developers. 1B valuation.' },
]

async function main() {
  console.log(`=== MEGA ENRICH v5: ${KNOWLEDGE.length} chunks (Consulting + IT Tools + Code + AI Tools) ===\n`)
  const domains = [...new Set(KNOWLEDGE.map(k => k.domain))]
  console.log(`Domains: ${domains.join(', ')}\n`)
  const t0 = Date.now()

  const BATCH = 10
  let indexed = 0
  let failed = 0

  for (let i = 0; i < KNOWLEDGE.length; i += BATCH) {
    const batch = KNOWLEDGE.slice(i, i + BATCH)
    const batchT0 = Date.now()
    const results = await Promise.all(batch.map(k => raptorIndex(k.content, k.title, k.domain)))
    const batchOk = results.filter(r => r !== null).length
    indexed += batchOk
    failed += (batch.length - batchOk)
    console.log(`Batch ${Math.floor(i/BATCH)+1}/${Math.ceil(KNOWLEDGE.length/BATCH)}: ${batchOk}/${batch.length} (${Date.now() - batchT0}ms)`)
  }

  console.log(`\n=== DONE ===`)
  console.log(`Indexed: ${indexed}/${KNOWLEDGE.length}`)
  console.log(`Failed: ${failed}`)
  console.log(`Duration: ${Date.now() - t0}ms`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
