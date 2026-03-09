import { useState, useRef, useEffect } from "react";

// ── GRAPH CONTEXT ── pre-loaded from Neo4j ──────────────────────────
const GRAPH_CONTEXT = {
  domains: [
    { id: "STR", name: "Strategy", desc: "Corporate and business unit strategy, market positioning, and growth planning" },
    { id: "FIN", name: "Finance & Accounting", desc: "Financial advisory, audit, tax, treasury" },
    { id: "OPS", name: "Operations", desc: "Operational excellence, process improvement, and supply chain optimization" },
    { id: "TEC", name: "Technology", desc: "Technology strategy, architecture, cloud, and software development" },
    { id: "CYB", name: "Cybersecurity", desc: "Cybersecurity strategy, risk management, and security operations" },
    { id: "PE",  name: "PE & VC", desc: "Private equity and venture capital due diligence, value creation, and exit planning" },
    { id: "ESG", name: "ESG & Sustainability", desc: "CSRD reporting, carbon accounting, social governance" },
    { id: "PPL", name: "People & Org", desc: "Organizational design, talent management, and change management" },
    { id: "MKT", name: "Marketing & CX", desc: "Marketing strategy, customer experience, and growth acceleration" },
    { id: "RCM", name: "Risk & Compliance", desc: "Enterprise risk management, regulatory compliance, and governance" },
    { id: "DIG", name: "Digital & Analytics", desc: "Digital strategy, data architecture, advanced analytics, and AI-driven transformation" },
    { id: "SCM", name: "Supply Chain", desc: "End-to-end supply chain strategy, procurement, logistics, and resilience" },
    { id: "LEG", name: "Legal Advisory", desc: "Legal due diligence, contract management, regulatory advisory, and dispute resolution" },
    { id: "HCM", name: "Human Capital", desc: "Workforce planning, compensation strategy, employee engagement, and HR technology" },
    { id: "DD",  name: "Due Diligence", desc: "Commercial, financial, operational, and technology due diligence for M&A transactions" },
    { id: "TRD", name: "Trading", desc: "Trading strategy, execution, risk management, technology, and compliance" },
    { id: "BRK", name: "Brokerage", desc: "Brokerage strategy, client advisory, trade execution, platform development, and compliance" },
    { id: "EUF", name: "EU Funding & Projects", desc: "EU funding opportunities, project management, proposal writing, financial reporting" },
    // Orphan domains (null-id — P0 still in progress)
    { id: null, name: "Cybersecurity (orphan)", desc: "Security operations, compliance, risk management" },
    { id: null, name: "Legal & Compliance (orphan)", desc: "Regulatory compliance, contract management, governance" },
    { id: null, name: "Data & Privacy", desc: "GDPR, data governance, privacy engineering" },
    { id: null, name: "Strategy & M&A (orphan)", desc: "Due diligence, market analysis, transformation" },
    { id: null, name: "Digital Transformation (orphan)", desc: "Cloud, automation, AI adoption, modernization" },
    { id: null, name: "Tax Advisory (orphan)", desc: "Corporate tax, personal tax, duties/VAT, international tax, wealth structuring" },
  ],
  patterns: [
    { name: "Legal Pressure Asymmetry", description: "Legal domain creates asymmetric pressure on other domains" },
    { name: "Synergy Clusters", description: "Cross-domain synergy clusters identified in graph" },
    { name: "Financial Pervasiveness", description: "FIN domain appears in majority of cross-domain patterns" },
    { name: "Universal Binding Processes", description: "Stakeholder, Governance, and KM appear across all domains" },
  ],
  competitors: [
    { name: "McKinsey", tier: "MBB", strengths: ["Brand", "Top Talent", "C-Suite Access", "Global Reach"] },
    { name: "BCG", tier: "MBB", strengths: ["Strategy", "Analytics", "Digital", "Innovation"] },
    { name: "Bain", tier: "MBB", strengths: ["Results Focus", "Private Equity", "NPS Expertise"] },
    { name: "Deloitte", tier: "Big4", strengths: ["Scale", "Technology", "Implementation", "Audit Ties"] },
    { name: "PwC", tier: "Big4", strengths: ["Audit Access", "Risk", "Deals", "Tax"] },
    { name: "EY", tier: "Big4", strengths: ["Transactions", "Risk", "Tax", "Digital"] },
    { name: "KPMG", tier: "Big4", strengths: ["Deals", "Risk", "Tax", "Industry Focus"] },
    { name: "Accenture", tier: "Tier2", strengths: ["Technology", "Scale", "Outsourcing", "Digital"] },
  ],
  openIssues: [
    "P0: 6 orphan ConsultingDomain nodes with null IDs — DETACH DELETE blocked by LegalComplianceGate",
    "P0: Domain ID alignment — seeder IDs ↔ contract IDs mapping not complete",
    "P1: Dream Scheduler Phase 3 — pattern queries not yet wired as cron",
    "P1: Capability maturity layer — DELIVERS relationship from Consultant → L2SubProcess missing",
    "P2: IndustryVertical nodes (NACE codes) not yet linked to domains",
    "P2: Engagement data model — :Engagement node not yet created",
    "P3: Competitor mapping — Big 4 service pages not scraped yet",
    "P3: Temporal patterns — no timestamp on cross-domain relationships",
  ],
  unansweredQuestions: [
    "Which L2 processes have we actually delivered in engagements?",
    "What is our win rate per domain and L1 process?",
    "Which domain pairs appear together in 80%+ of engagements?",
    "What L2 processes do clients ask for that we don't have?",
    "Which Nordic regulatory changes in 2025-2026 create new demand?",
    "How does our taxonomy map to NACE industry codes?",
    "What is the average engagement complexity (# domains × # L2s)?",
    "Are the 3 universal binders (Stakeholder, Governance, KM) priced or given away?",
  ]
};

