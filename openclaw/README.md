# OpenClaw Multi-Agent Gateway & Skills (`openclaw/`)

This directory contains the complete OpenClaw Multi-Agent Gateway implementation, agent definitions, and executable skills designed for the **Dark Coders AI & Agent Engineering Assignment**.

---

## 1. Architecture Overview

```text
[ Voice Console / Frontend ]
          │  (SSE Streaming / Hold-to-Talk)
          ▼
[ POST /api/agent (TanStack Start Bridge) ]
          │
          ▼
[ OpenClaw Gateway :18789 ]  ◄─── (openclaw/gateway.js)
   │
   ├── [ dc-orchestrator ] ── Routes voice intents & app controls
   ├── [ sre-sentinel ]    ── Incident triage & crash-loop analysis
   └── [ ciso-guardian ]   ── Dependency & CVE security audit
          │
          ├── Skills & Tools:
          │    ├── system.health             (Read-only, live OS metrics)
          │    ├── cluster.service_status    (Read-only, worker & probe telemetry)
          │    ├── logs.analyze              (Read-only, error stack trace parsing)
          │    ├── security.audit            (Read-only, package vulnerability scanner)
          │    └── ops.restart_service       [ACTION PROPOSAL REQUIRED: MEDIUM RISK]
          │
          └── Upstream LLM:
               └── Google Gemini (gemini-flash-latest via OpenAI-compatible endpoint)
```

---

## 2. Implemented Agents

| Agent ID | Role | Persona & Responsibilities |
| :--- | :--- | :--- |
| **`dc-orchestrator`** | Root Dispatcher | Classifies intent, synthesizes voice-ready screens, coordinates specialists. |
| **`sre-sentinel`** | SRE & Incident Lead | Diagnoses broken workers, inspects probe timeouts, proposes safe restarts. |
| **`ciso-guardian`** | Security Auditor | Audits npm package vulnerabilities, enforces principle of least privilege. |

---

## 3. Human-in-the-Loop Safety & Action Proposals

In accordance with Dark Coders core principles, **read-only tools run directly**, but **state-changing operations never execute autonomously**:

1. **Detection:** When `sre-sentinel` identifies that `worker-02` in `staging-worker` is crash-looping due to readiness probe memory exhaustion, it prepares an **Action Proposal**:
   ```json
   {
     "id": "act_restart_worker02",
     "title": "Restart staging worker",
     "tool": "ops.restart_service",
     "summary": "Gracefully restarts worker-02 after draining active jobs to clear heap exhaustion.",
     "risk": "medium"
   }
   ```
2. **Approval Gate:** The console catches this in the **Approval Panel** with **Approve / Deny** buttons.
3. **Execution on Approval:** When the operator clicks `Approve`, the confirmation turn is received:
   `"Approved action [act_restart_worker02] (Restart staging worker via ops.restart_service)"`
   The gateway verifies human authorization, drains the active connections, restarts the container, verifies the HTTP 200 health check, and confirms the green state via voice.
4. **Safety on Denial:** If denied, the gateway aborts execution, leaves the worker untouched, and logs the refusal.

---

## 4. Directory Structure

```text
openclaw/
├── README.md               # Architecture documentation, design decisions, & quickstart
├── gateway.yaml            # Declarative gateway configuration & tool risk classifications
├── gateway.js              # Native Node.js OpenClaw HTTP & SSE Gateway server
├── gateway.test.js         # Automated test suite (100% pass)
├── agents/
│   ├── orchestrator.json   # dc-orchestrator system prompt & skills
│   ├── sre-sentinel.json   # SRE specialist configuration & approval policy
│   └── ciso-guardian.json  # CISO security auditor profile
└── skills/
    ├── system_health.js    # Live CPU, memory, load average, and uptime inspector
    ├── service_status.js   # Live cluster workers & readiness probe monitor
    ├── log_analyzer.js     # Log stream parser & error stack trace extractor
    ├── ops_actions.js      # Graceful drain & restart with state transition
    └── security_audit.js   # Vulnerability scan via npm audit
```

---

## 5. Quickstart

### Step 1: Start OpenClaw Gateway
In the root directory or `living-ai-talk`:
```bash
npm run openclaw
```
The gateway will start on `http://localhost:18789` connected to Google Gemini upstream.

### Step 2: Start the Frontend Console
In a second terminal:
```bash
npm run dev
```
Open **[http://localhost:8080/](http://localhost:8080/)** in your browser.

### Step 3: Try It Out
1. **Talk to it:** Say or type: *"Check the staging worker - it keeps dying"*.
2. **Watch it think:** The live steps show `Planning` → `Thinking` (streamed reasoning) → `Synthesizing`.
3. **Review the Proposal:** Look at the **Approval Panel** on the right side. You will see:
   `● MEDIUM RISK: Restart staging worker via ops.restart_service`.
4. **Approve:** Click **✓ Approve**. The agent executes the drain, restarts `worker-02`, and announces that the cluster is healthy again.

---

## 6. How AI Tools Helped

As instructed by the assignment ground rules:
* **Scaffolding and Type Verification:** Used AI assistance to inspect the TanStack Start routing pipeline (`src/routes/api/agent.ts`) and ensure 100% type alignment between OpenClaw's server output and the console's `Screen` parser.
* **Test Case Generation:** Leveraged AI pair programming to write comprehensive unit and end-to-end integration tests in `openclaw/gateway.test.js` covering both streaming SSE and JSON schema contracts.
* **Architecture Critique:** Used AI to review edge cases in the human-in-the-loop approval lifecycle, ensuring no destructive action can ever execute without explicit human authorization.
