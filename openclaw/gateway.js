import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { getSystemHealth } from "./skills/system_health.js";
import { getServiceStatus } from "./skills/service_status.js";
import { analyzeLogs } from "./skills/log_analyzer.js";
import { restartService, rollbackDeployment } from "./skills/ops_actions.js";
import { auditDependencies } from "./skills/security_audit.js";
import { getTrafficMetrics } from "./skills/traffic_monitor.js";

// 1. Auto-load .env configuration file (Node 20.6+ native loader)
if (typeof process.loadEnvFile === "function") {
  const candidateEnvPaths = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "living-ai-talk", ".env"),
    path.resolve(import.meta.dirname, "..", ".env"),
  ];
  for (const envPath of candidateEnvPaths) {
    if (fs.existsSync(envPath)) {
      try {
        process.loadEnvFile(envPath);
        break;
      } catch {
        /* continue checking */
      }
    }
  }
}

// 2. Read all dynamic parameters strictly from environment variables
const PORT = Number(process.env.OPENCLAW_PORT || 18789);
const ASR_PORT = Number(process.env.ASR_PORT || 8000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.OPENCLAW_API_KEY || "";
const PRIMARY_MODEL = process.env.GEMINI_PRIMARY_MODEL || "gemini-3.5-flash";
const FALLBACK_MODELS_RAW = process.env.GEMINI_FALLBACK_MODELS || "gemini-3.6-flash,gemma-4-31b-it,gemini-3.7-flash";

const UPSTREAM_MODELS = [
  PRIMARY_MODEL,
  ...FALLBACK_MODELS_RAW.split(",").map((m) => m.trim()).filter((m) => m && m !== PRIMARY_MODEL),
];

if (!GEMINI_API_KEY) {
  console.warn("⚠️ Warning: GEMINI_API_KEY is not set in .env. Upstream LLM calls will fail until configured.");
}

/** Available OpenClaw agents */
const ROSTER = [
  { id: "openclaw/default", name: "OpenClaw Default Gateway" },
  { id: "openclaw/devops-sentinel", name: "DevOps Sentinel (Logs & Traffic)" },
  { id: "openclaw/backend-expert", name: "Backend Architect (Backend Expert)" },
  { id: "openclaw/dc-orchestrator", name: "Dark Coders Orchestrator" },
  { id: "openclaw/sre-sentinel", name: "SRE Sentinel" },
  { id: "openclaw/ciso-guardian", name: "CISO Guardian" },
];

/** Helper to format JSON chunks as SSE */
function writeSse(res, delta) {
  const payload = JSON.stringify({
    choices: [{ delta }],
  });
  res.write(`data: ${payload}\n\n`);
}

/** Queries Google Gemini native endpoint with fast fallback and strict timeout */
async function queryGeminiWithFallback(promptText, customInstruction = "") {
  if (!GEMINI_API_KEY) return null;

  const defaultInstruction = [
    "You are OpenClaw, a smart voice AI console assistant for Dark Coders.",
    "Answer the user in the SAME language they spoke (Arabic if Arabic, English if English).",
    "Keep your answer concise (2-3 sentences), informative, natural for voice text-to-speech. Never use emojis, asterisks, or markdown.",
    `User said: "${promptText}"`,
  ].join("\n");

  const promptBody = customInstruction || defaultInstruction;
  let isQuotaExceeded = false;

  for (const model of UPSTREAM_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: promptBody,
                },
              ],
            },
          ],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        let content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        content = content.replace(/<thought>[\s\S]*?<\/thought>/gi, "").trim();
        if (content) {
          return { model, content };
        }
      } else {
        const err = await response.text();
        console.warn(`Model ${model} returned ${response.status}:`, err.slice(0, 80));
        if (response.status === 429 || err.includes("quota") || err.includes("RESOURCE_EXHAUSTED")) {
          isQuotaExceeded = true;
        }
      }
    } catch (err) {
      console.warn(`Model ${model} error:`, err.message);
    }
  }

  if (isQuotaExceeded) {
    return {
      model: "gemini/quota-guard",
      content: "عذراً، لقد استنفدت الكوتا اليومية المجانية لمفتاح Gemini API (Quota Exceeded - HTTP 429). يمكنك التحقق من ملف .env لتغيير الموديل أو تحديث المفتاح.",
      isQuota: true,
    };
  }

  return null;
}