// ── RAG RETRIEVAL ── keyword routing over graph context ────────────
function retrieveContext(query) {
  const q = query.toLowerCase();
  const chunks = [];

  // Domain routing
  const domainKeywords = {
    STR: ["strategy", "m&a", "market", "growth", "positioning"],
    FIN: ["finance", "financial", "accounting", "tax", "treasury", "audit"],
    CYB: ["cyber", "security", "risk", "soc", "pentest", "vulnerability"],
    TEC: ["technology", "tech", "cloud", "architecture", "software", "digital"],
    ESG: ["esg", "sustainability", "csrd", "carbon", "green"],
    RCM: ["compliance", "regulatory", "governance", "risk management"],
    LEG: ["legal", "contract", "regulation", "gdpr", "dispute"],
    DIG: ["analytics", "data", "ai", "transformation", "automation"],
    PE:  ["private equity", "pe", "vc", "venture", "due diligence"],
    DD:  ["due diligence", "m&a", "transaction"],
    PPL: ["people", "hr", "talent", "org", "change management"],
  };

  const matchedDomains = new Set();
  for (const [id, kws] of Object.entries(domainKeywords)) {
    if (kws.some(k => q.includes(k))) matchedDomains.add(id);
  }

  if (matchedDomains.size > 0) {
    const relevant = GRAPH_CONTEXT.domains.filter(d => matchedDomains.has(d.id));
    chunks.push({ type: "ConsultingDomain", nodes: relevant, label: "Matching Domains" });
  } else {
    chunks.push({ type: "ConsultingDomain", nodes: GRAPH_CONTEXT.domains.filter(d => d.id), label: "All Domains" });
  }

  // Competitor routing
  if (["competitor", "mckinsey", "bcg", "deloitte", "pwc", "big4", "mbb", "market"].some(k => q.includes(k))) {
    chunks.push({ type: "Competitor", nodes: GRAPH_CONTEXT.competitors, label: "Competitors" });
  }

  // Pattern routing
  if (["pattern", "synergy", "cross-domain", "cluster", "binding", "universal"].some(k => q.includes(k))) {
    chunks.push({ type: "EmergentPattern", nodes: GRAPH_CONTEXT.patterns, label: "Emergent Patterns" });
  }

  // Issues/gaps routing
  if (["issue", "problem", "gap", "missing", "open", "todo", "p0", "p1", "p2", "orphan"].some(k => q.includes(k))) {
    chunks.push({ type: "OpenIssues", nodes: GRAPH_CONTEXT.openIssues.map(i => ({ name: i })), label: "Open Issues (P0–P3)" });
  }

  // Unanswered questions routing
  if (["question", "unknown", "unanswered", "don't know", "what", "which", "who", "how"].some(k => q.includes(k))) {
    chunks.push({ type: "Questions", nodes: GRAPH_CONTEXT.unansweredQuestions.map(q => ({ name: q })), label: "Unanswered Strategic Questions" });
  }

  return chunks;
}

