# NordicFin ApS — EU AI Act Annex III Compliance Audit

**Audit ID:** ai-act-mnwf44go
**Generated:** 2026-04-12T23:51:48.120Z
**Components audited:** 5
**Compliance score:** 48.6/100

## Executive summary

CRITICAL: 2 critical gaps found across 5 component(s). Immediate remediation required before AI Act enforcement deadline (Aug 2026). 11 components are non-compliant.

## Gap breakdown

| Severity | Count |
|----------|-------|
| 🔴 Critical | 2 |
| 🟠 High | 10 |
| 🟡 Medium | 11 |
| 🟢 Low | 12 |

## Gaps in detail

### HIGH — Art. 8: Risk Management System for high-risk AI

- **Status:** non-compliant
- **Affected:** credit-scorer-ml
- **Evidence:** No risk assessment found
- **Remediation:** Implement continuous risk management process per Annex III. Document all known and foreseeable risks. Define risk mitigation measures.
- **Deadline:** 2026-08-02

### LOW — Art. 9: Data governance

- **Status:** compliant
- **Affected:** credit-scorer-ml
- **Evidence:** PII processing without governance
- **Remediation:** Maintain current governance
- **Deadline:** 2026-08-02

### LOW — Art. 10: Technical documentation for high-risk AI systems

- **Status:** compliant
- **Affected:** credit-scorer-ml
- **Evidence:** Documentation present
- **Remediation:** Create technical documentation per Annex IV: system architecture, training data, performance metrics, validation results.
- **Deadline:** 2026-08-02

### LOW — Art. 12: Automatically generated logs for high-risk AI systems

- **Status:** compliant
- **Affected:** credit-scorer-ml
- **Evidence:** Logs retained: 90 days
- **Remediation:** Implement automatic logging with minimum 90-day retention. Include: input data, output, timestamp, operator ID, system state.
- **Deadline:** 2026-08-02

### HIGH — Art. 13: Transparency obligations — users must be informed they interact with AI

- **Status:** non-compliant
- **Affected:** credit-scorer-ml
- **Evidence:** No transparency notice found
- **Remediation:** Implement clear user notification: "This system uses AI technology." Provide instructions for use, performance characteristics, and limitations.
- **Deadline:** 2026-08-02

### CRITICAL — Art. 14: Human oversight measures for high-risk AI systems

- **Status:** non-compliant
- **Affected:** credit-scorer-ml
- **Evidence:** No human oversight mechanism found
- **Remediation:** Implement human-in-the-loop oversight: (1) Manual override capability, (2) Human review before critical decisions, (3) Stop/interrupt button, (4) Training for human overseers.
- **Deadline:** 2026-08-02

### HIGH — Art. 15: Achieve appropriate levels of accuracy, robustness, and cybersecurity

- **Status:** non-compliant
- **Affected:** credit-scorer-ml
- **Evidence:** No accuracy/robustness monitoring detected
- **Remediation:** Implement: (1) Accuracy metrics with thresholds, (2) Robustness testing against adversarial inputs, (3) Cybersecurity measures per ENISA guidelines, (4) Regular performance validation.
- **Deadline:** 2026-08-02

### HIGH — Art. 8: Risk Management System for high-risk AI

- **Status:** partial
- **Affected:** aml-transaction-monitor
- **Evidence:** Risk assessment documented
- **Remediation:** Implement continuous risk management process per Annex III. Document all known and foreseeable risks. Define risk mitigation measures.
- **Deadline:** 2026-08-02

### LOW — Art. 9: Data governance

- **Status:** compliant
- **Affected:** aml-transaction-monitor
- **Evidence:** PII processing without governance
- **Remediation:** Maintain current governance
- **Deadline:** 2026-08-02

### MEDIUM — Art. 10: Technical documentation for high-risk AI systems

- **Status:** partial
- **Affected:** aml-transaction-monitor
- **Evidence:** Documentation missing or incomplete
- **Remediation:** Create technical documentation per Annex IV: system architecture, training data, performance metrics, validation results.
- **Deadline:** 2026-08-02

### LOW — Art. 12: Automatically generated logs for high-risk AI systems

- **Status:** compliant
- **Affected:** aml-transaction-monitor
- **Evidence:** Logs retained: 365 days
- **Remediation:** Implement automatic logging with minimum 90-day retention. Include: input data, output, timestamp, operator ID, system state.
- **Deadline:** 2026-08-02

