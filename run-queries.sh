#!/bin/bash
echo "=== QUERY 6: EmergentPattern ==="
curl -s -X POST "https://backend-production-d3da.up.railway.app/api/mcp/route" \
  -H "Authorization: Bearer Heravej_22" \
  -H "Content-Type: application/json" \
  -d '{"tool":"graph.read_cypher","args":{"query":"MATCH (e:EmergentPattern) RETURN e.name, e.description, e.confidence, e.category ORDER BY e.confidence DESC LIMIT 20"}}'

echo ""
echo "=== QUERY 7: StrategicInsight ==="
curl -s -X POST "https://backend-production-d3da.up.railway.app/api/mcp/route" \
  -H "Authorization: Bearer Heravej_22" \
  -H "Content-Type: application/json" \
  -d '{"tool":"graph.read_cypher","args":{"query":"MATCH (i:StrategicInsight) WHERE i.title IS NOT NULL AND (toLower(i.title) CONTAINS '"'"'graph'"'"' OR toLower(i.title) CONTAINS '"'"'agent'"'"' OR toLower(i.title) CONTAINS '"'"'evolution'"'"' OR toLower(i.title) CONTAINS '"'"'rag'"'"' OR toLower(i.title) CONTAINS '"'"'knowledge'"'"' OR toLower(i.title) CONTAINS '"'"'learning'"'"') RETURN i.title, i.domain, substring(coalesce(i.description,'"'"''"'"'), 0, 200) AS desc LIMIT 20"}}'

echo ""
echo "=== QUERY 8: HarvestedKnowledge ==="
curl -s -X POST "https://backend-production-d3da.up.railway.app/api/mcp/route" \
  -H "Authorization: Bearer Heravej_22" \
  -H "Content-Type: application/json" \
  -d '{"tool":"graph.read_cypher","args":{"query":"MATCH (d:Document:HarvestedKnowledge) WHERE d.title IS NOT NULL AND (toLower(d.title) CONTAINS '"'"'graph'"'"' OR toLower(d.title) CONTAINS '"'"'rag'"'"' OR toLower(d.title) CONTAINS '"'"'knowledge'"'"' OR toLower(d.title) CONTAINS '"'"'evolution'"'"' OR toLower(d.title) CONTAINS '"'"'neural'"'"') RETURN d.title, d.source, substring(coalesce(d.content,'"'"''"'"'), 0, 300) AS preview LIMIT 15"}}'

echo ""
echo "=== QUERY 1: SRAG evolution ==="
curl -s -X POST "https://orchestrator-production-c27e.up.railway.app/tools/call" \
  -H "Authorization: Bearer WidgeTDC_Orch_2026" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"omega","tool_name":"srag.query","arguments":{"query":"graph evolution self-improving knowledge graph RAG context folding"},"call_id":"f47ac10b-58cc-4372-a567-0e02b2c3d479"}'

echo ""
echo "=== QUERY 2: SRAG research ==="
curl -s -X POST "https://orchestrator-production-c27e.up.railway.app/tools/call" \
  -H "Authorization: Bearer WidgeTDC_Orch_2026" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"omega","tool_name":"srag.query","arguments":{"query":"knowledge graph enrichment automated reasoning learning from failures"},"call_id":"550e8400-e29b-41d4-a716-446655440000"}'

echo ""
echo "=== QUERY 9: CMA context ==="
curl -s -X POST "https://orchestrator-production-c27e.up.railway.app/tools/call" \
  -H "Authorization: Bearer WidgeTDC_Orch_2026" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"cma","tool_name":"cma.context","arguments":{"keywords":["graph evolution","knowledge graph","RAG","context folding","self-improving"]},"call_id":"6ba7b810-9dad-11d1-80b4-00c04fd430c8"}'

echo ""
echo "=== QUERY 10: RLM reason ==="
curl -s -X POST "https://orchestrator-production-c27e.up.railway.app/cognitive/reason" \
  -H "Authorization: Bearer WidgeTDC_Orch_2026" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"What are the most promising approaches for self-evolving knowledge graphs that combine RAG, context folding, and reinforcement learning from failures? Consider our system: 130k+ Neo4j nodes, 8 memory layers, 18 agents, multi-agent swarm. What should our evolution strategy be?","task":"graph evolution research","depth":2}'
