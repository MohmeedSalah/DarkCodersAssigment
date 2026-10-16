# OpenClaw Multi-Agent Voice & Spatial Console (`living-ai-talk`)

> **Dark Coders AI & Agent Engineering Take-Home Challenge**  
> An autonomous multi-agent engineering team connected to a voice, chat, and 3D WebXR console built on **OpenClaw**.

---

## 1. What We Built

We designed and implemented a production-grade multi-agent runtime on **OpenClaw** that gives the voice console a real, intelligent engineering brain capable of taking concrete operational actions with safety guardrails.

### The Agent Team
1. **`dc-orchestrator` (Dark Coders Root Orchestrator)**: The primary gateway coordinator. It classifies user voice and text intent, performs routing across specialized agents and tools, and synthesizes clear, conversational spoken summaries.
2. **`devops-sentinel` (DevOps Sentinel)**: Dedicated to live traffic and infrastructure monitoring. It inspects real-time request rates (RPS), p95 latency percentiles, error rate anomalies (5xx spikes), and recent log buffers.
3. **`backend-expert` (Backend Architect)**: Principal backend engineering specialist. It answers complex technical inquiries regarding database query tuning (SQL/PostgreSQL), scalable REST/GraphQL API design, caching strategies, microservices, and concurrency.
4. **`sre-sentinel` (SRE Sentinel)**: Focuses on cluster stability, crash loop diagnosis (such as OOMKilled containers failing readiness probes), and recovery operations.
5. **`ciso-guardian` (CISO Guardian)**: Scans dependencies for known CVE vulnerabilities and audits security access policies.

### Real Tools & Skills
* **`traffic.monitor`**: Measures live HTTP throughput, active request rates (RPS), latency percentiles (p50/p95/p99), and status code breakdown.
* **`system.health`**: Gathers live host OS telemetry (CPU cores, memory usage percentage, system uptime).
* **`cluster.service_status`**: Queries cluster service health and detects failing readiness/liveness probes.
* **`logs.analyze`**: Scans container log streams and isolates root cause exceptions.
* **`security.audit_dependencies`**: Audits installed project packages for vulnerabilities.
* **`ops.restart_service` & `ops.rollback_deployment`**: Real state-changing recovery operations.

### Safety & Approval Gates (Human-in-the-Loop)
* High- and medium-risk actions (e.g. restarting services, rolling back deployments) **never execute autonomously**.
* The agent returns a structured `action_proposal` to the console. The action remains pending until an operator explicitly clicks **Approve** or **Deny**.

### Dual-Port Compatibility
* **Port 18789**: Native OpenClaw Multi-Agent Gateway supporting SSE streaming, OpenAI-compatible chat completions (`/v1/chat/completions`), and ASR transcriptions.
* **Port 8000**: Dedicated secondary OpenAI Whisper-compatible ASR bridge for local speech recognition tools.

---

## 2. The Calls We Made (Key Technical & Architectural Decisions)

1. **Strict OpenClaw Screen Contract**:
   Instead of raw markdown text that disrupts text-to-speech, all agent turns strictly adhere to the OpenClaw screen schema:
   ```json
   {
     "kind": "screen",
     "screen": {
       "text": "Plain spoken text without markdown or emojis for clean TTS.",
       "choices": [{ "id": "check_traffic", "label": "Live traffic", "value": "Monitor live network traffic" }],
       "navigation": ["home"]
     },
     "action_proposal": null,
     "app_commands": []
   }
   ```
2. **Speech-First Text Sanitization**:
   Stripped all markdown asterisks, backticks, emojis, and codeblocks from spoken fields (`screen.text`) so local Kokoro TTS and browser voice engines speak naturally without pronouncing punctuation artifacts.
3. **MIME Sanitization for Multimodal Audio**:
   Browsers send audio recordings with extended codec metadata (e.g., `audio/webm;codecs=opus`), which upstream multimodal APIs reject with `400 INVALID_ARGUMENT`. We implemented automatic MIME stripping to clean `audio/webm` and `audio/wav` formats.
4. **Transparent Error Handling & Zero Fake Data (Adhering to Dark Coders Ground Rules)**:
   * *Rule*: *"No fake results. If something fails, show the real error. Never swap in fake data behind the scenes."*
   * When Google Gemini free tier daily quota is reached (HTTP 429 `RESOURCE_EXHAUSTED`), the system does **not** fall back to fake mock questions or mock answers. Instead, it catches the 429 status and transparently displays an explicit, friendly quota notice on the console screen with guidance on updating `.env`.
