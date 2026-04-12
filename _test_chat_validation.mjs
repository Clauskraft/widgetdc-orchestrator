/** Test that call_mcp_tool works with BOTH payload and flat args formats */

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

async function test() {
  const BASE = 'https://orchestrator-production-c27e.up.railway.app';
  const API_KEY = process.env.ORCHESTRATOR_API_KEY || 'WidgeTDC_Orch_2026';
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`,
  };

  // Test 1: call_mcp_tool WITH payload (internal format)
  console.log('\n=== Test 1: call_mcp_tool WITH payload ===');
  const r1 = await fetch(`${BASE}/tools/call`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      agent_id: 'test-runner',
      tool_name: 'call_mcp_tool',
      arguments: {
        tool_name: 'chat_read',
        payload: { thread_id: 'general', limit: 2 }
      },
      call_id: uuid()
    })
  });
  const d1 = await r1.json();
  console.log(`Status: ${r1.status} | Body: ${JSON.stringify(d1).slice(0, 200)}`);

  // Test 2: call_mcp_tool WITH FLAT args (external agent format — this was broken)
  console.log('\n=== Test 2: call_mcp_tool with FLAT args (external format) ===');
  const r2 = await fetch(`${BASE}/tools/call`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      agent_id: 'test-runner',
      tool_name: 'call_mcp_tool',
      arguments: {
        tool_name: 'chat_read',
        thread_id: 'general',
        limit: 2
      },
      call_id: uuid()
    })
  });
  const d2 = await r2.json();
  console.log(`Status: ${r2.status} | Result: ${d2.status} | Error: ${d2.error_message || 'none'}`);

  // Test 3: chat_send directly with flat args
  console.log('\n=== Test 3: chat_send direct (flat args) ===');
  const r3 = await fetch(`${BASE}/tools/call`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      agent_id: 'test-runner',
      tool_name: 'chat_send',
      arguments: {
        from: 'test-runner',
        to: 'qwen',
        message: 'Direct flat args test',
        thread_id: 'test-validation'
      },
      call_id: uuid()
    })
  });
  const d3 = await r3.json();
  console.log(`Status: ${r3.status} | Result: ${d3.status} | Error: ${d3.error_message || 'none'}`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Test 1 (payload format):    ${d1.status === 'success' ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 2 (flat args format):  ${d2.status === 'success' ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 3 (chat_send direct):  ${d3.status === 'success' ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPass = d1.status === 'success' && d2.status === 'success' && d3.status === 'success';
  console.log(`\nOverall: ${allPass ? '✅ ALL PASS' : '❌ SOME FAILED'}`);
  process.exit(allPass ? 0 : 1);
}

test().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
