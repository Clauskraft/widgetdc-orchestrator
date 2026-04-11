// ============================================================================
// WidgeTDC v1.2.1 Graph Schema
// Status: INTERNAL EXECUTION (Micro-Corrections Applied)
// Fixes: JSON Serialization, Evidence Chaining, External IDs, Semantic Mapping
// ============================================================================

// --- 1. CONSTRAINTS & INDEXES ---

// Unique constraints on external IDs (Stable references)
CREATE CONSTRAINT IF NOT EXISTS agent_ext_id_unique FOR (a:Agent) REQUIRE a.external_id IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS evidence_ext_id_unique FOR (e:EvidenceObject) REQUIRE e.external_id IS UNIQUE;
CREATE CONSTRAINT IF NOT EXISTS cluster_ext_id_unique FOR (c:PhantomCluster) REQUIRE c.external_id IS UNIQUE;

// Indexes for fast lookups on flat properties
CREATE INDEX IF NOT EXISTS agent_capability_idx FOR (a:Agent) ON (a.capabilities);
CREATE INDEX IF NOT EXISTS evidence_verification_idx FOR (e:EvidenceObject) ON (e.verification_status);
CREATE INDEX IF NOT EXISTS evidence_hash_idx FOR (e:EvidenceObject) ON (e.payload_hash);

// --- 2. NODE INGESTION PATTERNS ---

// 🔹 Agent Node
MERGE (a:Agent {external_id: $agent_id})
SET
  a.provider = $provider,
  a.capabilities = $capabilities, // List<String>
  a.rules_json = $rules_json,     // JSON String (Fix #1)
  a.last_updated = datetime();

// 🔹 PhantomCluster Node (Runtime representation of FantomModule)
MERGE (c:PhantomCluster {external_id: $cluster_id})
SET
  c.type = 'Fantom_Assembly',
  c.name = $name,
  c.validity_score = toFloat($validity_score);

// 🔹 EvidenceObject Node (ADR-003 Compliant)
MERGE (e:EvidenceObject {external_id: $evidence_id})
SET
  e.subject_ref = $subject_ref,
  e.producer = $producer,
  e.evidence_class = $evidence_class,
  e.payload_json = $payload_json,   // JSON String (Fix #1)
  e.payload_hash = $payload_hash,
  e.previous_hash = $previous_hash,
  e.verification_status = 'PENDING';

// --- 3. RELATIONSHIPS (Corrected) ---

// Agent -> Cluster Assignment
MATCH (a:Agent {external_id: $agent_id}), (c:PhantomCluster {external_id: $cluster_id})
MERGE (a)-[:PART_OF {assigned_at: datetime()}]->(c);

// 🔗 Evidence Chain (Fix #2: Links objects for traversal)
MATCH (prev:EvidenceObject {external_id: $prev_id}), (curr:EvidenceObject {external_id: $curr_id})
MERGE (prev)-[:NEXT_IN_CHAIN {created_at: datetime()}]->(curr);

// Evidence -> Subject Link (Fix #3: No id() usage)
MATCH (e:EvidenceObject {external_id: $evidence_id})
MATCH (s) WHERE s.external_id = $subject_ref
MERGE (e)-[:EVIDENCE_FOR]->(s);

// --- 4. DoD VALIDATION QUERIES (Fixed for v1.2.1) ---

// ✅ Query 1: Verify Evidence Chain Traversal (Fix #2)
MATCH path = (start:EvidenceObject)-[:NEXT_IN_CHAIN*]->(end:EvidenceObject)
WHERE start.external_id = $start_evidence_id
RETURN length(path) AS chain_length, collect(end.external_id) AS chain_nodes
ORDER BY chain_length DESC LIMIT 5;