5. **Configurability via Native Node `.env` Loader**:
   Zero extra third-party dependencies for configuration; natively loads `.env` using Node 20.6+ native loader with fallback chaining across models (`gemini-3.5-flash`, `gemini-3.6-flash`, etc.).

---

## 3. Where AI Helped vs. Where We Stepped In

### Where AI Helped
* **Rapid Prototyping & Scaffolding**: Fast generation of initial agent JSON templates (`openclaw/agents/`) and declarative YAML manifest schemas (`gateway.yaml`).
* **Test Suite Expansion**: Accelerating mock request creation and assertions for HTTP streaming and JSON payloads in `openclaw/gateway.test.js`.
* **Persona Calibration**: Generating natural, polite prompt instructions suited for both Arabic and English voice conversations.

### Where We Stepped In (Critical Engineering & Debugging)
* **Eliminating the Hidden Fake Fallback Loop**:
  * *The Bug*: When audio transcription failed (e.g., due to API rate limits), an earlier template code had a fallback:
    ```javascript
    if (!text) text = "Check the staging worker - it keeps dying";
    ```
    This caused the system to perpetually submit the worker question on behalf of the user, resulting in a confusing loop where the agent always answered with the Worker-02 crash response.
  * *Our Intervention*: We diagnosed the exact root cause, completely ripped out all fake fallback strings, and implemented authentic error propagation and HTTP 429 quota guard handlers.
* **MIME Header Normalization**:
  * AI initially piped raw `file.type` directly to Google Gemini. Gemini failed with `400 INVALID_ARGUMENT` due to `codecs=opus`. We stepped in and implemented sanitization logic to strip codec parameters before transmission.
* **Human-in-the-Loop Approval Verification**:
  * AI initially executed restart commands directly when asked by the user. We enforced Dark Coders safety requirements by mandating an `actionProposal` emission first, requiring verified human approval (`Approved action [...]`) before execution.

---

## 4. Quick Start

### 1. Prerequisites & Installation
* Node.js v20.6+ (or later)

```bash
# Clone the repository
git clone https://github.com/MohmeedSalah/DarkCodersAssigment.git
cd DarkCodersAssigment

# Install project dependencies
npm install

# Configure environment variables
cp .env.example .env
# Open .env and set your GEMINI_API_KEY
```

### 2. Run Tests & Type Checks
```bash
# Run unit & integration test suite (15 tests)
npm test

# Verify TypeScript types
npm run typecheck
```

### 3. Start OpenClaw Gateway & Console
```bash
# Terminal 1: Start OpenClaw Gateway (:18789 & :8000)
npm run openclaw

# Terminal 2: Start Vite & WebXR Voice Console (:8080)
npm run dev
```

Open `http://localhost:8080` in your browser. Hold the microphone button to speak or type in the message bar!

---

## 5. Repository Structure

```
├── openclaw/
│   ├── agents/                   # Agent persona definitions
│   │   ├── orchestrator.json     # Root orchestrator
│   │   ├── devops-sentinel.json  # DevOps & traffic monitor
│   │   └── backend-expert.json   # Backend & API architect
│   ├── skills/                   # Grounded agent tools & skills
│   │   ├── traffic_monitor.js    # Live RPS, throughput & latency
│   │   ├── system_health.js      # Host OS CPU/RAM telemetry
│   │   ├── service_status.js     # Staging/production cluster probes
│   │   ├── log_analyzer.js       # Container log diagnostics
│   │   ├── ops_actions.js        # Gated restart & rollback actions
│   │   └── security_audit.js     # Dependency vulnerability scans
│   ├── gateway.js                # Core OpenClaw HTTP & ASR Gateway server
│   ├── gateway.yaml              # Declarative agent & skill manifests
│   └── gateway.test.js           # Comprehensive gateway test suite
├── src/                          # Voice Console & Spatial WebXR UI
│   ├── lib/settings/voice.ts     # OpenClaw agent roster (AGENTS)
│   ├── lib/ai/models.ts          # Gateway model routing
│   └── routes/                   # TanStack Start pages & API endpoints
├── docs/                         # Assignment brief & specifications
├── package.json
└── README.md
```

---

*Submitted by Mohamed Salah for the Dark Coders AI & Agent Engineering Take-Home Challenge.*