function buildSystemPrompt(contextChunks) {
  const contextStr = contextChunks.map(chunk => {
    const nodeStr = chunk.nodes.map(n => {
      if (n.strengths) return `  - ${n.name} (${n.tier}): ${n.strengths.join(", ")}`;
      if (n.desc) return `  - [${n.id || "null-id"}] ${n.name}: ${n.desc}`;
      return `  - ${n.name}`;
    }).join("\n");
    return `### ${chunk.label} (${chunk.type})\n${nodeStr}`;
  }).join("\n\n");

  return `Du er en RAG-assistent med direkte adgang til en Neo4j knowledge graph om et consulting-firma's taxonomy, domæner, processer og konkurrenter.

GRAPH CONTEXT (hentet fra Neo4j live):
${contextStr}

REGLER:
- Svar KUN baseret på graph-konteksten ovenfor
- Hvis svaret ikke findes i konteksten, svar: "INSUFFICIENT_EVIDENCE — mangler: [hvad der mangler]"
- Citer altid hvilken node-type du baserer svaret på (fx "Per ConsultingDomain:CYB...")
- Svar på dansk medmindre andet ønskes
- Vær præcis og analytisk — dette er til kommercielle beslutninger`;
}

// ── COMPONENTS ────────────────────────────────────────────────────

const NodeBadge = ({ type, count }) => {
  const colors = {
    ConsultingDomain: "#00d4aa",
    Competitor: "#ff6b6b",
    EmergentPattern: "#ffd93d",
    OpenIssues: "#ff8c42",
    Questions: "#6bcbff",
  };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      background: (colors[type] || "#888") + "22",
      border: `1px solid ${colors[type] || "#888"}44`,
      color: colors[type] || "#888",
      borderRadius: "4px", padding: "2px 8px",
      fontSize: "11px", fontFamily: "monospace", fontWeight: 600,
    }}>
      <span style={{ opacity: 0.7 }}>◈</span> {type} ×{count}
    </span>
  );
};

const ContextPanel = ({ chunks, visible }) => {
  if (!visible || !chunks.length) return null;
  return (
    <div style={{
      position: "absolute", right: 0, top: 0, bottom: 0, width: "280px",
      background: "#0d1117", borderLeft: "1px solid #21262d",
      padding: "16px", overflowY: "auto", fontSize: "11px",
      fontFamily: "monospace", color: "#8b949e",
      transition: "all 0.3s ease",
    }}>
      <div style={{ color: "#58a6ff", marginBottom: "12px", fontWeight: 700, fontSize: "12px" }}>
        ◈ RETRIEVED CONTEXT
      </div>
      {chunks.map((chunk, i) => (
        <div key={i} style={{ marginBottom: "16px" }}>
          <div style={{ color: "#e6edf3", marginBottom: "6px", fontSize: "11px", fontWeight: 600 }}>
            {chunk.label}
            <span style={{ color: "#6e7681", marginLeft: "6px" }}>({chunk.type})</span>
          </div>
          {chunk.nodes.slice(0, 6).map((n, j) => (
            <div key={j} style={{
              padding: "4px 8px", marginBottom: "2px",
              background: "#161b22", borderRadius: "4px",
              borderLeft: "2px solid #21262d", lineHeight: 1.4,
            }}>
              <span style={{ color: "#c9d1d9" }}>{n.id ? `[${n.id}] ` : ""}</span>
              <span>{n.name}</span>
            </div>
          ))}
          {chunk.nodes.length > 6 && (
            <div style={{ color: "#6e7681", paddingLeft: "8px" }}>+{chunk.nodes.length - 6} more…</div>
          )}
        </div>
      ))}
    </div>
  );
};

