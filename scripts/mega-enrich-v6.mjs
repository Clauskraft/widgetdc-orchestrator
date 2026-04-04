// v6: MASSIVE expansion — Consulting → IT → Code → AI tools stack (deep granular coverage)
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
    return data?.result?.success === true ? data.result.data : null
  } catch { return null }
}

const KNOWLEDGE = [
  // ============ CONSULTING DEEP — 80 chunks ============
  // Strategy firms niche
  { title: 'Strategy&', domain: 'Consulting', content: 'Strategy& PwC strategy consulting. Booz Allen Hamilton commercial arm origin. Fit for Growth methodology. Digital Auto DNA. Used by automotive manufacturers. Integrated with PwC network.' },
  { title: 'Monitor Deloitte', domain: 'Consulting', content: 'Monitor Deloitte strategy practice Michael Porter origin. Five forces competitive strategy. Doblin innovation. Strategic Choice Cascade. Used by CPG technology clients.' },
  { title: 'Parthenon EY', domain: 'Consulting', content: 'EY Parthenon strategy consulting. Education healthcare PE advisory. Commercial due diligence. Growth strategy. Acquired by EY 2014. Boston origin.' },
  { title: 'North Highland', domain: 'Consulting', content: 'North Highland management consulting. Employee-owned. Customer experience transformation. Change management expertise. Atlanta headquartered. US mid-market focus.' },
  { title: 'ZS Associates', domain: 'Consulting', content: 'ZS Associates life sciences consulting. Commercial strategy sales marketing. AI analytics platforms. Used by top 20 pharma. 12K employees global.' },
  { title: 'IQVIA Consulting', domain: 'Consulting', content: 'IQVIA consulting healthcare life sciences. Real-world evidence. Clinical commercial analytics. Connected intelligence. Used by pharma biotech. NYSE IQV.' },
  { title: 'FTI Consulting', domain: 'Consulting', content: 'FTI Consulting business advisory. Corporate finance restructuring. Forensic litigation. Economic consulting. Technology strategic communications. NYSE FCN.' },
  { title: 'Alvarez Marsal', domain: 'Consulting', content: 'Alvarez Marsal turnaround restructuring. Performance improvement. Interim management. Tax advisory. Used by distressed companies PE firms. Bryan Marsal Tony Alvarez.' },
  { title: 'AlixPartners', domain: 'Consulting', content: 'AlixPartners turnaround advisory. Urgent performance improvement. Investigations disputes. Jay Alix founder. Detroit origin automotive. Private equity portfolio work.' },
  { title: 'Simon-Kucher', domain: 'Consulting', content: 'Simon-Kucher Partners pricing growth strategy. Global leader in pricing consulting. Monetization revenue models. German origin Bonn. Used by 26 industries.' },
  // Workshop methods
  { title: 'Design Sprint Google', domain: 'Consulting', content: 'Design Sprint 5-day methodology Google Ventures. Map sketch decide prototype test. Jake Knapp book. Used for product innovation. Rapid validation.' },
  { title: 'Design Thinking Stanford', domain: 'Consulting', content: 'Design Thinking Stanford d.school IDEO. Empathize define ideate prototype test. Human-centered design. Used in innovation workshops. Tim Brown.' },
  { title: 'IDEO Innovation', domain: 'Consulting', content: 'IDEO design innovation consultancy. Human-centered design thinking. Apple mouse Palm V. Global offices. David Kelley founder. Used for product strategy.' },
  { title: 'Lean Startup', domain: 'Consulting', content: 'Lean Startup Eric Ries. Build measure learn MVP. Pivot persevere. Innovation accounting. Used by corporates startups. Validation-driven development.' },
  { title: 'OKRs Goal Setting', domain: 'Consulting', content: 'OKRs Objectives Key Results. Andy Grove Intel origin. John Doerr book. Measure What Matters. Used by Google LinkedIn Twitter. Quarterly cycles.' },
  { title: 'Jobs to Be Done', domain: 'Consulting', content: 'Jobs To Be Done JTBD theory. Clayton Christensen Harvard. Customer jobs pains gains. Milkshake example. Used for innovation product strategy.' },
  { title: 'Blue Ocean Strategy', domain: 'Consulting', content: 'Blue Ocean Strategy Kim Mauborgne INSEAD. Uncontested market space. Value innovation. Strategy canvas ERRC framework. Cirque du Soleil Nintendo Wii examples.' },
  { title: 'Disruptive Innovation', domain: 'Consulting', content: 'Disruptive Innovation Clayton Christensen. Innovators Dilemma. Low-end disruption new market. Sustaining innovation. Used to explain Netflix Tesla Uber.' },
  { title: 'Platform Strategy MIT', domain: 'Consulting', content: 'Platform Strategy MIT Sloan. Parker Van Alstyne Choudary book. Network effects multi-sided markets. Used to analyze Uber Airbnb Amazon. Envelopment strategies.' },
  { title: 'Wardley Mapping', domain: 'Consulting', content: 'Wardley Mapping Simon Wardley. Value chain evolution genesis custom product commodity. Climatic patterns. Used for strategic situational awareness.' },
  // Consulting ops
  { title: 'Engagement Manager Role', domain: 'Consulting', content: 'Engagement Manager EM role. Daily team leadership. Problem solving workstream ownership. Client interface. Project financials. McKinsey BCG Bain career ladder.' },
  { title: 'Associate Principal', domain: 'Consulting', content: 'Associate Principal AP consulting role. Client relationship development. Practice building. Proposal writing. Partner track position. Senior consultant level.' },
  { title: 'Partner Track', domain: 'Consulting', content: 'Consulting partner track 10-12 years. Up or out culture. Client book building. Thought leadership. Practice leadership. Equity partnership.' },
  { title: 'Proposal Writing', domain: 'Consulting', content: 'Consulting proposal writing RFP response. Approach methodology team credentials. Executive summary. Case examples. Pricing value-based. Used in tender processes.' },
  { title: 'Client Management', domain: 'Consulting', content: 'Client management stakeholder alignment. Weekly steering meetings. Status reports. Escalation protocols. Trust building. Used in long engagement programs.' },
  { title: 'Consulting Pricing Models', domain: 'Consulting', content: 'Consulting pricing models time materials fixed fee value-based outcome-based. Retainer arrangements. Risk sharing. Used by top firms. Margin optimization.' },
  { title: 'Follow the Sun Delivery', domain: 'Consulting', content: 'Follow the sun delivery model. Global delivery centers India Philippines Poland. 24-hour work cycle. Cost arbitrage. Used by Accenture TCS Infosys.' },
  { title: 'Industry Vertical Practices', domain: 'Consulting', content: 'Industry vertical practices financial services healthcare retail energy. Deep sector expertise. Regulatory knowledge. Used by McKinsey BCG to differentiate.' },
  { title: 'Functional Practices', domain: 'Consulting', content: 'Functional practices strategy operations technology marketing. Horizontal expertise. Cross-industry. Used alongside vertical practices matrix organization.' },
  { title: 'Consulting Diversity', domain: 'Consulting', content: 'Consulting diversity inclusion programs. Gender ethnic representation goals. McKinsey Womens Initiative. BCG Diversity. Accenture 50 percent women goal 2025.' },
  // Analytics consulting
  { title: 'McKinsey QuantumBlack', domain: 'Consulting', content: 'McKinsey QuantumBlack AI analytics lab. Formula 1 origin. Data science machine learning. Lilli internal AI. Used for advanced analytics client work.' },
  { title: 'BCG Gamma', domain: 'Consulting', content: 'BCG Gamma data science AI. Advanced analytics practice. Decision intelligence. Used for ML model deployment. Scientists engineers consultants blended teams.' },
  { title: 'Accenture AI', domain: 'Consulting', content: 'Accenture Applied Intelligence. 40K data AI professionals. Generative AI studio. Center for Advanced AI. NVIDIA Microsoft Google partnerships.' },
  { title: 'Deloitte AI Institute', domain: 'Consulting', content: 'Deloitte AI Institute State of Generative AI survey. Trustworthy AI framework. AI Academy. Global AI Institute research. Used for AI strategy advisory.' },
  { title: 'Bain Vector', domain: 'Consulting', content: 'Bain Vector digital delivery. Customer data strategy. Technology transformation. OpenAI partnership. Used for AI-powered consulting engagements.' },
  // Digital transformation
  { title: 'Digital Transformation Playbook', domain: 'Consulting', content: 'Digital transformation playbook 5 pillars strategy culture technology data operating model. McKinsey Seven Twenty One. BCG DigitalBCG. Used globally enterprise.' },
  { title: 'McKinsey Rewired', domain: 'Consulting', content: 'McKinsey Rewired digital AI transformation book. Six capabilities. Talent technology data operating model agile adoption. Used as transformation framework.' },
  { title: 'BCG Digital Maturity', domain: 'Consulting', content: 'BCG Digital Acceleration Index DAI. 4 categories 36 dimensions. Benchmark against industry leaders. Used to set transformation priorities. Digital ambition score.' },
  { title: 'Hyperautomation', domain: 'Consulting', content: 'Hyperautomation Gartner 2020 top trend. RPA AI ML integration. Process mining. Used by consulting firms for automation strategy. UiPath Automation Anywhere Blue Prism.' },
  { title: 'Intelligent Automation', domain: 'Consulting', content: 'Intelligent Automation IA combines RPA AI NLP. Cognitive automation. Decision automation. Used in finance HR operations. Deloitte Accenture practices.' },
  // Process consulting
  { title: 'Business Process Reengineering', domain: 'Consulting', content: 'Business Process Reengineering BPR Michael Hammer. Radical redesign. Clean-sheet approach. Reengineering the Corporation book. Used for transformative change.' },
  { title: 'Six Sigma DMAIC', domain: 'Consulting', content: 'Six Sigma DMAIC define measure analyze improve control. Motorola origin. Black Belt certification. Statistical process control. Used for quality manufacturing.' },
  { title: 'Process Mining', domain: 'Consulting', content: 'Process mining Celonis discovery. Event log analysis. Variants bottlenecks. Execution management system. Used by Siemens Uber Vodafone for operational excellence.' },
  { title: 'Celonis Platform', domain: 'Consulting', content: 'Celonis execution management process mining. Process intelligence graph. Automations. Used by Siemens Bayer ABB. German unicorn $11B valuation.' },
  { title: 'UiPath RPA', domain: 'Consulting', content: 'UiPath robotic process automation. Studio Orchestrator Assistant. AI Center. Romanian company NYSE PATH. Used by SMBC Uber Wendys for automation.' },
  // Assessment methods
  { title: 'Maturity Assessment', domain: 'Consulting', content: 'Maturity assessment 5-level models. Initial managed defined quantitatively managed optimizing. CMMI origin. Used for capability benchmarking baseline.' },
  { title: 'Readiness Assessment', domain: 'Consulting', content: 'Readiness assessment change capacity organization. Leadership sponsorship. Culture appetite. Used before major transformation programs. Risk identification.' },
  { title: 'Risk Assessment Matrix', domain: 'Consulting', content: 'Risk assessment matrix probability impact grid. Heat mapping. Residual risk after controls. Used in enterprise risk management. ISO 31000 aligned.' },
  { title: 'Competitive Analysis', domain: 'Consulting', content: 'Competitive analysis frameworks. Porter 5 forces. SWOT competitor profiling. Market positioning maps. Used in strategy formulation. Used by all strategy firms.' },
  { title: 'Market Sizing TAM SAM SOM', domain: 'Consulting', content: 'Market sizing Total Addressable Market Serviceable Addressable Market Serviceable Obtainable Market. Top-down bottom-up methods. Used in business cases.' },
  // Industry specific
  { title: 'Banking Transformation', domain: 'Consulting', content: 'Banking transformation digital core modernization. Open banking. Embedded finance. Cloud migration. Used by DBS BBVA JPMorgan. Oliver Wyman McKinsey practices.' },
  { title: 'Insurance Transformation', domain: 'Consulting', content: 'Insurance transformation insurtech claims automation. Underwriting AI. Distribution digital. Used by Allianz AXA MetLife. Bain Oliver Wyman specialists.' },
  { title: 'Retail Transformation', domain: 'Consulting', content: 'Retail transformation omnichannel unified commerce. Supply chain digital. Store of the future. Used by Walmart Target Lowes. Accenture Deloitte practices.' },
  { title: 'Healthcare Transformation', domain: 'Consulting', content: 'Healthcare transformation value-based care. Digital front door. Telehealth. EHR optimization. Used by Cleveland Clinic HCA. Deloitte McKinsey health practices.' },
  { title: 'Energy Transition', domain: 'Consulting', content: 'Energy transition net-zero pathways. Decarbonization roadmaps. Renewables integration. Used by Shell BP Equinor. BCG McKinsey energy practices.' },
  { title: 'Manufacturing 4.0', domain: 'Consulting', content: 'Manufacturing 4.0 Industry 4.0 smart factory. IoT AI robotics. Digital twin. Used by Siemens Bosch. German Mittelstand focus. McKinsey Digital Factory.' },
  { title: 'Automotive OEM Strategy', domain: 'Consulting', content: 'Automotive OEM strategy EV transition. Software-defined vehicle. ADAS autonomous. Used by VW BMW Toyota. Roland Berger Oliver Wyman automotive expertise.' },
  { title: 'Pharma Commercial', domain: 'Consulting', content: 'Pharma commercial excellence launch strategy. Omnichannel HCP engagement. Real-world evidence. Used by Pfizer Novartis. ZS IQVIA specialists.' },
  { title: 'Public Sector Consulting', domain: 'Consulting', content: 'Public sector consulting government digital transformation. Citizen services. Policy design. Used by HM Government US federal. Accenture Federal Deloitte Public Sector.' },
  // Delivery models
  { title: 'T-Shaped Consultant', domain: 'Consulting', content: 'T-shaped consultant deep expertise one area broad knowledge many. Value in hybrid skills. Used in modern consulting career model. IDEO origin concept.' },
  { title: 'Consulting Lab Model', domain: 'Consulting', content: 'Consulting lab model immersive workshops. Co-creation with clients. Deloitte Greenhouse BCG Centers for Digital Transformation. Used for executive engagement.' },
  { title: 'Build Operate Transfer', domain: 'Consulting', content: 'Build Operate Transfer BOT model. Consultancy builds capability runs it transfers to client. Used in captive centers transformations. Accenture Infosys common.' },
  { title: 'Secondment Model', domain: 'Consulting', content: 'Secondment model consultants embedded client teams. Long-term assignments. Skill transfer. Used in capability building. Alternative to traditional consulting.' },
  // Thought leadership
  { title: 'McKinsey Insights', domain: 'Consulting', content: 'McKinsey Insights publication research reports. MGI McKinsey Global Institute. Quarterly reports industry trends. Used as thought leadership marketing channel.' },
  { title: 'BCG Henderson Institute', domain: 'Consulting', content: 'BCG Henderson Institute strategy research. AI institute. Business model innovation. Used for thought leadership publication. Bruce Henderson namesake.' },
  { title: 'HBR Publication', domain: 'Consulting', content: 'Harvard Business Review HBR. Case studies frameworks. Used as thought leadership platform consulting firms. Monthly magazine. McKinsey BCG Bain partners publish.' },
  { title: 'MIT Sloan Review', domain: 'Consulting', content: 'MIT Sloan Management Review. Academic practitioner journal. Digital leadership AI. Used for research-based thought leadership. Consulting partnership publications.' },
  // Specific methodology
  { title: 'Value Driver Tree', domain: 'Consulting', content: 'Value driver tree financial decomposition. Revenue growth margin capital efficiency. ROIC WACC. Used in strategy diagnostic. Creating shareholder value analysis.' },
  { title: 'Activity-Based Costing', domain: 'Consulting', content: 'Activity-Based Costing ABC. Cost allocation by activities. Cost drivers. Used in cost transformation. Harvard Business School Kaplan origin.' },
  { title: 'Force Field Analysis', domain: 'Consulting', content: 'Force Field Analysis Kurt Lewin. Driving restraining forces. Change management diagnostic. Used in readiness assessment. Social psychology origin.' },
  { title: 'Fishbone Diagram', domain: 'Consulting', content: 'Fishbone Ishikawa diagram cause effect. 6Ms method materials machine measurement mother-nature. Used in root cause analysis. Quality management tool.' },
  { title: 'Five Whys', domain: 'Consulting', content: 'Five Whys root cause technique. Toyota Production System Sakichi Toyoda. Iterative questioning. Used in lean problem solving. Simple but effective.' },
  { title: 'A3 Problem Solving', domain: 'Consulting', content: 'A3 problem solving Toyota lean. One-page structured report. Background current state analysis countermeasures. Used in operational excellence. Visual management.' },
  { title: 'SCAMPER Technique', domain: 'Consulting', content: 'SCAMPER ideation technique. Substitute combine adapt modify put-to-other-use eliminate reverse. Used in innovation workshops. Creative thinking.' },
  { title: 'Six Thinking Hats', domain: 'Consulting', content: 'Six Thinking Hats Edward de Bono. White facts red emotions black caution yellow benefits green creativity blue process. Used in structured group thinking.' },
  { title: 'Delphi Method', domain: 'Consulting', content: 'Delphi method expert consensus. Anonymous iterative rounds. RAND Corporation origin. Used in forecasting scenario planning. Technology assessment.' },
  { title: 'Analytic Hierarchy Process', domain: 'Consulting', content: 'Analytic Hierarchy Process AHP Thomas Saaty. Pairwise comparisons. Decision criteria weighting. Used in multi-criteria decision making. Supplier vendor selection.' },
  { title: 'RACI Matrix', domain: 'Consulting', content: 'RACI matrix responsibility assignment. Responsible Accountable Consulted Informed. Used in project governance. Clear role definition. Prevents duplication gaps.' },
  { title: 'Stage Gate Process', domain: 'Consulting', content: 'Stage Gate process Robert Cooper. New product development. Decision gates phases. Go kill hold recycle. Used in innovation portfolio management.' },

  // ============ IT TOOLS DEEP — 80 chunks ============
  // Dev tooling
  { title: 'VS Code', domain: 'IT Tools', content: 'Visual Studio Code Microsoft editor. Extensions marketplace Language Server Protocol. Remote SSH WSL Containers. 14M monthly users. Most popular IDE 2024 survey.' },
  { title: 'JetBrains IDEs', domain: 'IT Tools', content: 'JetBrains IntelliJ IDEA PyCharm WebStorm Rider. Fleet next-gen. AI Assistant. Dedicated language IDEs. Used by enterprises professional developers. Paid subscription.' },
  { title: 'Sublime Text', domain: 'IT Tools', content: 'Sublime Text lightweight code editor. Multiple cursors Goto Anything. Python-based plugins. Used by developers for fast editing. One-time license.' },
  { title: 'Neovim Editor', domain: 'IT Tools', content: 'Neovim Vim fork Lua config. LSP built-in. Telescope Treesitter plugins. Kickstart LazyVim distributions. Used by terminal power users.' },
  { title: 'Android Studio', domain: 'IT Tools', content: 'Android Studio Google IntelliJ-based IDE. Kotlin Java. Layout Editor AVD emulator. Gradle builds. Used for Android app development official.' },
  { title: 'Xcode Apple', domain: 'IT Tools', content: 'Xcode Apple IDE. Swift Objective-C. Interface Builder SwiftUI Previews. Instruments profiling. Used for iOS macOS watchOS tvOS visionOS development.' },
  // CI/CD
  { title: 'GitHub Actions', domain: 'IT Tools', content: 'GitHub Actions CI/CD workflows YAML. Marketplace 20K actions. Matrix runs self-hosted runners. Environments secrets. Used by millions of repositories.' },
  { title: 'GitLab CI', domain: 'IT Tools', content: 'GitLab CI/CD integrated DevOps. Pipelines jobs stages. Auto DevOps. Built-in container registry. Used for single-tool DevSecOps platform.' },
  { title: 'CircleCI', domain: 'IT Tools', content: 'CircleCI continuous integration. Docker-first. Orbs reusable config. Parallelism. Used by Spotify Coinbase. Fast build performance focus.' },
  { title: 'Jenkins CI', domain: 'IT Tools', content: 'Jenkins open source CI server. Pipeline as code Jenkinsfile. 1800 plugins. Used by thousands of enterprises. Declarative scripted syntax.' },
  { title: 'Argo CD', domain: 'IT Tools', content: 'Argo CD GitOps continuous delivery Kubernetes. Declarative. Application sync status. Used by Intuit Red Hat. CNCF graduated project.' },
  { title: 'Flux CD', domain: 'IT Tools', content: 'Flux CD GitOps toolkit Kubernetes. Helm Kustomize. Multi-tenancy. Used for pull-based deployments. CNCF graduated. Weaveworks origin.' },
  { title: 'Buildkite', domain: 'IT Tools', content: 'Buildkite CI/CD platform hybrid. Agents run anywhere. Fast scalable. Used by Shopify Airbnb Pinterest. Bring your own infrastructure model.' },
  { title: 'Spinnaker', domain: 'IT Tools', content: 'Spinnaker continuous delivery multi-cloud. Netflix origin. Pipelines deployment strategies canary blue-green. Used for large-scale deployments.' },
  // Monitoring
  { title: 'Grafana Observability', domain: 'IT Tools', content: 'Grafana Labs open source dashboards. Grafana Mimir Loki Tempo Pyroscope. Prometheus native. Grafana Cloud managed. Used by 1M+ global users.' },
  { title: 'Prometheus Monitoring', domain: 'IT Tools', content: 'Prometheus open source monitoring. Time series metrics. PromQL query language. Alertmanager. CNCF graduated. Used by Kubernetes ecosystems globally.' },
  { title: 'OpenTelemetry Standard', domain: 'IT Tools', content: 'OpenTelemetry CNCF observability standard. Traces metrics logs. Auto-instrumentation SDKs. OTLP protocol. Used by all major APM vendors.' },
  { title: 'Jaeger Tracing', domain: 'IT Tools', content: 'Jaeger distributed tracing CNCF graduated. Uber origin. OpenTelemetry support. Used for microservices debugging performance analysis.' },
  { title: 'New Relic APM', domain: 'IT Tools', content: 'New Relic observability platform. APM infrastructure logs synthetics. 30+ agents. Used by GitHub Pinterest. NYC listed NEWR acquired.' },
  { title: 'Splunk SIEM', domain: 'IT Tools', content: 'Splunk machine data indexing. SPL search language. Splunk Enterprise Cloud. SIEM SOAR SOC. Cisco acquisition 2024 28B. Used by Fortune 100.' },
  { title: 'Dynatrace APM', domain: 'IT Tools', content: 'Dynatrace observability AI-powered Davis. Smartscape topology. OneAgent. Application Security. NYSE DT. Used by SAP BMW Kroger.' },
  { title: 'PagerDuty Incident', domain: 'IT Tools', content: 'PagerDuty incident response platform. Alert routing on-call schedules. Runbook automation. AIOps. Used by 14K customers. NYSE PD.' },
  { title: 'Sentry Error Tracking', domain: 'IT Tools', content: 'Sentry error performance monitoring. Open source SDKs. Release tracking source maps. Session replay. Used by 100K orgs Disney GitHub Microsoft.' },
  { title: 'Honeycomb Observability', domain: 'IT Tools', content: 'Honeycomb observability wide events. BubbleUp SLOs. OpenTelemetry native. Used by Intercom Vanguard. Charity Majors CTO.' },
  // Security
  { title: 'HashiCorp Vault', domain: 'IT Tools', content: 'HashiCorp Vault secrets management. Dynamic secrets PKI transit encryption. Enterprise HSM integration. Used by GitHub Adobe. IBM acquisition.' },
  { title: 'SentinelOne Endpoint', domain: 'IT Tools', content: 'SentinelOne autonomous AI endpoint protection. Singularity platform. Storyline attack visualization. Purple AI. Used by Samsung TGI Fridays. NYSE S.' },
  { title: 'Wiz Cloud Security', domain: 'IT Tools', content: 'Wiz cloud-native application protection CNAPP. Agentless multi-cloud. 45 percent Fortune 100. Google acquisition 32B 2024. Assaf Rappaport founder.' },
  { title: 'Snyk Developer Security', domain: 'IT Tools', content: 'Snyk developer-first security. SCA SAST container IaC. Snyk Learn. 2.2M developers. Used by Google Salesforce. Private unicorn 7.4B.' },
  { title: 'Tenable Nessus', domain: 'IT Tools', content: 'Tenable Nessus vulnerability scanner. Over 200K plugins. Tenable.io cloud platform. Exposure management. Used by 60 percent Fortune 500. NASDAQ TENB.' },
  { title: 'Palo Alto Cortex', domain: 'IT Tools', content: 'Palo Alto Networks Cortex XSIAM XDR. AI-driven SOC. Network next-gen firewalls. Prisma Cloud SASE. Used by 85K enterprises. Nikesh Arora CEO.' },
  { title: 'Check Point Security', domain: 'IT Tools', content: 'Check Point Software firewalls threat prevention. Infinity platform. CloudGuard Harmony. Israeli veteran security company. NASDAQ CHKP.' },
  { title: 'Fortinet FortiGate', domain: 'IT Tools', content: 'Fortinet security fabric. FortiGate firewalls. FortiAnalyzer FortiManager. SD-WAN SASE. Used by 680K customers. NASDAQ FTNT. Ken Xie.' },
  // Data platforms
  { title: 'Apache Spark', domain: 'IT Tools', content: 'Apache Spark unified analytics engine. Databricks commercial. PySpark Scala Java R. MLlib Structured Streaming. Used for big data processing ETL.' },
  { title: 'Apache Kafka', domain: 'IT Tools', content: 'Apache Kafka distributed streaming platform. LinkedIn origin. Confluent commercial. Topics partitions consumer groups. Used by 80 percent Fortune 100.' },
  { title: 'Apache Flink', domain: 'IT Tools', content: 'Apache Flink stream processing exactly-once. Stateful computations. Ververica commercial. Used by Alibaba Netflix Uber for real-time analytics.' },
  { title: 'Apache Airflow', domain: 'IT Tools', content: 'Apache Airflow workflow orchestration. Python DAGs. Astronomer commercial. Operators sensors hooks. Used by Airbnb Adobe for data pipelines.' },
  { title: 'Dagster Orchestration', domain: 'IT Tools', content: 'Dagster data orchestrator. Software-defined assets. Dagster Cloud. Asset-based dataflow. Used as modern Airflow alternative. Nick Schrock Facebook alum.' },
  { title: 'Prefect Workflows', domain: 'IT Tools', content: 'Prefect workflow orchestration Python. Tasks flows. Prefect Cloud. Dynamic flows. Used as modern data orchestrator. Jeremiah Lowin founder.' },
  { title: 'ClickHouse OLAP', domain: 'IT Tools', content: 'ClickHouse columnar OLAP database. Sub-second analytics. MergeTree engine. ClickHouse Cloud. Used by Uber Cloudflare Deutsche Bank. Very fast queries.' },
  { title: 'DuckDB Analytics', domain: 'IT Tools', content: 'DuckDB in-process OLAP SQL. Columnar vectorized execution. Single binary. Python R integration. Used for local data analysis. SQLite for analytics.' },
  { title: 'Apache Iceberg', domain: 'IT Tools', content: 'Apache Iceberg open table format. ACID time travel schema evolution. Snowflake Databricks support. Used for data lakehouse. Netflix origin.' },
  { title: 'Delta Lake', domain: 'IT Tools', content: 'Delta Lake Databricks open source. ACID transactions schema enforcement. Time travel. Unity Catalog. Used for data lakehouse architecture.' },
  { title: 'Apache Hudi', domain: 'IT Tools', content: 'Apache Hudi transactional data lake. Copy-on-write merge-on-read. Upserts incremental. Used by Uber origin Robinhood. Lake format alternative.' },
  // Container runtime
  { title: 'containerd Runtime', domain: 'IT Tools', content: 'containerd container runtime CNCF graduated. OCI compliant. Docker base. Kubernetes CRI. Used as industry standard low-level runtime.' },
  { title: 'Podman Containers', domain: 'IT Tools', content: 'Podman Red Hat rootless containers. Docker CLI compatible. Pods Kubernetes YAML. Desktop app. Used as Docker Desktop alternative.' },
  { title: 'Helm Package Manager', domain: 'IT Tools', content: 'Helm Kubernetes package manager. Charts templates values. Artifact Hub. Used for application deployment K8s. CNCF graduated.' },
  { title: 'Kustomize', domain: 'IT Tools', content: 'Kustomize Kubernetes configuration customization. Overlays patches. kubectl built-in. Used with Argo CD Flux. Declarative config management.' },
  { title: 'Istio Service Mesh', domain: 'IT Tools', content: 'Istio service mesh Kubernetes. Envoy proxy sidecars. Traffic management security observability. Used for microservices. CNCF graduated 2022.' },
  { title: 'Linkerd Mesh', domain: 'IT Tools', content: 'Linkerd lightweight service mesh. Rust-based. CNCF graduated. Zero trust mTLS. Used as alternative to Istio. Buoyant maintainer.' },
  { title: 'Cilium eBPF', domain: 'IT Tools', content: 'Cilium eBPF-based networking security observability. Kubernetes CNI. Hubble observability. Tetragon security. Isovalent acquired Cisco 2023.' },
  // IaC
  { title: 'Pulumi IaC', domain: 'IT Tools', content: 'Pulumi infrastructure as code real languages. Python TypeScript Go .NET Java. Multi-cloud. Used as Terraform alternative. Joe Duffy Microsoft alum.' },
  { title: 'OpenTofu', domain: 'IT Tools', content: 'OpenTofu Terraform fork Linux Foundation. BSL license controversy. Community-driven. Drop-in replacement. Used as open governance alternative.' },
  { title: 'AWS CDK', domain: 'IT Tools', content: 'AWS Cloud Development Kit. TypeScript Python Java .NET. Constructs higher-level abstractions. CloudFormation underneath. Used for AWS IaC.' },
  { title: 'Crossplane', domain: 'IT Tools', content: 'Crossplane Kubernetes control plane cloud. Providers compositions. CNCF incubating. Used for multi-cloud management. Upbound commercial.' },
  // Networking
  { title: 'Traefik Proxy', domain: 'IT Tools', content: 'Traefik cloud native edge router. Auto service discovery. Let us Encrypt. Kubernetes Ingress. Traefik Labs commercial. Used by 4K+ GitHub stars.' },
  { title: 'NGINX Web Server', domain: 'IT Tools', content: 'NGINX web server reverse proxy load balancer. F5 acquisition 2019. NGINX Plus. Used by 1/3 of top websites. Event-driven architecture.' },
  { title: 'Envoy Proxy', domain: 'IT Tools', content: 'Envoy proxy L7 service proxy. Lyft origin. xDS API. Service mesh data plane. CNCF graduated. Used by Istio Consul AWS App Mesh.' },
  { title: 'HAProxy', domain: 'IT Tools', content: 'HAProxy load balancer reverse proxy. High availability TCP HTTP. HAProxy Enterprise. Used by GitHub Instagram Reddit. Willy Tarreau origin.' },
  // Email/comms
  { title: 'SendGrid Twilio', domain: 'IT Tools', content: 'Twilio SendGrid email API. Transactional marketing. Reputation management. Dynamic templates. Used by Uber Spotify Airbnb. 1.5T emails/year.' },
  { title: 'Mailgun API', domain: 'IT Tools', content: 'Mailgun email API service. Transactional bulk sending. Validation inbox placement. Used for developer email infrastructure. Sinch acquired.' },
  { title: 'Postmark Email', domain: 'IT Tools', content: 'Postmark transactional email service. Fast delivery focused. Templates bounce handling. ActiveCampaign acquired. Used for receipt notification emails.' },
  // Storage
  { title: 'MinIO Object Storage', domain: 'IT Tools', content: 'MinIO S3-compatible object storage. Kubernetes native. Erasure coding. Used for private cloud. AI ML workloads. Active-active replication.' },
  { title: 'Backblaze B2', domain: 'IT Tools', content: 'Backblaze B2 cloud storage low cost. S3 compatible API. 1/4 AWS S3 price. Used as backup archival tier. Public company NASDAQ BLZE.' },
  { title: 'Wasabi Storage', domain: 'IT Tools', content: 'Wasabi hot cloud storage. 80 percent cheaper S3. No egress fees. Used for backup archival active workloads. Boston headquartered.' },
  // Frontend tools
  { title: 'Webpack Bundler', domain: 'IT Tools', content: 'Webpack module bundler. Loaders plugins. Code splitting HMR. Enterprise mature ecosystem. Tobias Koppers creator. Used by React Angular historically.' },
  { title: 'Turborepo', domain: 'IT Tools', content: 'Turborepo high-performance build system monorepos. Incremental caching. Vercel acquisition. Used by Vercel Netflix Disney. JavaScript TypeScript focus.' },
  { title: 'Nx Workspace', domain: 'IT Tools', content: 'Nx monorepo build system Nrwl. Smart rebuilds affected detection. Nx Cloud distributed tasks. Used by Google Microsoft. Angular origin multi-framework.' },
  { title: 'pnpm Package Manager', domain: 'IT Tools', content: 'pnpm fast disk-efficient package manager. Content-addressable store. Strict dependency resolution. Workspaces monorepo. Used as npm/yarn alternative.' },
  // Docs
  { title: 'Swagger OpenAPI', domain: 'IT Tools', content: 'Swagger OpenAPI specification API docs. Editor codegen. SmartBear commercial. Used globally for REST API documentation and client generation.' },
  { title: 'Stoplight API Design', domain: 'IT Tools', content: 'Stoplight API design platform. Visual OpenAPI editor. Style guides mocks. Swagger alternative. Used for API governance.' },
  { title: 'Postman API', domain: 'IT Tools', content: 'Postman API platform. Collections environments tests. Monitoring mock servers. 30M developers. Used for API development testing.' },
  { title: 'Insomnia REST', domain: 'IT Tools', content: 'Insomnia REST GraphQL client Kong. Design test debug. Git sync. Used as Postman alternative. Open source core.' },
  { title: 'Bruno API Client', domain: 'IT Tools', content: 'Bruno git-friendly API client. Plain text collections. Offline-first. Used as open source Postman alternative. Community-driven.' },
  // Project PM tools
  { title: 'Linear Issue Tracking', domain: 'IT Tools', content: 'Linear modern issue tracking. Cycles projects roadmaps. Keyboard-driven. Git integration. Used by OpenAI Vercel Ramp. Karri Saarinen founder.' },
  { title: 'Height PM Tool', domain: 'IT Tools', content: 'Height project management AI-native. Autopilot automation. Alternative to Linear Jira. Used by design-forward teams.' },
  { title: 'Shortcut Formerly Clubhouse', domain: 'IT Tools', content: 'Shortcut formerly Clubhouse. Stories epics iterations. Developer-friendly. Used as Jira alternative. Startup-focused.' },
  { title: 'Productboard', domain: 'IT Tools', content: 'Productboard product management platform. Customer feedback features roadmap. Used for product strategy. Used by Microsoft Zoom Avast.' },
  { title: 'Aha Roadmapping', domain: 'IT Tools', content: 'Aha product roadmap software. Strategy ideas features releases. Portal customer feedback. Used by 600K users. Brian de Haaff founder.' },

  // ============ CODE DEEP — 80 chunks ============
  // Language features
  { title: 'TypeScript Generics', domain: 'Code', content: 'TypeScript generics type parameters. Constraints extends keyword. Conditional types. infer keyword. Template literal types. Utility types Partial Pick Omit. Advanced type programming.' },
  { title: 'TypeScript Decorators', domain: 'Code', content: 'TypeScript decorators Stage 3 standard. Class method accessor field. Metadata reflection. Used in Angular NestJS. Previously experimental deprecated format.' },
  { title: 'React Hooks', domain: 'Code', content: 'React hooks useState useEffect useContext useReducer useMemo useCallback useRef. Custom hooks composition. Rules of hooks. Functional component pattern default.' },
  { title: 'React Server Components', domain: 'Code', content: 'React Server Components RSC Next.js App Router. Server-only rendering. Zero JS client. use client directive. Streaming SSR. Reduces bundle size.' },
  { title: 'React Suspense', domain: 'Code', content: 'React Suspense for data fetching. use hook React 19. Fallback boundaries. Streaming SSR. Used with Server Components. Concurrent rendering.' },
  { title: 'Next.js App Router', domain: 'Code', content: 'Next.js App Router file-based routing. Layouts nested pages loading error boundaries. Server Actions. Parallel intercepting routes. Replaces Pages Router.' },
  { title: 'Server Actions Next', domain: 'Code', content: 'Next.js Server Actions mutations. use server directive. Form actions progressive enhancement. Revalidation. Used instead of API routes for mutations.' },
  { title: 'Vue 3 Composition API', domain: 'Code', content: 'Vue 3 Composition API setup function. ref reactive computed watch. Composables reusable logic. Script setup syntax. Vue 3.4 improvements performance.' },
  { title: 'Svelte 5 Runes', domain: 'Code', content: 'Svelte 5 runes reactivity. $state $derived $effect $props. Replaces reactive declarations. Fine-grained updates. SvelteKit 2 compatible.' },
  { title: 'SolidJS Framework', domain: 'Code', content: 'SolidJS fine-grained reactivity. Signals no virtual DOM. JSX syntax like React. SolidStart full-stack. Ryan Carniato creator. Fast benchmarks.' },
  { title: 'Qwik Resumable', domain: 'Code', content: 'Qwik resumable framework. Lazy loading O(1) JS. Builder.io. Server-first. No hydration. Used for instant loading apps.' },
  { title: 'Astro Framework', domain: 'Code', content: 'Astro content-focused framework. Island architecture. Zero JS default. Multi-framework support. Used for blogs marketing sites documentation.' },
  // Backend frameworks
  { title: 'NestJS TypeScript', domain: 'Code', content: 'NestJS Node.js framework TypeScript. Modules controllers providers. Express Fastify adapters. Dependency injection. Used for enterprise Node APIs.' },
  { title: 'Fastify Node', domain: 'Code', content: 'Fastify Node.js fast web framework. Schema-based validation. JSON Schema. Plugin system. 40K req/sec. Used for high-performance Node APIs.' },
  { title: 'Hono Framework', domain: 'Code', content: 'Hono web framework Cloudflare Workers Deno Bun Node. Small fast. Type-safe. Edge-first. Used for edge API development.' },
  { title: 'Elysia Bun', domain: 'Code', content: 'Elysia Bun web framework. End-to-end type safety. Performance focus. TypeScript first. Used for Bun runtime applications.' },
  { title: 'Encore TypeScript Go', domain: 'Code', content: 'Encore backend framework. Automatic infrastructure. TypeScript Go. Dev dashboard tracing. Used as rapid backend development tool.' },
  { title: 'Axum Rust', domain: 'Code', content: 'Axum Rust web framework Tokio. Tower middleware. Ergonomic handlers. Used for Rust backend APIs. Part of Tokio ecosystem.' },
  { title: 'Actix Rust', domain: 'Code', content: 'Actix Rust web framework. Actor-based. High performance. Mature stable. Used for Rust production web services.' },
  { title: 'Gin Go Framework', domain: 'Code', content: 'Gin Go web framework. Fast HTTP router. Middleware JSON validation. Used for Go REST APIs. Popular lightweight.' },
  { title: 'Echo Go Framework', domain: 'Code', content: 'Echo Go web framework. Minimalist high-performance. Routing middleware. Alternative to Gin. Used in Go web applications.' },
  { title: 'Fiber Go', domain: 'Code', content: 'Fiber Go web framework Express-inspired. Built on Fasthttp. Zero memory allocation routing. Used for high-performance Go APIs.' },
  // Languages modern
  { title: 'Zig Language', domain: 'Code', content: 'Zig systems programming language. No hidden control flow. Compile-time execution. C interop. Bun runtime built in Zig. Andrew Kelley creator.' },
  { title: 'Gleam BEAM', domain: 'Code', content: 'Gleam BEAM VM typed language. Erlang Elixir ecosystem. Fault-tolerant. Functional. Used for distributed systems with types.' },
  { title: 'Elixir Phoenix', domain: 'Code', content: 'Elixir BEAM VM Erlang. José Valim creator. Phoenix LiveView. Concurrent fault-tolerant. Used by Discord WhatsApp Pinterest.' },
  { title: 'Haskell Lazy Functional', domain: 'Code', content: 'Haskell pure lazy functional language. Strong types. Monads typeclasses. GHC compiler. Used in finance Barclays Standard Chartered.' },
  { title: 'Scala JVM', domain: 'Code', content: 'Scala JVM hybrid OO functional. Akka actors. Apache Spark origin. Scala 3 Dotty. Used by Twitter LinkedIn Netflix.' },
  { title: 'F Sharp .NET', domain: 'Code', content: 'F Sharp functional .NET. Type inference pattern matching. Async workflows. Used in finance quantitative. Microsoft Research origin.' },
  { title: 'OCaml Functional', domain: 'Code', content: 'OCaml ML-family functional language. Strong types fast compilation. Used at Jane Street Facebook. Rust and TypeScript inspiration.' },
  { title: 'Crystal Language', domain: 'Code', content: 'Crystal Ruby-inspired compiled language. Type inference. Fast as C. Used for performance-critical Ruby-like code. Manas.tech.' },
  { title: 'Nim Language', domain: 'Code', content: 'Nim systems language. Python-like syntax compiled. Metaprogramming macros. Garbage collection. Used for systems scripting.' },
  // Databases modern
  { title: 'Neon Postgres', domain: 'Code', content: 'Neon serverless Postgres. Separation storage compute. Branching like Git. Autoscaling. Used for modern web apps. Databricks acquisition 2025.' },
  { title: 'PlanetScale MySQL', domain: 'Code', content: 'PlanetScale serverless MySQL. Vitess-based. Branching schema deployments. Connection pooling. Used by GitHub Square.' },
  { title: 'CockroachDB', domain: 'Code', content: 'CockroachDB distributed SQL. Postgres compatible. Geo-partitioning. Serverless cloud. Used by Netflix Bose. Strong consistency.' },
  { title: 'SurrealDB', domain: 'Code', content: 'SurrealDB multi-model. Document graph time-series. WebSocket HTTP. Embeddable. Used for modern full-stack applications.' },
  { title: 'TigerBeetle', domain: 'Code', content: 'TigerBeetle financial transactions database. Double-entry accounting built-in. Distributed consensus. Used for high-throughput finance.' },
  { title: 'QuestDB TimeSeries', domain: 'Code', content: 'QuestDB time-series database. SQL native. Ultra-fast ingestion. Used for financial trading IoT observability.' },
  { title: 'InfluxDB TimeSeries', domain: 'Code', content: 'InfluxDB time series database. InfluxQL Flux query. InfluxDB Cloud. IoT monitoring. Used for metrics telemetry data.' },
  { title: 'TimescaleDB', domain: 'Code', content: 'TimescaleDB Postgres extension time-series. Hypertables compression. Continuous aggregates. Used for IoT observability finance.' },
  { title: 'DragonflyDB', domain: 'Code', content: 'DragonflyDB Redis Memcached compatible. 25x faster throughput. Multi-threaded. Used as Redis alternative high performance.' },
  { title: 'Valkey Linux', domain: 'Code', content: 'Valkey Redis fork Linux Foundation. BSD license. Drop-in replacement. Backed by AWS Google Oracle after Redis license change.' },
  // Auth
  { title: 'Clerk Auth', domain: 'Code', content: 'Clerk authentication service. User management UI components. Next.js React integration. Organizations webhooks. Used by startups SaaS.' },
  { title: 'Auth.js NextAuth', domain: 'Code', content: 'Auth.js NextAuth.js authentication library. OAuth providers credentials. JWT sessions. Used in Next.js applications. Open source.' },
  { title: 'Supabase Auth', domain: 'Code', content: 'Supabase Auth PostgreSQL-backed. Row Level Security. Social OAuth magic link. Used in full-stack apps integrated with Supabase.' },
  { title: 'Firebase Auth', domain: 'Code', content: 'Firebase Authentication Google. Email password social phone anonymous. Security rules. Used in Firebase stack apps mobile web.' },
  { title: 'Keycloak Identity', domain: 'Code', content: 'Keycloak open source IAM. Red Hat. SSO federation. SAML OIDC. Used in enterprise self-hosted identity.' },
  // State management
  { title: 'Zustand State', domain: 'Code', content: 'Zustand small React state manager. No providers. Hooks-based. Used as Redux alternative. Jotai Valtio same author.' },
  { title: 'Redux Toolkit', domain: 'Code', content: 'Redux Toolkit modern Redux. Slices reducers. RTK Query. Immer built-in. Used in complex React state applications.' },
  { title: 'TanStack Query', domain: 'Code', content: 'TanStack Query React server state. Caching refetching optimistic updates. Mutations. Used for async data fetching. Tanner Linsley.' },
  { title: 'SWR Vercel', domain: 'Code', content: 'SWR React data fetching Vercel. Stale while revalidate. Focus revalidation. Used for simple data fetching React Next.' },
  { title: 'Jotai Atomic State', domain: 'Code', content: 'Jotai atomic React state. Bottom-up atoms. No providers. Used as Recoil alternative simpler model.' },
  { title: 'XState Machines', domain: 'Code', content: 'XState finite state machines JavaScript. Statecharts visualizer. XState Store. Used for complex UI logic. David Khourshid.' },
  // Styling
  { title: 'Tailwind CSS', domain: 'Code', content: 'Tailwind CSS utility-first. JIT compiler. Tailwind UI components. Used by Vercel Shopify. Adam Wathan creator. v4 alpha.' },
  { title: 'shadcn/ui', domain: 'Code', content: 'shadcn/ui copy-paste React components. Radix UI primitives. Tailwind styled. Not a library. Used in Next.js app templates.' },
  { title: 'Radix Primitives', domain: 'Code', content: 'Radix UI unstyled accessible primitives. WAI-ARIA compliant. Dialog popover dropdown. Used as foundation component libraries.' },
  { title: 'Material UI MUI', domain: 'Code', content: 'Material UI MUI React components Google Material Design. Joy UI. DataGrid. Used by enterprise React applications.' },
  { title: 'Chakra UI', domain: 'Code', content: 'Chakra UI React component library. Accessible composable. Theming. Used for rapid development. Segun Adebayo creator.' },
  { title: 'Ant Design', domain: 'Code', content: 'Ant Design React component library. Alibaba origin. Enterprise admin dashboards. Used widely in Chinese market and enterprise.' },
  { title: 'Styled Components', domain: 'Code', content: 'styled-components CSS-in-JS. Dynamic styling. Server side rendering. Theming. Used in React applications.' },
  { title: 'Emotion CSS', domain: 'Code', content: 'Emotion CSS-in-JS library. Performant. styled API. Used in React applications. Created by Kent C. Dodds team.' },
  // Mobile
  { title: 'React Native', domain: 'Code', content: 'React Native cross-platform mobile. Meta origin. New Architecture Fabric. Expo framework. Used by Meta Microsoft Shopify.' },
  { title: 'Expo Framework', domain: 'Code', content: 'Expo React Native framework. EAS Build Submit Update. Router file-based. Used for most React Native apps. Simplifies deployment.' },
  { title: 'Flutter Dart', domain: 'Code', content: 'Flutter Google UI toolkit. Dart language. iOS Android web desktop. Skia rendering. Used by BMW Alibaba Google Pay.' },
  { title: 'Ionic Capacitor', domain: 'Code', content: 'Ionic Capacitor cross-platform mobile web. Angular React Vue support. Native runtime. Used for web-first mobile apps.' },
  { title: 'Tauri Desktop', domain: 'Code', content: 'Tauri desktop apps Rust. Smaller than Electron. Web frontend Rust backend. Used for lightweight desktop applications.' },
  { title: 'Electron Desktop', domain: 'Code', content: 'Electron cross-platform desktop Chromium Node. VS Code Slack Discord. Used for most mature desktop apps. Large bundle size.' },
  // Testing
  { title: 'Jest Testing', domain: 'Code', content: 'Jest JavaScript testing framework Meta. Zero config. Snapshot mocks. Watch mode. Used widely in React Node. Declining slightly for Vitest.' },
  { title: 'Testing Library', domain: 'Code', content: 'Testing Library user-centric testing. React Vue Svelte. Query by role label. Kent C Dodds guide. Used as standard testing utility.' },
  { title: 'Storybook UI', domain: 'Code', content: 'Storybook UI component workshop. Isolated development. Chromatic visual testing. Addons. Used by Airbnb GitHub Uber for component docs.' },
  { title: 'Mock Service Worker', domain: 'Code', content: 'MSW Mock Service Worker. Network-level mocking. REST GraphQL. Used for testing applications without backend. Shared between dev test.' },
  // Build
  { title: 'esbuild', domain: 'Code', content: 'esbuild Go-based JavaScript bundler. 10-100x faster. Used by Vite tsup Bun. Evan Wallace Figma origin.' },
  { title: 'Rollup Bundler', domain: 'Code', content: 'Rollup JavaScript module bundler. Tree shaking. ES modules. Library bundling. Used by Vite underneath. Rich Harris creator.' },
  { title: 'Rspack Bundler', domain: 'Code', content: 'Rspack Rust-based webpack alternative. ByteDance. Fast builds. Compatible webpack loaders plugins. Used for large projects.' },
  { title: 'SWC Compiler', domain: 'Code', content: 'SWC Rust TypeScript JavaScript compiler. Next.js default. 20x faster Babel. Used as modern compilation tool.' },
  { title: 'Biome Tool', domain: 'Code', content: 'Biome Rust formatter linter. Prettier ESLint alternative. Single tool. Fast. Rome fork. Used for modern JavaScript projects.' },
  // Monorepo
  { title: 'Changesets Versioning', domain: 'Code', content: 'Changesets monorepo versioning tool. Changelog generation. Semver bumps. Used in pnpm Yarn monorepos. Atlassian origin.' },
  { title: 'Bun Workspaces', domain: 'Code', content: 'Bun workspaces monorepo. Fast install. Catalogs. Used as npm/yarn/pnpm alternative for modern JavaScript.' },
  { title: 'Moon Repo', domain: 'Code', content: 'Moon build system monorepo. Rust-based. Language agnostic. Task runner. Used as alternative Nx Turborepo.' },

  // ============ AI TOOLS DEEP — 80 chunks ============
  // Model families
  { title: 'Claude 4 Opus Sonnet Haiku', domain: 'AI Tools', content: 'Anthropic Claude 4.5 4.6 models. Opus most capable. Sonnet balanced. Haiku fast. 200K 1M context. Tool use computer use. Constitutional AI training.' },
  { title: 'GPT-4o OpenAI', domain: 'AI Tools', content: 'OpenAI GPT-4o omni-modal. Voice vision text. GPT-4 Turbo predecessor. 128K context. Realtime API. Used via ChatGPT API Azure.' },
  { title: 'GPT-5 OpenAI', domain: 'AI Tools', content: 'OpenAI GPT-5 next generation model. Reasoning unified. o-series reasoning models. Sam Altman. Released 2025. Agentic capabilities.' },
  { title: 'Gemini 2.0 Flash', domain: 'AI Tools', content: 'Google Gemini 2.0 Flash. 2M context. Multimodal native. Code execution. Grounding search. Used via Vertex AI Gemini API.' },
  { title: 'Llama 3 Meta', domain: 'AI Tools', content: 'Meta Llama 3 3.1 3.2 3.3. Open weights 8B 70B 405B. Multimodal Llama 3.2. Commercial use license. Used on Replicate Together Fireworks.' },
  { title: 'Mistral Models', domain: 'AI Tools', content: 'Mistral 7B Mixtral 8x7B 8x22B. Mistral Large Small Nemo. Apache license some models. Sparse MoE. French open alternative.' },
  { title: 'DeepSeek V3', domain: 'AI Tools', content: 'DeepSeek V3 R1 open reasoning models. Chinese lab. Competitive GPT-4. 685B parameters. MoE architecture. Cheap inference pricing.' },
  { title: 'Qwen Alibaba', domain: 'AI Tools', content: 'Alibaba Qwen 2.5 3 models. Open weights. Qwen VL multimodal. Qwen Coder. Chinese alternative. Strong coding benchmarks.' },
  { title: 'Command R Cohere', domain: 'AI Tools', content: 'Cohere Command R R+ RAG-optimized. Grounded generation citations. Tool use. Multilingual. Used for enterprise retrieval systems.' },
  { title: 'Phi Microsoft', domain: 'AI Tools', content: 'Microsoft Phi-3 Phi-4 small language models. 3.8B to 14B. Tutor textbooks training. On-device. Used for edge cases.' },
  // Multimodal
  { title: 'Stable Diffusion', domain: 'AI Tools', content: 'Stability AI Stable Diffusion. SDXL SD3. Open source image generation. ControlNet LoRA fine-tuning. Used with Automatic1111 ComfyUI.' },
  { title: 'DALL-E 3', domain: 'AI Tools', content: 'OpenAI DALL-E 3 image generation. ChatGPT integration. High fidelity prompt following. Microsoft Designer. Used via API.' },
  { title: 'Midjourney', domain: 'AI Tools', content: 'Midjourney AI image generation. Discord bot. v6.1 high quality. Niji anime style. Used by designers artists 20M users.' },
  { title: 'Flux Black Forest', domain: 'AI Tools', content: 'Flux.1 Black Forest Labs. Stable Diffusion founders. Pro Dev Schnell variants. Superior image quality. Used via Replicate fal.' },
  { title: 'Runway Gen-3', domain: 'AI Tools', content: 'Runway Gen-3 Alpha video generation. Text-to-video image-to-video. Used by filmmakers. Creative video AI leader.' },
  { title: 'Sora OpenAI', domain: 'AI Tools', content: 'OpenAI Sora text-to-video generation. Physics simulation. Long duration. Used for AI video. ChatGPT integration.' },
  { title: 'Luma Dream Machine', domain: 'AI Tools', content: 'Luma AI Dream Machine video generation. Photoreal motion. Fast generation. Used in creative workflows via API.' },
  { title: 'Pika Labs Video', domain: 'AI Tools', content: 'Pika Labs AI video generation. Text image to video. Effects. Used by creators. Discord Web platform.' },
  { title: 'Suno AI Music', domain: 'AI Tools', content: 'Suno AI music generation. Text to song with vocals. v4 high quality. Used by musicians creators. Cambridge MA.' },
  { title: 'Udio Music', domain: 'AI Tools', content: 'Udio AI music generation competitor Suno. Ex-Google DeepMind founders. Used for music creation.' },
  { title: 'Whisper OpenAI', domain: 'AI Tools', content: 'OpenAI Whisper speech recognition. Open source. Multilingual. Used for transcription. Whisper Large v3. API available.' },
  { title: 'Deepgram ASR', domain: 'AI Tools', content: 'Deepgram speech recognition. Nova-3 model. Fast accurate. Used for call centers transcription apps. API-first.' },
  { title: 'AssemblyAI', domain: 'AI Tools', content: 'AssemblyAI speech AI platform. Transcription speaker diarization sentiment. LeMUR LLM layer. Used in voice apps.' },
  // Agents
  { title: 'LangGraph Agents', domain: 'AI Tools', content: 'LangGraph stateful agent workflows LangChain. Graph-based flow control. Human in the loop. Checkpointing. Used for complex agent systems.' },
  { title: 'Dify Platform', domain: 'AI Tools', content: 'Dify LLM app platform. Visual workflow builder. RAG agents. Dataset management. Used as Langchain GUI alternative. Open source.' },
  { title: 'Flowise AI', domain: 'AI Tools', content: 'Flowise LangChain visual builder. Drag drop chatflow. Open source. Used for rapid LLM app prototyping.' },
  { title: 'n8n Workflows', domain: 'AI Tools', content: 'n8n workflow automation AI nodes. Self-hosted option. LangChain integration. Used for Zapier alternative with AI capabilities.' },
  { title: 'Zapier AI Actions', domain: 'AI Tools', content: 'Zapier AI actions agents. 7000 apps. Natural language automation. Used to connect LLMs to SaaS tools.' },
  { title: 'Make Integromat', domain: 'AI Tools', content: 'Make.com automation platform. OpenAI Claude integrations. Visual scenarios. Used for AI-powered workflows.' },
  { title: 'Relevance AI', domain: 'AI Tools', content: 'Relevance AI agent platform. No-code agent builder. Teams of agents. Used by marketing sales ops. Australian company.' },
  { title: 'Lindy AI Agents', domain: 'AI Tools', content: 'Lindy AI employees. Task automation. Email calendar CRM integration. Used for administrative AI automation.' },
  { title: 'Vellum Prompts', domain: 'AI Tools', content: 'Vellum prompt engineering platform. Version control testing. Workflows evaluations. Used by enterprise prompt management.' },
  // Prompts/eval
  { title: 'Humanloop Eval', domain: 'AI Tools', content: 'Humanloop LLM development platform. Prompt management evaluations. Fine-tuning. Used by Duolingo Vanta. San Francisco.' },
  { title: 'Braintrust Eval', domain: 'AI Tools', content: 'Braintrust LLM evals platform. Autoevals scoring. Playground. Used for production LLM testing. Ankur Goyal founder.' },
  { title: 'Ragas Evaluation', domain: 'AI Tools', content: 'Ragas RAG evaluation framework. Faithfulness answer relevance context precision recall. Open source. Used for RAG quality metrics.' },
  { title: 'TruLens', domain: 'AI Tools', content: 'TruLens TruEra LLM evaluation. Feedback functions. Snowflake acquired. Used for LLM app monitoring quality.' },
  { title: 'Phoenix Arize', domain: 'AI Tools', content: 'Arize Phoenix open source LLM observability. Traces evaluations. OpenTelemetry. Used for LLM debugging.' },
  // RAG tools
  { title: 'Unstructured.io', domain: 'AI Tools', content: 'Unstructured.io document parsing. PDF HTML docx images. Elements extraction. Used for LLM data ingestion. Open source enterprise.' },
  { title: 'LlamaParse', domain: 'AI Tools', content: 'LlamaParse document parser LlamaIndex. Complex tables PDFs charts. GenAI-native parsing. Used in RAG pipelines.' },
  { title: 'Reducto Docs', domain: 'AI Tools', content: 'Reducto document intelligence. OCR table extraction. API. Used for accurate document parsing LLM apps.' },
  { title: 'Jina Reader', domain: 'AI Tools', content: 'Jina AI Reader URL to LLM-friendly text. Embeddings Reranker. Jina CLIP multimodal. Used in RAG systems.' },
  { title: 'Firecrawl Web', domain: 'AI Tools', content: 'Firecrawl web scraping LLMs. Markdown output. Crawl endpoints. Used for web data collection RAG.' },
  { title: 'Exa AI Search', domain: 'AI Tools', content: 'Exa AI neural search engine LLMs. Semantic content retrieval. API for RAG. Used as Google alternative for AI.' },
  { title: 'Tavily Search API', domain: 'AI Tools', content: 'Tavily AI search API. LLM-optimized. Fast. Used in agents LangChain tools for web research.' },
  { title: 'SerpAPI', domain: 'AI Tools', content: 'SerpAPI Google search results API. Structured data. Used in LLM agents for web search grounding.' },
  // Embedding
  { title: 'OpenAI Embeddings', domain: 'AI Tools', content: 'OpenAI text-embedding-3-small large. 1536 3072 dimensions. Multilingual. Used for RAG semantic search. ada-002 legacy.' },
  { title: 'Voyage Embeddings', domain: 'AI Tools', content: 'Voyage AI embeddings. Domain-specific finance legal code. MongoDB acquisition. Used in retrieval systems.' },
  { title: 'BGE Embeddings', domain: 'AI Tools', content: 'BAAI BGE bge-m3 bge-large. Multi-lingual. Dense sparse ColBERT. Used in open source RAG. BAAI Beijing.' },
  { title: 'Nomic Embeddings', domain: 'AI Tools', content: 'Nomic Atlas embeddings open source. nomic-embed-text. Used for semantic search visualization. Open source friendly.' },
  // Reranking
  { title: 'Cohere Rerank', domain: 'AI Tools', content: 'Cohere Rerank v3 API. Cross-encoder reranking. Improves retrieval quality. Used in RAG pipelines second-stage ranking.' },
  { title: 'ColBERT Late Interaction', domain: 'AI Tools', content: 'ColBERT late interaction retrieval. Token-level embeddings. Stanford origin. RAGatouille library. Used for high-quality retrieval.' },
  // GPU/compute
  { title: 'Modal Serverless GPU', domain: 'AI Tools', content: 'Modal serverless GPU compute. Python-first. ML inference training. Used for LLM deployment. Erik Bernhardsson founder.' },
  { title: 'RunPod GPU', domain: 'AI Tools', content: 'RunPod cloud GPU rental. Serverless pods. Fast cold starts. Used for affordable AI compute. Template library.' },
  { title: 'Lambda Labs GPU', domain: 'AI Tools', content: 'Lambda Labs GPU cloud. H100 A100 clusters. On-demand reserved. Used for training inference. Deep learning focus.' },
  { title: 'CoreWeave GPU', domain: 'AI Tools', content: 'CoreWeave specialized AI cloud. H100 H200 Blackwell GPUs. Used by OpenAI Microsoft. NYSE CRWV IPO 2025.' },
  { title: 'Crusoe Energy', domain: 'AI Tools', content: 'Crusoe Energy AI cloud. Stranded energy. Low-carbon compute. GPU infrastructure. Used for sustainable AI.' },
  // Fine-tuning
  { title: 'LoRA Fine-tuning', domain: 'AI Tools', content: 'LoRA Low-Rank Adaptation efficient fine-tuning. Microsoft origin. Few parameters trained. Used on top of base models. QLoRA quantized.' },
  { title: 'Unsloth Training', domain: 'AI Tools', content: 'Unsloth fast LLM fine-tuning. 2x faster 50 percent less memory. Llama Mistral Phi. Used on Colab local GPUs.' },
  { title: 'Axolotl Training', domain: 'AI Tools', content: 'Axolotl fine-tuning framework. YAML config. DPO SFT. Used for open source LLM training. OpenAccess AI Collective.' },
  { title: 'MosaicML Composer', domain: 'AI Tools', content: 'MosaicML Composer training efficiency. Databricks acquisition. MPT models. Used for efficient LLM pre-training fine-tuning.' },
  // Observability
  { title: 'Langfuse Observability', domain: 'AI Tools', content: 'Langfuse open source LLM engineering platform. Tracing prompts evaluations. Self-hosted cloud. Used by 5K+ teams.' },
  { title: 'Helicone Proxy', domain: 'AI Tools', content: 'Helicone LLM observability. Proxy-based logging. Caching rate limiting. Used for OpenAI Anthropic usage tracking.' },
  { title: 'PromptLayer', domain: 'AI Tools', content: 'PromptLayer prompt management analytics. Versioning A/B testing. Used for prompt engineering workflows.' },
  { title: 'LiteLLM Proxy', domain: 'AI Tools', content: 'LiteLLM unified API 100+ LLM providers. Load balancing fallbacks. Logging spend tracking. Used as OpenAI-compatible gateway.' },
  { title: 'OpenRouter', domain: 'AI Tools', content: 'OpenRouter unified LLM API gateway. Many models one endpoint. Fallback auto-routing. Used for multi-model applications.' },
  // Voice/Audio
  { title: 'OpenAI Realtime Voice', domain: 'AI Tools', content: 'OpenAI Realtime API voice conversations. WebSocket. Low latency. GPT-4o voice. Used for voice assistants apps.' },
  { title: 'Hume AI Emotion', domain: 'AI Tools', content: 'Hume AI empathic voice. Emotion detection. EVI voice interface. Used for emotional AI applications.' },
  { title: 'Cartesia Voice', domain: 'AI Tools', content: 'Cartesia Sonic voice model. Fast voice synthesis. State space models. Used for real-time voice applications.' },
  { title: 'PlayHT Voice', domain: 'AI Tools', content: 'PlayHT AI voice generation. Voice cloning. Studio API. Used for audiobooks podcasts. High quality.' },
  // MCP/tools
  { title: 'Model Context Protocol', domain: 'AI Tools', content: 'MCP Model Context Protocol Anthropic open standard. Tool use resources prompts. Servers clients. JSON-RPC. Used for LLM integrations ecosystem.' },
  { title: 'Function Calling OpenAI', domain: 'AI Tools', content: 'Function calling OpenAI structured outputs. JSON schema. Parallel calls. Used for tool use agent workflows.' },
  { title: 'Anthropic Tool Use', domain: 'AI Tools', content: 'Anthropic Claude tool use. Structured inputs. Parallel tool calls. Fine-grained control. Used for agent building.' },
  { title: 'Artifacts Claude', domain: 'AI Tools', content: 'Claude Artifacts interactive content. React components HTML SVG. Side panel. Used in Claude.ai for code preview interactive.' },
  // Image editing
  { title: 'Adobe Firefly', domain: 'AI Tools', content: 'Adobe Firefly generative AI. Integrated Photoshop Illustrator Express. Commercial safe training. Used by enterprise creative teams.' },
  { title: 'Canva AI Magic', domain: 'AI Tools', content: 'Canva Magic Studio AI. Magic Edit Eraser Expand. Background removal. Used by 190M users for AI-assisted design.' },
  { title: 'Leonardo AI', domain: 'AI Tools', content: 'Leonardo AI image generation. Canvas editor. Fine-tuned models. Used for game assets art. Canva acquisition.' },
  { title: 'Magnific AI', domain: 'AI Tools', content: 'Magnific AI image upscaling enhancement. Creative reimagining. Used by designers photographers. Javi Lopez founder.' },
  { title: 'Krea AI', domain: 'AI Tools', content: 'Krea AI real-time image generation. Live canvas. Enhance. Used for creative visual exploration.' },
  // Search/Research
  { title: 'Perplexity Spaces', domain: 'AI Tools', content: 'Perplexity Spaces collaborative research. File uploads. Custom system prompts. Used for team research projects.' },
  { title: 'Elicit Research', domain: 'AI Tools', content: 'Elicit AI research assistant. Paper search summarization. Systematic reviews. Used by academics scientists literature review.' },
  { title: 'Consensus Research', domain: 'AI Tools', content: 'Consensus AI search scientific papers. Yes/no questions evidence. Used for evidence-based research.' },
  { title: 'SciSpace', domain: 'AI Tools', content: 'SciSpace AI research papers. Copilot chat with PDF. Paraphraser. Used by researchers reading scientific literature.' },
  // LLMOps platforms
  { title: 'Anyscale Ray', domain: 'AI Tools', content: 'Anyscale commercial Ray. Distributed AI compute. Ray Serve Train Tune. Used for large-scale ML workloads.' },
  { title: 'Determined AI', domain: 'AI Tools', content: 'Determined AI HPE. Deep learning training platform. Hyperparameter search. Used by research labs enterprises.' },
  { title: 'ClearML MLOps', domain: 'AI Tools', content: 'ClearML open source MLOps platform. Experiment tracking orchestration datasets. Used as end-to-end AI platform.' },
  { title: 'Comet ML', domain: 'AI Tools', content: 'Comet ML experiment tracking. Model monitoring. LLM evaluations. Used by Uber Netflix Stanford. Tracking platform.' },
]

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log(`=== MEGA ENRICH v6: ${KNOWLEDGE.length} chunks (DEEP Consulting/IT/Code/AI stack) ===\n`)
  const domains = [...new Set(KNOWLEDGE.map(k => k.domain))]
  const byDomain = domains.map(d => `${d}:${KNOWLEDGE.filter(k => k.domain === d).length}`).join(', ')
  console.log(`Distribution: ${byDomain}\n`)
  const t0 = Date.now()

  const BATCH = 5
  let indexed = 0
  let failed = 0
  const failedItems = []

  for (let i = 0; i < KNOWLEDGE.length; i += BATCH) {
    const batch = KNOWLEDGE.slice(i, i + BATCH)
    const batchT0 = Date.now()
    const results = await Promise.all(batch.map(k => raptorIndex(k.content, k.title, k.domain)))
    results.forEach((r, idx) => {
      if (r !== null) indexed++
      else { failed++; failedItems.push(batch[idx]) }
    })
    const batchOk = results.filter(r => r !== null).length
    console.log(`Batch ${Math.floor(i/BATCH)+1}/${Math.ceil(KNOWLEDGE.length/BATCH)}: ${batchOk}/${batch.length} (${Date.now() - batchT0}ms)`)
    if (i + BATCH < KNOWLEDGE.length) await sleep(1000)
  }

  // Auto-retry failed items
  if (failedItems.length > 0) {
    console.log(`\n=== RETRY: ${failedItems.length} failed chunks ===`)
    await sleep(5000)
    for (let i = 0; i < failedItems.length; i += BATCH) {
      const batch = failedItems.slice(i, i + BATCH)
      const results = await Promise.all(batch.map(k => raptorIndex(k.content, k.title, k.domain)))
      const batchOk = results.filter(r => r !== null).length
      indexed += batchOk
      failed -= batchOk
      console.log(`Retry ${Math.floor(i/BATCH)+1}/${Math.ceil(failedItems.length/BATCH)}: ${batchOk}/${batch.length}`)
      if (i + BATCH < failedItems.length) await sleep(2000)
    }
  }

  console.log(`\n=== DONE ===`)
  console.log(`Indexed: ${indexed}/${KNOWLEDGE.length}`)
  console.log(`Failed: ${failed}`)
  console.log(`Duration: ${Date.now() - t0}ms`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
