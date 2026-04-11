/** 
 * Validate the EXACT fix: call_mcp_tool with flat args (external agent format)
 * Uses the MCP backend route which we know works (same auth we use for MCP tools)
 */
import { execSync } from 'child_process';

const BACKEND = 'https://backend-production-d3da.up.railway.app';
const API_KEY = 'Heravej_22';

async function callMcp(tool, payload) {
  const res = await fetch(`${BACKEND}/api/mcp/route`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ tool, payload })
  });
  return res.json();
}

async function test() {
  console.log('=== Validation: call_mcp_tool with flat args (external agent format) ===\n');

  // Test: Use call_mcp_tool to call chat_read with FLAT args (no payload wrapper)
  // This simulates what ChatGPT/external agents do
  console.log('Test: call_mcp_tool → chat_read with flat args');
  console.log('  Input: {tool_name: "chat_read", thread_id: "general", limit: 3}');
  
  const result = await callMcp('call_mcp_tool', {
    tool_name: 'chat_read',
    thread_id: 'general',
    limit: 3
  });
  
  console.log(`  Response: ${JSON.stringify(result).slice(0, 300)}`);
  const success = result.result && !result.error;
  console.log(`  Status: ${success ? '✅ PASS' : '❌ FAIL'}`);

  console.log('\n=== Validation: chat_send direct ===\n');
  
  const sendResult = await callMcp('chat_send', {
    from: 'test-validator',
    to: 'qwen',
    message: 'Flat args validation ping',
    thread_id: 'test-validation'
  });
  
  console.log('Test: chat_send direct with flat args');
  console.log(`  Response: ${JSON.stringify(sendResult).slice(0, 300)}`);
  const sendSuccess = sendResult.result && !sendResult.error;
  console.log(`  Status: ${sendSuccess ? '✅ PASS' : '❌ FAIL'}`);

  console.log('\n=== Validation: chat_read direct ===\n');
  
  const readResult = await callMcp('chat_read', {
    thread_id: 'test-validation',
    limit: 3
  });
  
  console.log('Test: chat_read direct with flat args');
  console.log(`  Response: ${JSON.stringify(readResult).slice(0, 300)}`);
  const readSuccess = readResult.result && !readResult.error;
  console.log(`  Status: ${readSuccess ? '✅ PASS' : '❌ FAIL'}`);

  console.log('\n=== SUMMARY ===');
  console.log(`call_mcp_tool (flat args): ${success ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`chat_send (direct):        ${sendSuccess ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`chat_read (direct):        ${readSuccess ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPass = success && sendSuccess && readSuccess;
  console.log(`\nOverall: ${allPass ? '✅ ALL PASS — External agent MCP comms validated' : '❌ SOME FAILED'}`);
  process.exit(allPass ? 0 : 1);
}

test().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