const Message = ({ msg }) => {
  const isUser = msg.role === "user";
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      marginBottom: "20px", gap: "6px",
    }}>
      <div style={{
        fontSize: "10px", color: "#6e7681", fontFamily: "monospace",
        paddingLeft: isUser ? 0 : "4px", paddingRight: isUser ? "4px" : 0,
      }}>
        {isUser ? "YOU" : "◈ NEO4J-RAG"}
      </div>
      {!isUser && msg.contextChunks?.length > 0 && (
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", paddingLeft: "4px" }}>
          {msg.contextChunks.map((c, i) => (
            <NodeBadge key={i} type={c.type} count={c.nodes.length} />
          ))}
        </div>
      )}
      <div style={{
        maxWidth: "80%", padding: "12px 16px",
        background: isUser ? "#1f6feb22" : "#161b22",
        border: isUser ? "1px solid #1f6feb55" : "1px solid #21262d",
        borderRadius: isUser ? "12px 12px 4px 12px" : "4px 12px 12px 12px",
        color: "#e6edf3", fontSize: "14px", lineHeight: 1.7,
        fontFamily: "'IBM Plex Mono', monospace",
        whiteSpace: "pre-wrap",
      }}>
        {msg.content}
        {msg.streaming && (
          <span style={{ display: "inline-block", width: "8px", height: "14px", background: "#58a6ff", marginLeft: "2px", animation: "blink 1s infinite" }} />
        )}
      </div>
    </div>
  );
};

// ── SUGGESTED QUERIES ─────────────────────────────────────────────
const SUGGESTIONS = [
  "Hvilke domæner har vi i taxomony'en?",
  "Hvem er vores stærkeste konkurrenter på CYB?",
  "Hvad er de emergente patterns i grafen?",
  "Hvad er de åbne P0 issues lige nu?",
  "Hvilke strategiske spørgsmål mangler vi svar på?",
  "Sammenlign STR og FIN domænerne",
];