### HIGH — Art. 13: Transparency obligations — users must be informed they interact with AI

- **Status:** non-compliant
- **Affected:** aml-transaction-monitor
- **Evidence:** No transparency notice found
- **Remediation:** Implement clear user notification: "This system uses AI technology." Provide instructions for use, performance characteristics, and limitations.
- **Deadline:** 2026-08-02

### MEDIUM — Art. 14: Human oversight measures for high-risk AI systems

- **Status:** compliant
- **Affected:** aml-transaction-monitor
- **Evidence:** Human oversight implemented
- **Remediation:** Implement human-in-the-loop oversight: (1) Manual override capability, (2) Human review before critical decisions, (3) Stop/interrupt button, (4) Training for human overseers.
- **Deadline:** 2026-08-02

### MEDIUM — Art. 15: Achieve appropriate levels of accuracy, robustness, and cybersecurity

- **Status:** partial
- **Affected:** aml-transaction-monitor
- **Evidence:** Monitoring in place
- **Remediation:** Implement: (1) Accuracy metrics with thresholds, (2) Robustness testing against adversarial inputs, (3) Cybersecurity measures per ENISA guidelines, (4) Regular performance validation.
- **Deadline:** 2026-08-02

### LOW — Art. 8: Risk Management System

- **Status:** not-assessed
- **Affected:** customer-chatbot
- **Evidence:** Risk level: limited
- **Remediation:** Consider risk assessment for future classification
- **Deadline:** 2026-08-02

### MEDIUM — Art. 9: Data governance

- **Status:** not-assessed
- **Affected:** customer-chatbot
- **Evidence:** No PII detected
- **Remediation:** Document data processing practices
- **Deadline:** 2026-08-02

### MEDIUM — Art. 10: Technical documentation for high-risk AI systems

- **Status:** partial
- **Affected:** customer-chatbot
- **Evidence:** Documentation missing or incomplete
- **Remediation:** Create technical documentation per Annex IV: system architecture, training data, performance metrics, validation results.
- **Deadline:** 2026-08-02

### MEDIUM — Art. 12: Automatically generated logs for high-risk AI systems

- **Status:** partial
- **Affected:** customer-chatbot
- **Evidence:** Logs retained: 30 days
- **Remediation:** Implement automatic logging with minimum 90-day retention. Include: input data, output, timestamp, operator ID, system state.
- **Deadline:** 2026-08-02

### LOW — Art. 13: Transparency obligations — users must be informed they interact with AI

- **Status:** compliant
- **Affected:** customer-chatbot
- **Evidence:** Transparency notice present
- **Remediation:** Implement clear user notification: "This system uses AI technology." Provide instructions for use, performance characteristics, and limitations.
- **Deadline:** 2026-08-02

### MEDIUM — Art. 14: Human oversight measures for high-risk AI systems

- **Status:** compliant
- **Affected:** customer-chatbot
- **Evidence:** Human oversight implemented
- **Remediation:** Implement human-in-the-loop oversight: (1) Manual override capability, (2) Human review before critical decisions, (3) Stop/interrupt button, (4) Training for human overseers.
- **Deadline:** 2026-08-02

### MEDIUM — Art. 15: Achieve appropriate levels of accuracy, robustness, and cybersecurity

- **Status:** partial
- **Affected:** customer-chatbot
- **Evidence:** Monitoring in place
- **Remediation:** Implement: (1) Accuracy metrics with thresholds, (2) Robustness testing against adversarial inputs, (3) Cybersecurity measures per ENISA guidelines, (4) Regular performance validation.
- **Deadline:** 2026-08-02

### HIGH — Art. 8: Risk Management System for high-risk AI

- **Status:** non-compliant
- **Affected:** kyc-document-parser
- **Evidence:** No risk assessment found
- **Remediation:** Implement continuous risk management process per Annex III. Document all known and foreseeable risks. Define risk mitigation measures.
- **Deadline:** 2026-08-02

### HIGH — Art. 9: Data governance for AI systems using personal data

- **Status:** non-compliant
- **Affected:** kyc-document-parser
- **Evidence:** PII data types detected: pii, biometric, financial
- **Remediation:** Implement data governance framework: data collection, processing, retention policies. Document data lineage and quality controls.
- **Deadline:** 2026-08-02

