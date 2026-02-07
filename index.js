import {
  addMessage,
  buildConfig,
  extractText,
  formatPromptBlock,
  USER_QUERY_MARKER,
  searchMemory,
} from "./lib/memos-cloud-api.js";

let lastCaptureTime = 0;
const conversationCounters = new Map();
const API_KEY_HELP_URL = "https://memos-dashboard.openmem.net/cn/apikeys/";
const ENV_FILE_SEARCH_HINTS = ["~/.openclaw/.env", "~/.moltbot/.env", "~/.clawdbot/.env"];
const MEMOS_SOURCE = "openclaw";
const TOOL_CALL_BLOCK_TYPES = new Set(["toolCall", "toolUse", "functionCall"]);

function warnMissingApiKey(log, context) {
  const heading = "[memos-cloud] Missing MEMOS_API_KEY (Token auth)";
  const header = `${heading}${context ? `; ${context} skipped` : ""}. Configure it with:`;
  log.warn?.(
    [
      header,
      "echo 'export MEMOS_API_KEY=\"mpg-...\"' >> ~/.zshrc",
      "source ~/.zshrc",
      "or",
      "echo 'export MEMOS_API_KEY=\"mpg-...\"' >> ~/.bashrc",
      "source ~/.bashrc",
      "or",
      "[System.Environment]::SetEnvironmentVariable(\"MEMOS_API_KEY\", \"mpg-...\", \"User\")",
      `Get API key: ${API_KEY_HELP_URL}`,
    ].join("\n"),
  );
}

function stripPrependedPrompt(content) {
  if (!content) return content;
  const idx = content.lastIndexOf(USER_QUERY_MARKER);
  if (idx === -1) return content;
  return content.slice(idx + USER_QUERY_MARKER.length).trimStart();
}

function getCounterSuffix(sessionKey) {
  if (!sessionKey) return "";
  const current = conversationCounters.get(sessionKey) ?? 0;
  return current > 0 ? `#${current}` : "";
}

function bumpConversationCounter(sessionKey) {
  if (!sessionKey) return;
  const current = conversationCounters.get(sessionKey) ?? 0;
  conversationCounters.set(sessionKey, current + 1);
}

function resolveConversationId(cfg, ctx) {
  if (cfg.conversationId) return cfg.conversationId;
  // TODO: consider binding conversation_id directly to OpenClaw sessionId (prefer ctx.sessionId).
  const base = ctx?.sessionKey || ctx?.sessionId || (ctx?.agentId ? `openclaw:${ctx.agentId}` : "");
  const dynamicSuffix = cfg.conversationSuffixMode === "counter" ? getCounterSuffix(ctx?.sessionKey) : "";
  const prefix = cfg.conversationIdPrefix || "";
  const suffix = cfg.conversationIdSuffix || "";
  if (base) return `${prefix}${base}${dynamicSuffix}${suffix}`;
  return `${prefix}openclaw-${Date.now()}${dynamicSuffix}${suffix}`;
}

function buildSearchPayload(cfg, prompt, ctx) {
  const queryRaw = `${cfg.queryPrefix || ""}${prompt}`;
  const query =
    Number.isFinite(cfg.maxQueryChars) && cfg.maxQueryChars > 0
      ? queryRaw.slice(0, cfg.maxQueryChars)
      : queryRaw;

  const payload = {
    user_id: cfg.userId,
    query,
    source: MEMOS_SOURCE,
  };

  if (!cfg.recallGlobal) {
    const conversationId = resolveConversationId(cfg, ctx);
    if (conversationId) payload.conversation_id = conversationId;
  }

  if (cfg.filter) payload.filter = cfg.filter;
  if (cfg.knowledgebaseIds?.length) payload.knowledgebase_ids = cfg.knowledgebaseIds;

  payload.memory_limit_number = cfg.memoryLimitNumber;
  payload.include_preference = cfg.includePreference;
  payload.preference_limit_number = cfg.preferenceLimitNumber;
  payload.include_tool_memory = cfg.includeToolMemory;
  payload.tool_memory_limit_number = cfg.toolMemoryLimitNumber;

  return payload;
}