// ── MAIN APP ──────────────────────────────────────────────────────
export default function Neo4jRAG() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Klar. Jeg har hentet graph-kontekst fra Neo4j (24 ConsultingDomains, 8 Competitors, 4 EmergentPatterns). Stil mig et spørgsmål om jeres consulting taxonomy.",
      contextChunks: [],
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [activeContext, setActiveContext] = useState([]);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (text) => {
    const query = text || input.trim();
    if (!query || loading) return;
    setInput("");

    // Retrieve context
    const contextChunks = retrieveContext(query);
    setActiveContext(contextChunks);

    const userMsg = { role: "user", content: query };
    const assistantMsg = { role: "assistant", content: "", streaming: true, contextChunks };
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setLoading(true);

    try {
      const systemPrompt = buildSystemPrompt(contextChunks);
      const history = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: systemPrompt,
          messages: history,
        }),
      });

      const data = await res.json();
      const reply = data.content?.[0]?.text || "Fejl: intet svar";

      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: reply, streaming: false };
        return updated;
      });
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: `Fejl: ${err.message}`, streaming: false };
        return updated;
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      fontFamily: "'IBM Plex Mono', monospace",
      background: "#0d1117",
      minHeight: "100vh",
      color: "#e6edf3",
      display: "flex",
      flexDirection: "column",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0d1117; }
        ::-webkit-scrollbar-thumb { background: #21262d; border-radius: 2px; }
        @keyframes blink { 0%,100% { opacity:1 } 50% { opacity:0 } }
        @keyframes pulse { 0%,100% { opacity:0.4 } 50% { opacity:1 } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
        textarea:focus { outline: none; }
        textarea { resize: none; }
      `}</style>

      {/* Header */}
      <div style={{
        borderBottom: "1px solid #21262d",
        padding: "12px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#0d1117",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            width: "8px", height: "8px", borderRadius: "50%",
            background: "#3fb950",
            boxShadow: "0 0 8px #3fb95088",
            animation: "pulse 2s infinite",
          }} />
          <span style={{ color: "#58a6ff", fontWeight: 700, fontSize: "13px", letterSpacing: "0.05em" }}>
            NEO4J · RAG
          </span>
          <span style={{ color: "#6e7681", fontSize: "11px" }}>
            {GRAPH_CONTEXT.domains.length} domains · {GRAPH_CONTEXT.competitors.length} competitors · {GRAPH_CONTEXT.patterns.length} patterns
          </span>
        </div>
        <button
          onClick={() => setShowContext(p => !p)}
          style={{
            background: showContext ? "#1f6feb22" : "transparent",
            border: `1px solid ${showContext ? "#1f6feb55" : "#21262d"}`,
            color: showContext ? "#58a6ff" : "#6e7681",
            borderRadius: "6px", padding: "4px 12px", cursor: "pointer",
            fontSize: "11px", fontFamily: "inherit",
          }}
        >
          {showContext ? "◈ Context ON" : "◈ Context OFF"}
        </button>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, position: "relative", overflow: "hidden" }}>
        {/* Chat */}
        <div style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px",
          paddingRight: showContext ? "304px" : "24px",
          transition: "padding-right 0.3s ease",
        }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ animation: "fadeIn 0.3s ease" }}>
              <Message msg={msg} />
            </div>
          ))}

          {/* Suggestions — show only when no messages yet or last msg is assistant */}
          {messages.length <= 1 && (
            <div style={{ marginTop: "16px" }}>
              <div style={{ color: "#6e7681", fontSize: "11px", marginBottom: "10px" }}>
                FORESLÅEDE SPØRGSMÅL
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} onClick={() => send(s)} style={{
                    background: "#161b22",
                    border: "1px solid #21262d",
                    borderRadius: "6px", padding: "6px 12px",
                    color: "#8b949e", fontSize: "12px", cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 0.15s",
                  }}
                    onMouseEnter={e => { e.target.style.borderColor = "#58a6ff55"; e.target.style.color = "#c9d1d9"; }}
                    onMouseLeave={e => { e.target.style.borderColor = "#21262d"; e.target.style.color = "#8b949e"; }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Context panel */}
        <ContextPanel chunks={activeContext} visible={showContext} />
      </div>

      {/* Input */}
      <div style={{
        borderTop: "1px solid #21262d",
        padding: "16px 20px",
        background: "#0d1117",
        display: "flex", gap: "12px", alignItems: "flex-end",
      }}>
        <div style={{
          flex: 1, background: "#161b22",
          border: "1px solid #21262d", borderRadius: "8px",
          padding: "10px 14px",
          display: "flex", alignItems: "flex-end", gap: "8px",
          transition: "border-color 0.15s",
        }}
          onFocus={e => e.currentTarget.style.borderColor = "#58a6ff55"}
          onBlur={e => e.currentTarget.style.borderColor = "#21262d"}
        >
          <span style={{ color: "#58a6ff", fontSize: "13px", paddingBottom: "2px" }}>›</span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Spørg om domæner, processer, konkurrenter, patterns…"
            rows={1}
            style={{
              flex: 1, background: "transparent", border: "none",
              color: "#e6edf3", fontSize: "13px", fontFamily: "inherit",
              lineHeight: 1.5,
            }}
          />
        </div>
        <button
          onClick={() => send()}
          disabled={loading || !input.trim()}
          style={{
            background: loading ? "#1f6feb44" : "#1f6feb",
            border: "none", borderRadius: "8px",
            padding: "10px 18px", cursor: loading ? "not-allowed" : "pointer",
            color: "#fff", fontSize: "12px", fontFamily: "inherit", fontWeight: 600,
            opacity: (!input.trim() && !loading) ? 0.4 : 1,
            transition: "all 0.15s",
            minWidth: "60px",
          }}
        >
          {loading ? "…" : "SEND"}
        </button>
      </div>
    </div>
  );
}