### MEDIUM — Art. 10: Technical documentation for high-risk AI systems

- **Status:** partial
- **Affected:** kyc-document-parser
- **Evidence:** Documentation missing or incomplete
- **Remediation:** Create technical documentation per Annex IV: system architecture, training data, performance metrics, validation results.
- **Deadline:** 2026-08-02

### LOW — Art. 12: Automatically generated logs for high-risk AI systems

- **Status:** compliant
- **Affected:** kyc-document-parser
- **Evidence:** Logs retained: 180 days
- **Remediation:** Implement automatic logging with minimum 90-day retention. Include: input data, output, timestamp, operator ID, system state.
- **Deadline:** 2026-08-02

### HIGH — Art. 13: Transparency obligations — users must be informed they interact with AI

- **Status:** non-compliant
- **Affected:** kyc-document-parser
- **Evidence:** No transparency notice found
- **Remediation:** Implement clear user notification: "This system uses AI technology." Provide instructions for use, performance characteristics, and limitations.
- **Deadline:** 2026-08-02

### CRITICAL — Art. 14: Human oversight measures for high-risk AI systems

- **Status:** non-compliant
- **Affected:** kyc-document-parser
- **Evidence:** No human oversight mechanism found
- **Remediation:** Implement human-in-the-loop oversight: (1) Manual override capability, (2) Human review before critical decisions, (3) Stop/interrupt button, (4) Training for human overseers.
- **Deadline:** 2026-08-02

### HIGH — Art. 15: Achieve appropriate levels of accuracy, robustness, and cybersecurity

- **Status:** non-compliant
- **Affected:** kyc-document-parser
- **Evidence:** No accuracy/robustness monitoring detected
- **Remediation:** Implement: (1) Accuracy metrics with thresholds, (2) Robustness testing against adversarial inputs, (3) Cybersecurity measures per ENISA guidelines, (4) Regular performance validation.
- **Deadline:** 2026-08-02

### LOW — Art. 8: Risk Management System

- **Status:** not-assessed
- **Affected:** fraud-alert-queue
- **Evidence:** Risk level: limited
- **Remediation:** Consider risk assessment for future classification
- **Deadline:** 2026-08-02

### LOW — Art. 9: Data governance

- **Status:** compliant
- **Affected:** fraud-alert-queue
- **Evidence:** PII processing without governance
- **Remediation:** Maintain current governance
- **Deadline:** 2026-08-02

### LOW — Art. 10: Technical documentation for high-risk AI systems

- **Status:** compliant
- **Affected:** fraud-alert-queue
- **Evidence:** Documentation present
- **Remediation:** Create technical documentation per Annex IV: system architecture, training data, performance metrics, validation results.
- **Deadline:** 2026-08-02

### LOW — Art. 12: Automatically generated logs for high-risk AI systems

- **Status:** compliant
- **Affected:** fraud-alert-queue
- **Evidence:** Logs retained: 730 days
- **Remediation:** Implement automatic logging with minimum 90-day retention. Include: input data, output, timestamp, operator ID, system state.
- **Deadline:** 2026-08-02

### HIGH — Art. 13: Transparency obligations — users must be informed they interact with AI

- **Status:** non-compliant
- **Affected:** fraud-alert-queue
- **Evidence:** No transparency notice found
- **Remediation:** Implement clear user notification: "This system uses AI technology." Provide instructions for use, performance characteristics, and limitations.
- **Deadline:** 2026-08-02

### MEDIUM — Art. 14: Human oversight measures for high-risk AI systems

- **Status:** compliant
- **Affected:** fraud-alert-queue
- **Evidence:** Human oversight implemented
- **Remediation:** Implement human-in-the-loop oversight: (1) Manual override capability, (2) Human review before critical decisions, (3) Stop/interrupt button, (4) Training for human overseers.
- **Deadline:** 2026-08-02

### MEDIUM — Art. 15: Achieve appropriate levels of accuracy, robustness, and cybersecurity

- **Status:** partial
- **Affected:** fraud-alert-queue
- **Evidence:** Monitoring in place
- **Remediation:** Implement: (1) Accuracy metrics with thresholds, (2) Robustness testing against adversarial inputs, (3) Cybersecurity measures per ENISA guidelines, (4) Regular performance validation.
- **Deadline:** 2026-08-02