function buildAddMessagePayload(cfg, messages, ctx) {
  const payload = {
    user_id: cfg.userId,
    conversation_id: resolveConversationId(cfg, ctx),
    messages,
    source: MEMOS_SOURCE,
  };

  if (cfg.agentId) payload.agent_id = cfg.agentId;
  if (cfg.appId) payload.app_id = cfg.appId;
  if (cfg.tags?.length) payload.tags = cfg.tags;

  const info = {
    source: "openclaw",
    sessionKey: ctx?.sessionKey,
    agentId: ctx?.agentId,
    ...(cfg.info || {}),
  };
  if (Object.keys(info).length > 0) payload.info = info;

  payload.allow_public = cfg.allowPublic;
  if (cfg.allowKnowledgebaseIds?.length) payload.allow_knowledgebase_ids = cfg.allowKnowledgebaseIds;
  payload.async_mode = cfg.asyncMode;

  return payload;
}

function toRecord(value) {
  return value && typeof value === "object" ? value : null;
}

function safeStringify(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeToolCallArguments(rawArguments) {
  if (rawArguments === undefined || rawArguments === null) return "{}";
  if (typeof rawArguments === "string") {
    const trimmed = rawArguments.trim();
    return trimmed || "{}";
  }
  const serialized = safeStringify(rawArguments);
  return serialized || "{}";
}

function collectAssistantToolCalls(msg) {
  const results = [];
  const seenIds = new Set();

  const collect = (raw) => {
    const rec = toRecord(raw);
    if (!rec) return;

    const id = typeof rec.id === "string" && rec.id ? rec.id : "";
    if (!id || seenIds.has(id)) return;

    let name = "";
    let rawArguments;

    if (typeof rec.name === "string" && rec.name) {
      name = rec.name;
      rawArguments = rec.arguments ?? rec.input;
    } else {
      const fn = toRecord(rec.function);
      if (fn && typeof fn.name === "string" && fn.name) {
        name = fn.name;
        rawArguments = fn.arguments ?? fn.input;
      }
    }

    if (!name) return;

    results.push({
      id,
      type: "function",
      function: {
        name,
        arguments: normalizeToolCallArguments(rawArguments),
      },
    });
    seenIds.add(id);
  };

  if (Array.isArray(msg?.tool_calls)) {
    for (const call of msg.tool_calls) collect(call);
  }

  if (Array.isArray(msg?.toolCalls)) {
    for (const call of msg.toolCalls) collect(call);
  }

  if (Array.isArray(msg?.content)) {
    for (const block of msg.content) {
      const type = block?.type;
      if (typeof type !== "string" || !TOOL_CALL_BLOCK_TYPES.has(type)) continue;
      collect(block);
    }
  }

  return results;
}

function normalizeToolContent(content, cfg, fallbackValue) {
  if (typeof content === "string") {
    return truncate(content, cfg.maxMessageChars);
  }

  if (Array.isArray(content)) {
    const textBlocks = content
      .filter(
        (block) => block && typeof block === "object" && block.type === "text" && typeof block.text === "string",
      )
      .map((block) => ({
        type: "text",
        text: truncate(block.text, cfg.maxMessageChars),
      }))
      .filter((block) => block.text);

    if (textBlocks.length > 0) return textBlocks;
  }

  const fallback = safeStringify(content ?? fallbackValue);
  return fallback ? truncate(fallback, cfg.maxMessageChars) : "";
}

function normalizeMessageForAdd(msg, cfg) {
  if (!msg || typeof msg !== "object" || typeof msg.role !== "string") return null;

  if (msg.role === "user") {
    const content = stripPrependedPrompt(extractText(msg.content));
    if (!content) return null;
    return { role: "user", content: truncate(content, cfg.maxMessageChars) };
  }

  if (msg.role === "assistant") {
    const toolCalls = collectAssistantToolCalls(msg);
    const textContent = cfg.includeAssistant ? extractText(msg.content) : "";
    const content = textContent ? truncate(textContent, cfg.maxMessageChars) : "";

    if (!content && toolCalls.length === 0) return null;

    const normalized = {
      role: "assistant",
      content,
    };

    if (toolCalls.length > 0) normalized.tool_calls = toolCalls;
    return normalized;
  }

  if (msg.role === "toolResult" || msg.role === "tool") {
    const toolCallId =
      (typeof msg.toolCallId === "string" && msg.toolCallId) ||
      (typeof msg.tool_call_id === "string" && msg.tool_call_id) ||
      (typeof msg.toolUseId === "string" && msg.toolUseId) ||
      (typeof msg.tool_use_id === "string" && msg.tool_use_id) ||
      "";

    if (!toolCallId) return null;

    const content = normalizeToolContent(msg.content, cfg, msg.details);
    if (!content || (Array.isArray(content) && content.length === 0)) return null;

    return {
      role: "tool",
      tool_call_id: toolCallId,
      content,
    };
  }

  return null;
}

function collectMessages(messages, cfg) {
  const results = [];
  for (const msg of messages) {
    const normalized = normalizeMessageForAdd(msg, cfg);
    if (normalized) results.push(normalized);
  }
  return results;
}

function pickLastTurnMessages(messages, cfg) {
  const lastUserIndex = messages
    .map((m, idx) => ({ m, idx }))
    .filter(({ m }) => m?.role === "user")
    .map(({ idx }) => idx)
    .pop();

  if (lastUserIndex === undefined) return [];

  return collectMessages(messages.slice(lastUserIndex), cfg);
}

function pickFullSessionMessages(messages, cfg) {
  return collectMessages(messages, cfg);
}

function truncate(text, maxLen) {
  if (!text) return "";
  if (!maxLen) return text;
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

export default {
  id: "memos-cloud-openclaw-plugin",
  name: "MemOS Cloud OpenClaw Plugin",
  description: "MemOS Cloud recall + add memory via lifecycle hooks",
  kind: "lifecycle",

  register(api) {
    const cfg = buildConfig(api.pluginConfig);
    const log = api.logger ?? console;

    if (!cfg.envFileStatus?.found) {
      const searchPaths = cfg.envFileStatus?.searchPaths?.join(", ") ?? ENV_FILE_SEARCH_HINTS.join(", ");
      log.warn?.(`[memos-cloud] No .env found in ${searchPaths}; falling back to process env or plugin config.`);
    }

    if (cfg.conversationSuffixMode === "counter" && cfg.resetOnNew) {
      if (api.config?.hooks?.internal?.enabled !== true) {
        log.warn?.("[memos-cloud] command:new hook requires hooks.internal.enabled = true");
      }
      api.registerHook(
        ["command:new"],
        (event) => {
          if (event?.type === "command" && event?.action === "new") {
            bumpConversationCounter(event.sessionKey);
          }
        },
        {
          name: "memos-cloud-conversation-new",
          description: "Increment MemOS conversation suffix on /new",
        },
      );
    }

    api.on("before_agent_start", async (event, ctx) => {
      if (!cfg.recallEnabled) return;
      if (!event?.prompt || event.prompt.length < 3) return;
      if (!cfg.apiKey) {
        warnMissingApiKey(log, "recall");
        return;
      }

      try {
        const payload = buildSearchPayload(cfg, event.prompt, ctx);
        const result = await searchMemory(cfg, payload);
        const promptBlock = formatPromptBlock(result, { wrapTagBlocks: true });
        if (!promptBlock) return;

        return {
          prependContext: promptBlock,
        };
      } catch (err) {
        log.warn?.(`[memos-cloud] recall failed: ${String(err)}`);
      }
    });

    api.on("agent_end", async (event, ctx) => {
      if (!cfg.addEnabled) return;
      if (!event?.success || !event?.messages?.length) return;
      if (!cfg.apiKey) {
        warnMissingApiKey(log, "add");
        return;
      }

      const now = Date.now();
      if (cfg.throttleMs && now - lastCaptureTime < cfg.throttleMs) {
        return;
      }
      lastCaptureTime = now;

      try {
        const messages =
          cfg.captureStrategy === "full_session"
            ? pickFullSessionMessages(event.messages, cfg)
            : pickLastTurnMessages(event.messages, cfg);

        if (!messages.length) return;

        const payload = buildAddMessagePayload(cfg, messages, ctx);
        await addMessage(cfg, payload);
      } catch (err) {
        log.warn?.(`[memos-cloud] add failed: ${String(err)}`);
      }
    });
  },
};