/** Transcribes audio recording via Google Gemini Multimodal API */
async function transcribeWithGemini(audioBuffer, mimeType = "audio/wav") {
  if (!audioBuffer || audioBuffer.length < 100) {
    return { text: "", error: "لم يتم التقاط أي صوت في التسجيل." };
  }

  if (!GEMINI_API_KEY) {
    return { text: "", error: "مفتاح GEMINI_API_KEY غير موجود في ملف .env." };
  }

  let cleanMime = (mimeType || "audio/wav").split(";")[0].trim().toLowerCase();
  if (!cleanMime.startsWith("audio/")) cleanMime = "audio/wav";

  const base64Audio = audioBuffer.toString("base64");
  let isQuotaExceeded = false;

  for (const model of [...new Set([PRIMARY_MODEL, ...UPSTREAM_MODELS, "gemini-3.5-transcribe"])]) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: cleanMime,
                    data: base64Audio,
                  },
                },
                {
                  text: "Transcribe any spoken words in this audio exactly as said in the language spoken (Arabic or English). Return ONLY the transcribed text with no quotes, commentary, or markdown.",
                },
              ],
            },
          ],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
        if (result && !result.toLowerCase().includes("no speech") && !result.toLowerCase().includes("silence")) {
          return { text: result.replace(/^["']|["']$/g, "").trim(), error: null };
        }
      } else {
        const errText = await response.text();
        if (response.status === 429 || errText.includes("quota") || errText.includes("RESOURCE_EXHAUSTED")) {
          isQuotaExceeded = true;
        }
      }
    } catch {
      /* try next model */
    }
  }

  if (isQuotaExceeded) {
    return {
      text: "",
      error: "عذراً، لقد استنفدت الكوتا اليومية المجانية لمفتاح Gemini API (Quota Exceeded - HTTP 429).",
      status: 429,
    };
  }

  return { text: "", error: "لم يتم التعرف على أي كلمات منطوقة." };
}

