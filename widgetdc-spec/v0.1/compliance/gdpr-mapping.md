# GDPR Compliance Mapping — WidgeTDC Agent-MRP

**Version:** v0.1  
**Regulation:** GDPR (EU) 2016/679  
**Last reviewed:** 2026-04-11

---

## Article Mapping

| GDPR Article | Requirement | WidgeTDC Control | Status |
|-------------|-------------|------------------|--------|
| Art. 5(1)(f) | Integrity and confidentiality | ADR-003 hash-chain audit trail | ✅ Implemented |
| Art. 17 | Right to erasure | DeletionEvent + KMS crypto-shredding (Phase 3) | 🟡 Phase 3 |
| Art. 25 | Data protection by design | `sov_data_residency` enforced at routing | ✅ Implemented |
| Art. 30 | Records of processing activities | EvidenceObject chain = processing log | ✅ Implemented |
| Art. 32 | Security of processing | TEE Context Folding for PII routes (Phase 3) | 🟡 Phase 3 |
| Art. 44 | Transfers to third countries | `sov_exec_residency` blocks non-EU exec for EU routes | ✅ Implemented |

## Routing Rules (GDPR-safe configuration)

```yaml
# Safe routing policy for EU personal data
policy:
  require_sov_data_residency: EU
  require_sov_exec_residency: EU
  block_geo: [CN, US]  # for personal data routes
  validity_gate: 0.75
  hitl_threshold: 0.70
```

## Gaps

- **Art. 17 (erasure):** Requires Phase 3 TEE + KMS crypto-shredding. Until then, manual deletion process only.
- **Art. 32 (TEE):** Software-only folding active. Hardware TEE pending Phase 3 deployment.
- **DPA registration:** Required before processing personal data via routed agents.

## Notes

The `sov_data_residency` / `sov_exec_residency` dual-property model (ADR-001) explicitly separates storage jurisdiction from compute jurisdiction. This satisfies Schrems II requirements for EU-resident data.
