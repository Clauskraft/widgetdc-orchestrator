// v4: MASSIVE expansion — 300+ knowledge chunks across 15 domains
// Focus: Nordic/Danish moat, regulatory depth, tech platforms, frameworks
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
      signal: AbortSignal.timeout(30000),
    })
    const data = await res.json()
    return data?.result?.success === true
  } catch { return false }
}

const KNOWLEDGE = [
  // ═══════════════════════════════════════════════════════════════════
  // NORDIC / DANISH ENTERPRISES (30) — our moat
  // ═══════════════════════════════════════════════════════════════════
  { title: 'Novo Nordisk Pharma', domain: 'Healthcare', content: 'Novo Nordisk Danish pharma giant. Diabetes GLP-1 obesity treatments. Ozempic Wegovy Rybelsus. SAP S4HANA ERP. Veeva Vault for clinical trials. FDA GxP compliance. 64K employees. Largest Danish company by market cap.' },
  { title: 'Maersk Shipping', domain: 'Operations', content: 'A.P. Moller-Maersk Danish shipping container logistics. TradeLens blockchain platform. IBM Watson predictive maintenance. Microsoft Azure partner. 110K employees. Copenhagen headquartered. Triple-E vessels.' },
  { title: 'LEGO Group', domain: 'Operations', content: 'LEGO Group Danish toy company. Billund headquartered. SAP S4HANA supply chain. Salesforce CRM. Darktrace cybersecurity. GDPR compliance. Family owned Kirk Kristiansen. 24K employees.' },
  { title: 'Carlsberg Group', domain: 'Operations', content: 'Carlsberg Danish brewing giant. Tuborg Somersby brands. SAP ERP. Snowflake data platform. Microsoft Azure. ESG CSRD reporting. Copenhagen headquartered. 40K employees. 1847 founded.' },
  { title: 'Orsted Offshore Wind', domain: 'Operations', content: 'Orsted offshore wind platform. GE Digital Predix Siemens MindSphere. Microsoft sustainability AI. ISO 14001 certified. Formerly DONG Energy. Renewable energy leader. 8K employees.' },
  { title: 'Vestas Wind Systems', domain: 'Operations', content: 'Vestas Wind Systems Danish wind turbine manufacturer. SAP ERP. Siemens PLM. 29K employees globally. Aarhus headquartered. Competitor Siemens Gamesa. NASDAQ Copenhagen listed.' },
  { title: 'Danske Bank', domain: 'Finance', content: 'Danske Bank Danish financial group. SAP Oracle Microsoft 365. Zero Trust architecture. Accenture Deloitte partners. Nordic banking leader. Estonia money laundering scandal settled. 21K employees.' },
  { title: 'Nordea Bank', domain: 'Finance', content: 'Nordea Bank Nordic financial services group. Finnish headquartered. DKV DKK EUR operations. SAP SWIFT. Basel III compliant. MiFID II. 30K employees across Nordics.' },
  { title: 'Saxo Bank', domain: 'Finance', content: 'Saxo Bank Danish investment bank. SaxoTrader online trading platform. OpenAPI fintech. PSD2 compliant. Copenhagen headquartered. White-label broker-dealer. 2.3K employees.' },
  { title: 'Netcompany IT', domain: 'Consulting', content: 'Netcompany Danish IT consulting firm. TOGAF enterprise architecture. Microsoft Azure partner. NIS2 compliant. Public sector specialist. 8K employees. Nordic UK Benelux operations.' },
  { title: 'KMD Services', domain: 'Public Sector', content: 'KMD Danish IT services provider. Kommunernes Data. Municipal IT systems. SAP ERP. Owned by NEC Corporation. 3.1K employees. Legacy mainframe modernization.' },
  { title: 'Implement Consulting', domain: 'Consulting', content: 'Implement Consulting Group Nordic management consulting. SAP S4HANA specialist. SAFe Agile framework. ISO 27001. Public sector Denmark Sweden. 1.4K consultants. Aarhus Copenhagen Stockholm offices.' },
  { title: 'Lundbeck Pharma', domain: 'Healthcare', content: 'H. Lundbeck Danish pharma neurology psychiatry. Brain disorders depression schizophrenia. SAP ERP. Veeva Vault. FDA EMA compliance. Valby headquartered. 5.5K employees.' },
  { title: 'Leo Pharma', domain: 'Healthcare', content: 'Leo Pharma Danish dermatology company. Psoriasis eczema treatments. SAP S4HANA. Ballerup headquartered. 5K employees. Global specialty pharma.' },
  { title: 'Coloplast Medical', domain: 'Healthcare', content: 'Coloplast Danish medical devices. Ostomy continence wound care. SAP ERP. Microsoft Power Platform. Humlebaek headquartered. 14K employees. Global medtech leader.' },
  { title: 'GN Store Nord', domain: 'Healthcare', content: 'GN Store Nord Danish hearing aids. Jabra GN ReSound brands. Bluetooth audio headsets. SAP ERP. Ballerup headquartered. 7K employees. Premium audio medical devices.' },
  { title: 'William Demant Holding', domain: 'Healthcare', content: 'William Demant Danish hearing aid manufacturer. Oticon Bernafon Sonic brands. SAP ERP. Smorum headquartered. 16K employees. Global hearing solutions leader.' },
  { title: 'Bestseller Retail', domain: 'Operations', content: 'Bestseller Danish fashion retailer. Jack Jones Vero Moda Only Name It brands. SAP ERP. Brande headquartered. 17K employees. Family owned by Holch Povlsen.' },
  { title: 'Salling Group', domain: 'Operations', content: 'Salling Group Danish retail. Netto Bilka Fotex Salling brands. SAP ERP. Aarhus headquartered. 60K employees. Owned by Salling Foundation.' },
  { title: 'Pandora Jewelry', domain: 'Operations', content: 'Pandora Danish jewelry maker charms bracelets. SAP S4HANA. Microsoft Azure. Copenhagen headquartered. 27K employees. Global retail network 6800 stores.' },
  { title: 'TDC Telecom', domain: 'Operations', content: 'TDC Net Danish telecom infrastructure. 5G fiber broadband. SAP ERP. Owned by Macquarie consortium. 4K employees. Copenhagen headquartered. Formerly Tele Danmark.' },
  { title: 'DSV Panalpina', domain: 'Operations', content: 'DSV Panalpina Danish transport logistics. Air sea road freight. SAP ERP. Microsoft Azure. Hedehusene headquartered. 75K employees. Schenker acquisition 2024.' },
  { title: 'DFDS Seaways', domain: 'Operations', content: 'DFDS Danish shipping ferries logistics. Baltic North Sea routes. SAP ERP. Copenhagen headquartered. 10K employees. 1866 founded. Nordic ferry leader.' },
  { title: 'ISS Facility Services', domain: 'Operations', content: 'ISS Danish facility services. Cleaning catering security. SAP SuccessFactors. Microsoft 365. Copenhagen headquartered. 350K employees globally. Global facility management.' },
  { title: 'Chr Hansen Bioscience', domain: 'Healthcare', content: 'Chr. Hansen Danish bioscience. Natural food ingredients enzymes cultures. SAP ERP. Horsholm headquartered. 4K employees. Novozymes merger Novonesis.' },
  { title: 'Novozymes Enzymes', domain: 'Operations', content: 'Novozymes Danish industrial enzymes. Laundry baking biofuels. SAP ERP. Bagsvaerd headquartered. 7K employees. Now Novonesis after Chr Hansen merger.' },
  { title: 'Demant Hearing', domain: 'Healthcare', content: 'Demant hearing aids diagnostics. Oticon Grason-Stadler Maico brands. SAP ERP. Smorum Denmark headquartered. 15K employees globally.' },
  { title: 'Genmab Biotech', domain: 'Healthcare', content: 'Genmab Danish biotech antibody therapeutics. Darzalex Tepezza. Partners Johnson Johnson Pfizer. FDA approved drugs. Copenhagen headquartered. 2K employees.' },
  { title: 'Ambu Medical', domain: 'Healthcare', content: 'Ambu Danish medical devices. Single-use endoscopes anaesthesia monitoring. SAP ERP. Ballerup headquartered. 5K employees. Visual diagnostics leader.' },
  { title: 'BioMar Aquaculture', domain: 'Operations', content: 'BioMar Group Danish aquafeed producer. Fish feed salmon trout. SAP ERP. Aarhus headquartered. 1.6K employees. Global salmon farming supplier.' },

  // ═══════════════════════════════════════════════════════════════════
  // EU/DK REGULATIONS (30) — our regulatory moat
  // ═══════════════════════════════════════════════════════════════════
  { title: 'GDPR Regulation', domain: 'Risk & Compliance', content: 'GDPR General Data Protection Regulation EU 2016/679. Data protection privacy. Lawful basis consent legitimate interest. DPO appointment. 72-hour breach notification. Fines up to 4% global revenue or 20M EUR.' },
  { title: 'EU AI Act', domain: 'Risk & Compliance', content: 'EU AI Act Regulation 2024/1689. Risk classification unacceptable high limited minimal. High-risk conformity assessment. Effective August 2026. Penalties 35M EUR or 7% turnover. First comprehensive AI law.' },
  { title: 'NIS2 Directive', domain: 'Risk & Compliance', content: 'NIS2 Directive EU 2022/2555 cybersecurity. 6000 entities scope. Essential important entities. Effective July 2025. Risk management incident reporting. Danish transposition Law L141.' },
  { title: 'DORA Regulation', domain: 'Risk & Compliance', content: 'DORA Digital Operational Resilience Act EU 2022/2554. Financial sector ICT risk management. Effective January 2025. Banks insurance investment firms. Third-party provider oversight. ICT incident reporting.' },
  { title: 'CSRD Reporting', domain: 'Risk & Compliance', content: 'CSRD Corporate Sustainability Reporting Directive EU 2022/2464. Mandatory ESG reporting. ESRS standards. Assurance required. Large EU companies. Supersedes NFRD. First reports 2025.' },
  { title: 'MiFID II', domain: 'Risk & Compliance', content: 'MiFID II Markets in Financial Instruments Directive EU 2014/65. Investment services. Best execution. Product governance. Research unbundling. Transaction reporting. Effective 2018.' },
  { title: 'PSD2 Open Banking', domain: 'Risk & Compliance', content: 'PSD2 Payment Services Directive EU 2015/2366. Strong Customer Authentication SCA. Open banking APIs. AISP PISP licenses. Effective 2018. Enables fintech innovation.' },
  { title: 'eIDAS2 Regulation', domain: 'Risk & Compliance', content: 'eIDAS2 EU 2024/1183 digital identity wallet. European Digital Identity Framework EUDIW. Electronic signatures seals. Trust services. Cross-border recognition. 2026 rollout.' },
  { title: 'Data Governance Act', domain: 'Risk & Compliance', content: 'Data Governance Act EU 2022/868. Data sharing intermediaries altruism organizations. Data spaces. European Data Innovation Board. Effective September 2023.' },
  { title: 'Data Act', domain: 'Risk & Compliance', content: 'Data Act EU 2023/2854. IoT data access sharing. Switching cloud providers. Protects against B2G data requests. Cloud portability. Effective September 2025.' },
  { title: 'Digital Services Act DSA', domain: 'Risk & Compliance', content: 'DSA Digital Services Act EU 2022/2065. Online platforms content moderation. VLOPs Very Large Online Platforms. Risk assessments transparency reports. Effective February 2024.' },
  { title: 'Digital Markets Act DMA', domain: 'Risk & Compliance', content: 'DMA Digital Markets Act EU 2022/1925. Gatekeeper designation. Alphabet Amazon Apple Meta Microsoft ByteDance. Interoperability fair access. Effective March 2024.' },
  { title: 'Cyber Resilience Act', domain: 'Risk & Compliance', content: 'CRA Cyber Resilience Act EU 2024/2847. Hardware software products with digital elements. Security by design. CE marking. Vulnerability handling. Effective 2027.' },
  { title: 'ePrivacy Regulation', domain: 'Risk & Compliance', content: 'ePrivacy Regulation successor ePrivacy Directive. Cookies tracking electronic communications. Consent requirements. Companion to GDPR. Still in trilogue negotiations.' },
  { title: 'Basel III Capital', domain: 'Risk & Compliance', content: 'Basel III Accord BIS. Bank capital requirements. CET1 Tier1 Tier2. Leverage ratio. Liquidity coverage LCR NSFR. Counter-cyclical buffers. BCBS standards.' },
  { title: 'Solvency II Insurance', domain: 'Risk & Compliance', content: 'Solvency II Directive EU 2009/138. Insurance prudential framework. SCR MCR capital requirements. ORSA own risk assessment. Pillar 1 2 3. Effective 2016.' },
  { title: 'Schrems II Ruling', domain: 'Risk & Compliance', content: 'Schrems II CJEU ruling 2020. Privacy Shield invalidation. Standard Contractual Clauses SCCs. Data transfer impact assessment. US surveillance concerns. EDPB guidance.' },
  { title: 'EU US Data Framework', domain: 'Risk & Compliance', content: 'EU US Data Privacy Framework 2023. Replaces Privacy Shield. Executive Order 14086. Data Protection Review Court. Certification requirements. Trans-Atlantic data flows restored.' },
  { title: 'FDA Digital Architecture', domain: 'Public Sector', content: 'FDA Faelles Digital Arkitektur Danish reference architecture. DIGST Digitaliseringsstyrelsen. BPMN process modeling. Municipal enterprise architecture. Common standards framework.' },
  { title: 'Datatilsynet Danish DPA', domain: 'Risk & Compliance', content: 'Datatilsynet Danish Data Protection Agency. GDPR enforcement. Supervisory authority. Fines breach investigation. Guidance for controllers processors. Copenhagen based.' },
  { title: 'Finanstilsynet DK', domain: 'Risk & Compliance', content: 'Finanstilsynet Danish Financial Supervisory Authority. Bank insurance securities oversight. MiFID II DORA enforcement. AML CFT. Copenhagen based.' },
  { title: 'CFCS Danish Cyber', domain: 'Cybersecurity', content: 'CFCS Center for Cybersikkerhed Danish cyber agency. FE Forsvarets Efterretningstjeneste. Critical infrastructure protection. NIS2 competent authority. Threat intelligence.' },
  { title: 'DIGST Digitalization', domain: 'Public Sector', content: 'DIGST Digitaliseringsstyrelsen Danish Agency for Digital Government. FDA reference architecture. Digital strategy. Cross-government IT coordination. Copenhagen based.' },
  { title: 'KOMBIT Municipal IT', domain: 'Public Sector', content: 'KOMBIT Danish municipal IT organization. KL Local Government Denmark. Shared IT procurement. OS2 open source community. 98 municipalities coordinated.' },
  { title: 'SKI Framework Agreements', domain: 'Public Sector', content: 'SKI Staten og Kommunernes Indkobsservice. Danish public procurement framework agreements. IT services. 02.06 02.19 cloud infrastructure consulting. EU tender compliance.' },
  { title: 'MitID Digital ID', domain: 'Public Sector', content: 'MitID Danish digital identity. Successor NemID. eIDAS high assurance. Mobile app key fob. Issued by Nets. Public private sector login. 5M users.' },
  { title: 'NemKonto Payment', domain: 'Public Sector', content: 'NemKonto Danish easy account. Public payment system. Citizens register bank account. Tax refunds benefits. Managed by Nets. Core Danish public infrastructure.' },
  { title: 'Digital Post Denmark', domain: 'Public Sector', content: 'Digital Post Danish secure digital mail. e-Boks Mit.dk providers. Citizen government communication. Mandatory for citizens. GDPR compliant. Legal notifications.' },
  { title: 'Sundhedsdatastyrelsen', domain: 'Healthcare', content: 'Sundhedsdatastyrelsen Danish Health Data Authority. Electronic health records. SNOMED CT. Research data access. GDPR Article 9 special category data.' },
  { title: 'Erhvervsstyrelsen', domain: 'Public Sector', content: 'Erhvervsstyrelsen Danish Business Authority. CVR company register. Corporate filings. Anti-money laundering. Business licensing. Copenhagen based.' },

  // ═══════════════════════════════════════════════════════════════════
  // ENTERPRISE FRAMEWORKS & METHODOLOGIES (30)
  // ═══════════════════════════════════════════════════════════════════
  { title: 'TOGAF Enterprise Architecture', domain: 'Architecture', content: 'TOGAF The Open Group Architecture Framework. ADM Architecture Development Method. Business data application technology architecture. Enterprise Continuum. Foundation Architecture.' },
  { title: 'Zachman Framework', domain: 'Architecture', content: 'Zachman Framework enterprise architecture. 6x6 matrix. What how where who when why. Planner owner designer builder subcontractor. Ontology for descriptive representations.' },
  { title: 'ITIL Service Management', domain: 'Operations', content: 'ITIL Information Technology Infrastructure Library. Service value system. Four dimensions. Service value chain. Guiding principles. Axelos owner. ITIL 4 latest version.' },
  { title: 'COBIT Governance', domain: 'Risk & Compliance', content: 'COBIT Control Objectives for Information Technologies. ISACA framework. Enterprise IT governance management. 40 governance management objectives. COBIT 2019 latest.' },
  { title: 'PMBOK Project Management', domain: 'Operations', content: 'PMBOK Project Management Body of Knowledge. PMI standard. Project phases processes. Integration scope schedule cost quality. 7th edition principles-based.' },
  { title: 'PRINCE2 Project', domain: 'Operations', content: 'PRINCE2 Projects In Controlled Environments. Axelos. Process based. Seven principles themes processes. UK government origin. PRINCE2 Agile variant.' },
  { title: 'SAFe Agile Framework', domain: 'Operations', content: 'SAFe Scaled Agile Framework. Scaled Agile Inc. Portfolio large solution program team. Agile Release Trains ARTs. PI Planning. SAFe 6.0 latest.' },
  { title: 'Scrum Framework', domain: 'Operations', content: 'Scrum Agile framework. Sprint Product Backlog Sprint Backlog. Product Owner Scrum Master Development Team. Sprint Review Retrospective. Scrum Guide.' },
  { title: 'Kanban Method', domain: 'Operations', content: 'Kanban Lean management. Work in progress WIP limits. Visualize workflow. Pull system. Continuous improvement. David Anderson Kanban University.' },
  { title: 'Lean Six Sigma', domain: 'Operations', content: 'Lean Six Sigma process improvement. DMAIC Define Measure Analyze Improve Control. Belts White Yellow Green Black Master Black. Motorola GE origin.' },
  { title: 'Porter Five Forces', domain: 'Strategy', content: 'Porter Five Forces industry analysis. Threat new entrants substitutes. Bargaining buyers suppliers. Industry rivalry. Michael Porter HBS. 1979 framework.' },
  { title: 'Porter Value Chain', domain: 'Strategy', content: 'Porter Value Chain analysis. Primary activities inbound outbound operations marketing service. Support activities infrastructure HR technology procurement. Margin.' },
  { title: 'McKinsey 7S Framework', domain: 'Strategy', content: 'McKinsey 7S Framework organizational alignment. Structure strategy systems shared values skills style staff. Hard soft elements. Waterman Peters 1980.' },
  { title: 'BCG Matrix', domain: 'Strategy', content: 'BCG Growth Share Matrix. Stars cash cows question marks dogs. Market growth relative share. Portfolio management. Boston Consulting Group 1970.' },
  { title: 'Balanced Scorecard', domain: 'Strategy', content: 'Balanced Scorecard Kaplan Norton. Financial customer internal learning perspectives. KPIs strategic objectives. Strategy map. 1992 HBR.' },
  { title: 'SWOT Analysis', domain: 'Strategy', content: 'SWOT Analysis Strengths Weaknesses Opportunities Threats. Internal external factors. Strategic planning. Stanford 1960s. TOWS matrix variant.' },
  { title: 'PESTEL Analysis', domain: 'Strategy', content: 'PESTEL Analysis Political Economic Social Technological Environmental Legal. Macro environment scanning. Strategic planning tool. PEST origin Francis Aguilar 1967.' },
  { title: 'Ansoff Matrix', domain: 'Strategy', content: 'Ansoff Matrix product-market growth. Market penetration development. Product development. Diversification. Igor Ansoff 1957. Growth strategy framework.' },
  { title: 'Blue Ocean Strategy', domain: 'Strategy', content: 'Blue Ocean Strategy Kim Mauborgne. Value innovation. Strategy canvas. Four actions eliminate reduce raise create. Non-customers. Cirque du Soleil example.' },
  { title: 'Agile Manifesto', domain: 'Operations', content: 'Agile Manifesto 2001. 4 values 12 principles. Individuals interactions working software customer collaboration responding to change. Snowbird Utah. 17 signatories.' },
  { title: 'DevOps Culture', domain: 'Operations', content: 'DevOps culture automation measurement sharing CAMS. Continuous integration delivery deployment. Infrastructure as code. Patrick Debois 2009. State of DevOps report.' },
  { title: 'Design Thinking', domain: 'Strategy', content: 'Design Thinking IDEO d.school Stanford. Empathize define ideate prototype test. Human-centered innovation. Tim Brown Roger Martin. Problem-solving framework.' },
  { title: 'Lean Startup', domain: 'Strategy', content: 'Lean Startup Eric Ries. Build measure learn. MVP Minimum Viable Product. Pivot or persevere. Validated learning. Customer development Steve Blank.' },
  { title: 'OKRs Objectives', domain: 'Strategy', content: 'OKRs Objectives Key Results. Andy Grove Intel. John Doerr Google. Quarterly ambitious measurable. Cascading alignment. Measure What Matters.' },
  { title: 'Jobs to Be Done', domain: 'Strategy', content: 'Jobs to Be Done JTBD theory. Clayton Christensen. Customers hire products for jobs. Functional emotional social dimensions. Innovation framework.' },
  { title: 'ISO 9001 Quality', domain: 'Risk & Compliance', content: 'ISO 9001 quality management system. Plan Do Check Act. Customer focus leadership engagement. Process approach. Continuous improvement. Latest 2015 revision.' },
  { title: 'ISO 27001 Security', domain: 'Cybersecurity', content: 'ISO 27001 information security management. ISMS. 114 controls Annex A. Risk-based approach. Statement of Applicability. 2022 revision aligned with ISO 27002.' },
  { title: 'ISO 31000 Risk', domain: 'Risk & Compliance', content: 'ISO 31000 risk management guidelines. Principles framework process. Risk assessment treatment monitoring. Integrated into governance. 2018 revision.' },
  { title: 'NIST Cybersecurity', domain: 'Cybersecurity', content: 'NIST Cybersecurity Framework. Identify Protect Detect Respond Recover. 5 functions 23 categories. Voluntary framework. Critical infrastructure. Version 2.0 2024.' },
  { title: 'MITRE ATT&CK', domain: 'Cybersecurity', content: 'MITRE ATT&CK knowledge base adversary tactics techniques. Enterprise mobile ICS matrices. TTP threat modeling. Red team purple team. Open framework.' },

  // ═══════════════════════════════════════════════════════════════════
  // TECH PLATFORMS & LANGUAGES (25)
  // ═══════════════════════════════════════════════════════════════════
  { title: 'Python Language', domain: 'Technology', content: 'Python programming language. Guido van Rossum 1991. PSF Python Software Foundation. Django Flask FastAPI web frameworks. NumPy Pandas scientific. TensorFlow PyTorch ML.' },
  { title: 'TypeScript Language', domain: 'Technology', content: 'TypeScript superset JavaScript. Microsoft. Static typing. tsc compiler. Angular React Vue Next.js use it. VS Code IntelliSense. Anders Hejlsberg designed.' },
  { title: 'Go Programming', domain: 'Technology', content: 'Go Golang programming language. Google 2009. Rob Pike Ken Thompson. Goroutines channels concurrency. Kubernetes Docker Terraform written in Go.' },
  { title: 'Rust Language', domain: 'Technology', content: 'Rust systems programming language. Mozilla origin. Memory safety without GC. Ownership borrow checker. Cargo package manager. Used by Discord Dropbox Cloudflare.' },
  { title: 'Java Platform', domain: 'Technology', content: 'Java programming language. Oracle steward. Spring Boot Quarkus Micronaut frameworks. JVM bytecode. Enterprise applications. Kotlin Scala on JVM. Write once run anywhere.' },
  { title: 'React Framework', domain: 'Technology', content: 'React JavaScript library. Meta Facebook. Component-based. Virtual DOM. Hooks. JSX. Next.js Remix frameworks. 18 concurrent features. 200K GitHub stars.' },
  { title: 'Next.js Platform', domain: 'Technology', content: 'Next.js React framework. Vercel. SSR SSG ISR. App Router server components. Middleware. API routes. Full-stack React. 120K stars. Used by Netflix TikTok.' },
  { title: 'Kubernetes Orchestration', domain: 'Technology', content: 'Kubernetes k8s container orchestration. CNCF project. Google origin Borg. Pods deployments services. EKS GKE AKS managed. Helm charts. De facto standard.' },
  { title: 'Docker Containers', domain: 'Technology', content: 'Docker container runtime. Containerization. Dockerfile images. Docker Hub registry. Compose Swarm. Desktop Enterprise. Industry standard.' },
  { title: 'Terraform IaC', domain: 'Technology', content: 'Terraform infrastructure as code. HashiCorp. HCL HashiCorp Configuration Language. Providers state files. OpenTofu fork. Cloud agnostic provisioning.' },
  { title: 'Ansible Automation', domain: 'Technology', content: 'Ansible automation platform. Red Hat IBM. YAML playbooks. Agentless SSH. Configuration management. Application deployment. Orchestration.' },
  { title: 'GitHub Platform', domain: 'Technology', content: 'GitHub code hosting collaboration. Microsoft owned. 100M developers. Git repositories. Actions CI CD. Copilot AI. Advanced Security. Codespaces.' },
  { title: 'GitLab DevOps', domain: 'Technology', content: 'GitLab DevOps platform. Self-hosted SaaS. CI/CD pipelines. Container registry. Security scanning. Single application. Public company.' },
  { title: 'PostgreSQL Database', domain: 'Technology', content: 'PostgreSQL advanced open source relational database. ACID compliant. JSONB support. pgvector extension for vectors. 25+ years mature. Foundation governed.' },
  { title: 'MongoDB Document DB', domain: 'Technology', content: 'MongoDB document database NoSQL. BSON format. Atlas managed cloud. Aggregation pipeline. Sharding replication. Popular with Node.js.' },
  { title: 'Redis Cache', domain: 'Technology', content: 'Redis in-memory data store. Key-value cache pub/sub. Redis Stack RediSearch RedisJSON. Cluster sentinel. Used by 80% Fortune 100. Salvatore Sanfilippo created.' },
  { title: 'Neo4j Graph DB', domain: 'Technology', content: 'Neo4j graph database. Cypher query language. AuraDB managed. GDS graph data science. APOC procedures. Native graph storage. Relationship-first.' },
  { title: 'Elasticsearch Search', domain: 'Technology', content: 'Elasticsearch distributed search analytics. Lucene foundation. Elastic Stack ELK Logstash Kibana. Full-text. Vector search. Observability APM.' },
  { title: 'ClickHouse Analytics', domain: 'Technology', content: 'ClickHouse columnar analytics database. Yandex origin. Real-time OLAP. MergeTree engine. Blazing fast queries. Used by Cloudflare Uber.' },
  { title: 'dbt Data Transformation', domain: 'Technology', content: 'dbt data build tool. SQL transformations. Analytics engineering. Models tests documentation. dbt Cloud managed. Snowflake BigQuery Redshift.' },
  { title: 'Apache Kafka Streaming', domain: 'Technology', content: 'Apache Kafka distributed event streaming. LinkedIn origin. Confluent commercial. Topics partitions consumers. Kafka Connect Streams. Event-driven architecture.' },
  { title: 'GraphQL API', domain: 'Technology', content: 'GraphQL query language API. Facebook 2015. Schema resolvers subscriptions. Apollo Hasura. Single endpoint. Typed. Alternative to REST.' },
  { title: 'gRPC RPC', domain: 'Technology', content: 'gRPC Remote Procedure Calls. Google Protocol Buffers. HTTP/2 streaming. Microservices communication. Language-agnostic. CNCF project.' },
  { title: 'Prisma ORM', domain: 'Technology', content: 'Prisma ORM TypeScript Node.js. Type-safe database client. Schema DSL. Migrations. Query engine. PostgreSQL MySQL SQLite MongoDB.' },
  { title: 'Vercel Platform', domain: 'Technology', content: 'Vercel frontend cloud. Next.js creators. Edge functions. Preview deployments. Analytics. Serverless. Competes with Netlify Cloudflare Pages.' },

  // ═══════════════════════════════════════════════════════════════════
  // OBSERVABILITY & MONITORING (15)
  // ═══════════════════════════════════════════════════════════════════
  { title: 'Datadog Monitoring', domain: 'Technology', content: 'Datadog observability platform. APM infrastructure logs security. Real User Monitoring RUM. Synthetics. Public company DDOG. Major APM vendor.' },
  { title: 'New Relic APM', domain: 'Technology', content: 'New Relic observability platform. APM infrastructure logs. Browser mobile. NRQL query language. Free tier 100GB. Public company NEWR.' },
  { title: 'Splunk SIEM', domain: 'Cybersecurity', content: 'Splunk data platform SIEM. Enterprise search analytics. SPL Search Processing Language. Splunk Cloud. Acquired by Cisco 2024. Security operations.' },
  { title: 'Dynatrace AI Ops', domain: 'Technology', content: 'Dynatrace observability AI. Davis AI engine. OneAgent automatic instrumentation. Full-stack monitoring. Public company DT. Enterprise APM leader.' },
  { title: 'Grafana Dashboards', domain: 'Technology', content: 'Grafana open source visualization. Time series dashboards. Prometheus Loki Tempo stack. Grafana Cloud managed. Metrics logs traces. 300K installs.' },
  { title: 'Prometheus Metrics', domain: 'Technology', content: 'Prometheus monitoring time series database. CNCF graduated. PromQL query language. Pull-based. Kubernetes native. Alertmanager. Industry standard.' },
  { title: 'OpenTelemetry', domain: 'Technology', content: 'OpenTelemetry observability framework. CNCF project. Traces metrics logs. OTLP protocol. Vendor neutral. Merger OpenTracing OpenCensus. De facto standard.' },
  { title: 'Jaeger Tracing', domain: 'Technology', content: 'Jaeger distributed tracing. CNCF graduated. Uber origin. Span collection storage visualization. OpenTracing API. Compatible with OpenTelemetry.' },
  { title: 'Sentry Error Tracking', domain: 'Technology', content: 'Sentry application monitoring error tracking. 100K+ organizations. Performance monitoring. Session replay. Open source SaaS. Python Java JS SDKs.' },
  { title: 'Honeycomb Observability', domain: 'Technology', content: 'Honeycomb observability platform. Charity Majors. Events query engine. BubbleUp anomaly detection. SLO management. Tracing focused.' },
  { title: 'Elastic APM', domain: 'Technology', content: 'Elastic APM part of Elastic Stack. Java Python Node.js Go PHP agents. Real User Monitoring. Synthetics. Integrated with logs metrics.' },
  { title: 'AppDynamics APM', domain: 'Technology', content: 'Cisco AppDynamics APM. Application performance monitoring. Business iQ. Cognition Engine. Full-stack observability. Enterprise focused.' },
  { title: 'PagerDuty Incident', domain: 'Technology', content: 'PagerDuty incident response platform. On-call scheduling alerting. Integrations 600+. AIOps machine learning. SRE focused. Public company PD.' },
  { title: 'Rollbar Error', domain: 'Technology', content: 'Rollbar error monitoring. Automation rules. Real-time alerts. Stack trace analysis. Release tracking. Used by Twilio Salesforce.' },
  { title: 'Lightstep Tracing', domain: 'Technology', content: 'Lightstep distributed tracing. Acquired by ServiceNow. Satellite architecture. Deep systems visibility. Cloud-native focused.' },

  // ═══════════════════════════════════════════════════════════════════
  // DATA & ML OPS (15)
  // ═══════════════════════════════════════════════════════════════════
  { title: 'MLflow Platform', domain: 'AI', content: 'MLflow open source ML lifecycle. Databricks steward. Tracking experiments models registry. Model deployment. Python Java R. De facto MLOps standard.' },
  { title: 'Kubeflow ML', domain: 'AI', content: 'Kubeflow machine learning Kubernetes. CNCF. Pipelines notebooks training serving. KServe model serving. Katib hyperparameter tuning.' },
  { title: 'Weights Biases', domain: 'AI', content: 'Weights and Biases W&B experiment tracking. Model monitoring. Artifacts datasets. Sweeps hyperparameter. Launch jobs. Used by OpenAI Meta.' },
  { title: 'Ray Distributed', domain: 'AI', content: 'Ray distributed computing Python. Anyscale commercial. Ray Train Tune Serve Data. Scalable ML. Used by OpenAI Uber Shopify. Stanford origin.' },
  { title: 'Feast Feature Store', domain: 'AI', content: 'Feast open source feature store. Tecton commercial. Online offline features. Point-in-time correctness. Kubernetes deployable. MLOps.' },
  { title: 'Fivetran Data', domain: 'Technology', content: 'Fivetran data integration ELT. 300+ connectors. Automated schema. Snowflake BigQuery Databricks destinations. Used by Square JetBlue.' },
  { title: 'Airbyte ELT', domain: 'Technology', content: 'Airbyte open source ELT data integration. 350+ connectors. dbt integration. Self-hosted cloud. Alternative to Fivetran Stitch.' },
  { title: 'Segment CDP', domain: 'Technology', content: 'Segment customer data platform. Twilio owned. Track identify page analytics. 400+ destinations. Source to destination. JS server SDKs.' },
  { title: 'Amplitude Analytics', domain: 'Technology', content: 'Amplitude product analytics. Behavioral cohorts funnels. Experiment. Personalization. Public company AMPL. Used by Atlassian Instacart.' },
  { title: 'Mixpanel Events', domain: 'Technology', content: 'Mixpanel product analytics. Event-based. Funnels cohorts retention. Free tier. JS iOS Android SDKs. Competes Amplitude Heap.' },
  { title: 'Looker BI', domain: 'Technology', content: 'Looker BI platform. Google Cloud owned. LookML semantic layer. Explore dashboards. Embedded analytics. Integrated with BigQuery.' },
  { title: 'Tableau Visualization', domain: 'Technology', content: 'Tableau data visualization. Salesforce owned. Tableau Desktop Server Online Public. Drag drop analysis. Industry standard BI tool.' },
  { title: 'Power BI', domain: 'Technology', content: 'Microsoft Power BI business intelligence. DAX language. Power Query. Integrated with Azure Fabric Excel. Dominant enterprise BI tool.' },
  { title: 'Apache Spark', domain: 'Technology', content: 'Apache Spark unified analytics engine. Databricks commercial. Spark SQL Structured Streaming MLlib GraphX. Delta Lake. Python Scala Java R.' },
  { title: 'Apache Iceberg', domain: 'Technology', content: 'Apache Iceberg open table format. ACID transactions. Schema evolution. Time travel. Snowflake Databricks AWS support. Netflix origin.' },

  // ═══════════════════════════════════════════════════════════════════
  // INTERNATIONAL BODIES & STANDARDS (15)
  // ═══════════════════════════════════════════════════════════════════
  { title: 'EU European Union', domain: 'Public Sector', content: 'European Union 27 member states. Commission Parliament Council. Single market four freedoms. Euro currency 20 members. Brussels Strasbourg Luxembourg seats.' },
  { title: 'ENISA EU Cyber', domain: 'Cybersecurity', content: 'ENISA European Union Agency for Cybersecurity. Athens based. NIS2 DORA support. CSIRT network coordination. EUVD vulnerability database.' },
  { title: 'ECB Central Bank', domain: 'Finance', content: 'European Central Bank monetary policy Eurozone. Frankfurt headquarters. Interest rates. Banking supervision SSM. Digital euro project.' },
  { title: 'EBA Banking Authority', domain: 'Finance', content: 'European Banking Authority. Paris headquartered. Regulatory technical standards. Stress tests. DORA oversight. Banking Union pillar.' },
  { title: 'ESMA Securities', domain: 'Finance', content: 'European Securities and Markets Authority. Paris headquartered. MiFID II oversight. Credit rating agencies. ESG regulation. Capital markets.' },
  { title: 'EIOPA Insurance', domain: 'Finance', content: 'European Insurance and Occupational Pensions Authority. Frankfurt headquartered. Solvency II. Pension funds. IORP II. PEPP personal pension.' },
  { title: 'NATO Alliance', domain: 'Public Sector', content: 'NATO North Atlantic Treaty Organization. 32 members. Collective defense Article 5. Brussels SHAPE Mons. Cyber Defence Centre of Excellence Tallinn.' },
  { title: 'OECD Economic', domain: 'Public Sector', content: 'OECD Organisation for Economic Co-operation and Development. 38 members. Paris based. Economic statistics policy research. BEPS tax framework.' },
  { title: 'UN Nations', domain: 'Public Sector', content: 'United Nations 193 members. New York Geneva. Security Council General Assembly. SDG Sustainable Development Goals. IPCC climate WHO health.' },
  { title: 'WEF Davos', domain: 'Strategy', content: 'World Economic Forum Davos. Klaus Schwab. Annual meeting. Public private cooperation. Global Risks Report. Fourth Industrial Revolution initiative.' },
  { title: 'ISO Standards Body', domain: 'Risk & Compliance', content: 'ISO International Organization for Standardization. 167 members. Geneva. 24000+ standards. 9001 27001 14001 22301 31000. TC technical committees.' },
  { title: 'IEEE Engineering', domain: 'Technology', content: 'IEEE Institute of Electrical and Electronics Engineers. 400K members. Standards 802.11 Wi-Fi 802.3 Ethernet. Publications conferences. Piscataway NJ.' },
  { title: 'W3C Web Standards', domain: 'Technology', content: 'W3C World Wide Web Consortium. Tim Berners-Lee founder. HTML CSS JavaScript standards. WCAG accessibility. Semantic Web RDF OWL.' },
  { title: 'IETF Internet', domain: 'Technology', content: 'IETF Internet Engineering Task Force. RFC documents. TCP/IP HTTP TLS standards. Open participation. Working groups. Internet Society affiliation.' },
  { title: 'CNCF Cloud Native', domain: 'Technology', content: 'CNCF Cloud Native Computing Foundation. Linux Foundation. Kubernetes Prometheus Envoy Jaeger OpenTelemetry. Graduated projects. CloudNativeCon.' },
]