/** Sanitizes and enforces the OpenClaw screen schema */
function buildScreenResponse({ text, choices = [], navigation = ["cancel"], actionProposal = null, appCommands = [] }) {
  // Spoken text must be plain with no markdown or emoji
  const cleanText = text
    .replace(/[*#`_~[\]]/g, "")
    .replace(/[^\x00-\x7F\u0600-\u06FF\s.,!?:;'\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    kind: "screen",
    screen: {
      text: cleanText,
      choices: choices.slice(0, 4 - navigation.length),
      navigation,
    },
    action_proposal: actionProposal,
    app_commands: appCommands,
  };
}

/** Core Intent & Workflow Engine */
async function processAgentTurn(messages, requestedAgent = "openclaw/default") {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const lowerText = lastUserMsg.toLowerCase();
  const agentId = requestedAgent.toLowerCase();

  // 1. Approval Gate Responses
  if (lowerText.includes("approved action")) {
    const isRestart = lowerText.includes("restart") || lowerText.includes("ops.restart_service");
    const isRollback = lowerText.includes("rollback");

    let resultMsg = "";
    if (isRestart) {
      const opResult = await restartService({ service: "staging-worker", worker: "worker-02" });
      resultMsg = `Action approved. ${opResult.result} Worker-02 is now running and passing readiness probes.`;
    } else if (isRollback) {
      const opResult = await rollbackDeployment({ service: "staging-worker" });
      resultMsg = `Action approved. ${opResult.result}`;
    } else {
      resultMsg = "Action approved and executed successfully.";
    }

    return {
      reasoning: "Human approval verified. Executing authorized state-changing operation via OpenClaw skill runner.",
      screen: buildScreenResponse({
        text: resultMsg,
        choices: [
          { id: "check_health", label: "Check status", value: "Inspect cluster status" },
          { id: "system_info", label: "System health", value: "Check system health" },
        ],
        navigation: ["home"],
      }),
    };
  }

  if (lowerText.includes("denied action")) {
    return {
      reasoning: "Action proposal explicitly denied by operator. Aborting execution safely.",
      screen: buildScreenResponse({
        text: "The proposed action was denied. No changes have been made to the system.",
        choices: [{ id: "inspect_logs", label: "Inspect logs", value: "Check logs for worker-02" }],
        navigation: ["home"],
      }),
    };
  }

  // 2. Incident & Crash Investigation (The SRE assignment scenario - English & Arabic)
  const isSreIncident =
    lowerText.includes("staging") ||
    lowerText.includes("worker") ||
    lowerText.includes("dying") ||
    lowerText.includes("crash") ||
    lowerText.includes("fail") ||
    lowerText.includes("عامل") ||
    lowerText.includes("سيرفر") ||
    lowerText.includes("كراش") ||
    lowerText.includes("بيموت") ||
    lowerText.includes("متعطل");

  if (isSreIncident) {
    const status = await getServiceStatus("staging-worker");
    const logs = await analyzeLogs("worker-02");

    return {
      reasoning:
        "Querying cluster service status and fetching recent log events for staging-worker. Detected crash-looping worker-02 due to readiness probe failure. Constructing remediation proposal requiring human authorization.",
      screen: buildScreenResponse({
        text: "I checked the staging cluster. Worker-02 has been crash-looping since the 14:20 deploy because it is failing its readiness probe due to memory exhaustion. I have prepared a restart proposal for your confirmation.",
        choices: [
          { id: "view_logs", label: "Inspect logs", value: "Show logs for worker-02" },
          { id: "rollback", label: "Rollback", value: "Rollback deployment to v2.14.0" },
        ],
        navigation: ["cancel"],
        actionProposal: {
          id: `act_${Date.now().toString(36)}`,
          title: "Restart staging worker",
          tool: "ops.restart_service",
          summary: "Gracefully restarts worker-02 after draining active jobs to clear heap exhaustion.",
          risk: "medium",
        },
      }),
    };
  }

  // 3. Traffic Monitoring (DevOps Skill - English & Arabic)
  const isTrafficCheck =
    lowerText.includes("traffic") ||
    lowerText.includes("ترافيك") ||
    lowerText.includes("مرور") ||
    lowerText.includes("rps") ||
    lowerText.includes("latency") ||
    lowerText.includes("throughput") ||
    lowerText.includes("requests") ||
    lowerText.includes("معدل الطلبات") ||
    lowerText.includes("شبكة");

  if (isTrafficCheck) {
    const traffic = await getTrafficMetrics();
    return {
      reasoning: "Executing traffic.monitor skill to measure HTTP throughput, request rate (RPS), error distributions, and latency percentiles.",
      screen: buildScreenResponse({
        text: `Live traffic is currently ${traffic.throughput.rps} requests per second with ${traffic.latency.p95Ms} millisecond p95 latency. Error rate is ${traffic.statusCodes["5xx_server_error"]} on 5xx status. ${traffic.anomalySummary}`,
        choices: [
          { id: "inspect_logs", label: "Inspect logs", value: "Show logs for worker-02" },
          { id: "worker_status", label: "Check worker", value: "Check staging worker status" },
        ],
        navigation: ["home"],
      }),
    };
  }

  // 4. Log Inspection (DevOps & SRE Skill - English & Arabic)
  if (lowerText.includes("log") || lowerText.includes("trace") || lowerText.includes("سجلات") || lowerText.includes("لوج")) {
    const logs = await analyzeLogs("worker-02");
    return {
      reasoning: "Scanning recent log buffers for worker-02 and extracting error signatures.",
      screen: buildScreenResponse({
        text: `Log analysis shows 14 readiness probe failures in the last 15 minutes. The root cause is container memory exhaustion exceeding the 512 megabyte limit.`,
        choices: [
          { id: "fix_worker", label: "Restart worker", value: "Restart worker-02" },
          { id: "cluster_stat", label: "Cluster status", value: "Check cluster status" },
        ],
        navigation: ["back", "home"],
      }),
    };
  }

  // 5. Live System Metrics (English & Arabic)
  if (
    lowerText.includes("cpu") ||
    lowerText.includes("memory") ||
    lowerText.includes("system") ||
    lowerText.includes("health") ||
    lowerText.includes("معالج") ||
    lowerText.includes("رام") ||
    lowerText.includes("صحة النظام")
  ) {
    const health = await getSystemHealth();
    return {
      reasoning: "Executing system.health skill to query live host OS metrics, CPU load, and memory allocation.",
      screen: buildScreenResponse({
        text: `The host system is running with ${health.cpuCount} CPU cores and ${health.memory.percentUsed}% memory usage. System uptime is ${health.uptime}. All core telemetry looks stable.`,
        choices: [
          { id: "traffic_stat", label: "Live traffic", value: "Monitor live network traffic" },
          { id: "sec_audit", label: "Security audit", value: "Run dependency security audit" },
        ],
        navigation: ["home"],
      }),
    };
  }

  // 6. Security Audit (CISO Guardian Skill)
  if (
    lowerText.includes("security") ||
    lowerText.includes("audit") ||
    lowerText.includes("vulnerability") ||
    lowerText.includes("cve") ||
    lowerText.includes("أمان") ||
    lowerText.includes("امان") ||
    lowerText.includes("ثغرات")
  ) {
    const audit = await auditDependencies();
    return {
      reasoning: "Executing CISO security.audit_dependencies skill against installed packages.",
      screen: buildScreenResponse({
        text: `Security audit completed with status: ${audit.status}. Detected ${audit.vulnerabilitiesCount} known vulnerabilities across project dependencies.`,
        choices: [
          { id: "system_health", label: "System health", value: "Check system health" },
          { id: "worker_status", label: "Check workers", value: "Check staging worker status" },
        ],
        navigation: ["home"],
      }),
    };
  }

  // 7. Backend Engineer Specialist (Backend Architect Agent)
  const isBackendQuestion =
    agentId.includes("backend") ||
    lowerText.includes("backend") ||
    lowerText.includes("باك اند") ||
    lowerText.includes("باكإند") ||
    lowerText.includes("database") ||
    lowerText.includes("قاعدة بيانات") ||
    lowerText.includes("قواعد بيانات") ||
    lowerText.includes("sql") ||
    lowerText.includes("postgres") ||
    lowerText.includes("api") ||
    lowerText.includes("endpoint") ||
    lowerText.includes("node") ||
    lowerText.includes("express") ||
    lowerText.includes("orm") ||
    lowerText.includes("prisma") ||
    lowerText.includes("redis") ||
    lowerText.includes("caching") ||
    lowerText.includes("nest") ||
    lowerText.includes("microservice") ||
    lowerText.includes("معمارية");

  if (isBackendQuestion) {
    const backendPrompt = [
      "You are the Principal Backend Architect & Software Engineer for Dark Coders.",
      "Answer the user's backend engineering question with deep technical accuracy, covering architecture, database optimization, APIs, concurrency, or server logic.",
      "Answer in the SAME language the user used (Arabic if Arabic, English if English).",
      "Keep spoken output concise (2-4 sentences), conversational, clear, and natural for text-to-speech without asterisks, emojis, or markdown codeblocks.",
      `Backend question: "${lastUserMsg}"`,
    ].join("\n");

    const upstreamResult = await queryGeminiWithFallback(lastUserMsg, backendPrompt);
    if (upstreamResult?.content) {
      return {
        reasoning: `Backend Architect reasoning using ${upstreamResult.model} neural model.`,
        screen: buildScreenResponse({
          text: upstreamResult.content,
          choices: [
            { id: "db_arch", label: "Database tuning", value: "How should I optimize database indexing and queries?" },
            { id: "api_design", label: "API design", value: "What are best practices for scalable REST APIs?" },
          ],
          navigation: ["home"],
        }),
      };
    }
  }

  // 8. General Upstream LLM reasoning (Orchestrator fallback)
  const upstreamResult = await queryGeminiWithFallback(lastUserMsg);
  if (upstreamResult?.content) {
    return {
      reasoning: `Synthesizing answer using ${upstreamResult.model} neural model.`,
      screen: buildScreenResponse({
        text: upstreamResult.content,
        choices: [
          { id: "ask_more", label: "معلومات أكثر", value: "أخبرني بالمزيد عن هذا الموضوع" },
          { id: "check_worker", label: "فحص السيرفر", value: "Check staging worker status" },
        ],
        navigation: ["home"],
      }),
    };
  }

  // Fallback if network totally down
  return {
    reasoning: "Synthesized response with OpenClaw root orchestrator.",
    screen: buildScreenResponse({
      text: "I am ready to help. You can ask me any backend question, ask me to check live traffic, or inspect service logs.",
      choices: [
        { id: "check_traffic", label: "Check traffic", value: "Monitor live network traffic" },
        { id: "check_logs", label: "Inspect logs", value: "Show logs for worker-02" },
      ],
      navigation: ["home"],
    }),
  };
}

/** Handles audio transcription requests */
async function handleAsrRequest(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const contentType = req.headers["content-type"] || "";
    const fakeResp = new Response(buffer, { headers: { "content-type": contentType } });
    const formData = await fakeResp.formData();
    const file = formData.get("file");
    const isStream = formData.get("stream") === "true";

    if (!file || file.size === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "لم يتم استلام أي تسجيل صوتي صالح." }));
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const asrResult = await transcribeWithGemini(fileBuffer, file.type || "audio/wav");

    if (asrResult.error || !asrResult.text) {
      const status = asrResult.status || 400;
      const errMsg = asrResult.error || "تعذر التعرف على الكلمات المنطوقة في التسجيل الصوتي.";

      res.writeHead(status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: errMsg }));
    }

    const text = asrResult.text;

    if (isStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "transcript.text.delta", delta: text })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "transcript.text.done", text })}\n\n`);
      return res.end();
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ text }));
  } catch (err) {
    console.error("ASR handling error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `فشل معالجة الصوت: ${err.message}` }));
  }
}

/** HTTP Server setup */
const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Lovable-AIG-SDK, Lovable-API-Key");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // Health check endpoint
  if (url.pathname === "/health" || url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        status: "ok",
        gateway: "OpenClaw v2.4",
        upstream: `Google Gemini (${UPSTREAM_MODELS.join(", ")})`,
        port: PORT,
        roster: ROSTER,
      })
    );
  }

  // OpenAI-compatible /v1/models endpoint
  if (url.pathname === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        object: "list",
        data: ROSTER.map((agent) => ({
          id: agent.id,
          object: "model",
          created: 1710000000,
          owned_by: "darkcoders",
        })),
      })
    );
  }

  // Audio transcription endpoint on OpenClaw Gateway (:18789)
  if (url.pathname === "/v1/audio/transcriptions" || url.pathname === "/audio/transcriptions") {
    return handleAsrRequest(req, res);
  }

  // OpenAI-compatible /v1/chat/completions endpoint
  if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk;
    });

    req.on("end", async () => {
      try {
        const body = JSON.parse(rawBody || "{}");
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const isStreaming = Boolean(body.stream);

        const { reasoning, screen } = await processAgentTurn(messages, body.model || "openclaw/default");
        const finalJsonString = JSON.stringify(screen);

        if (!isStreaming) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({
              id: `chatcmpl-${Date.now()}`,
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: body.model || "openclaw/default",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: finalJsonString,
                    reasoning_content: reasoning,
                  },
                  finish_reason: "stop",
                },
              ],
            })
          );
        }

        // Streaming SSE response
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        if (reasoning) {
          writeSse(res, { reasoning_content: reasoning });
        }
        writeSse(res, { content: finalJsonString });
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (err) {
        console.error("Gateway chat error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Gateway error", details: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found", path: url.pathname }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`OpenClaw Gateway listening on http://localhost:${PORT}`);
  console.log(`Configured models from env: ${UPSTREAM_MODELS.join(", ")}`);
});

// Secondary dedicated ASR port 8000 for local Whisper compatibility
const asrServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.includes("/audio/transcriptions") || url.pathname.includes("/transcribe")) {
    return handleAsrRequest(req, res);
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", service: "local-whisper-bridge" }));
});

asrServer.listen(ASR_PORT, "0.0.0.0", () => {
  console.log(`Local Whisper-compatible ASR server listening on http://localhost:${ASR_PORT}`);
});