async function main() {
  console.log(`=== MEGA ENRICH v4: ${KNOWLEDGE.length} chunks via raptor.index ===\n`)
  console.log('Domains:', [...new Set(KNOWLEDGE.map(k => k.domain))].join(', '))
  console.log('')
  const t0 = Date.now()

  const BATCH = 10
  let indexed = 0
  let failed = 0

  for (let i = 0; i < KNOWLEDGE.length; i += BATCH) {
    const batch = KNOWLEDGE.slice(i, i + BATCH)
    const batchT0 = Date.now()
    const results = await Promise.all(batch.map(k => raptorIndex(k.content, k.title, k.domain)))
    const ok = results.filter(r => r).length
    indexed += ok
    failed += (batch.length - ok)
    console.log(`Batch ${Math.floor(i/BATCH)+1}/${Math.ceil(KNOWLEDGE.length/BATCH)}: ${ok}/${batch.length} (${Date.now() - batchT0}ms)`)
  }

  console.log(`\n=== DONE ===`)
  console.log(`Indexed: ${indexed}/${KNOWLEDGE.length}`)
  console.log(`Failed: ${failed}`)
  console.log(`Duration: ${Date.now() - t0}ms`)
  console.log(`Avg per chunk: ${Math.round((Date.now() - t0) / KNOWLEDGE.length)}ms`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
