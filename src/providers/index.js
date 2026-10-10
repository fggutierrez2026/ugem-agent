import { parseSse } from './sse.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8081';
const DEFAULT_MODEL = 'local-model';
const DEFAULT_TIMEOUT_MS = 30_000;
const UNSUPPORTED_DISCOVERY_STATUS = new Set([404, 405, 501]);
const REASONING_MODES = new Set(['auto', 'on', 'off']);

export class ProviderError extends Error {
  constructor(message, { code, status, cause } = {}) {
    super(message, { cause });
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
  }
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ProviderError(`${name} must be a positive integer`, {
      code: 'invalid_configuration',
    });
  }
  return parsed;
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new ProviderError('UGEM_BASE_URL must be a valid URL', {
      code: 'invalid_configuration',
      cause,
    });
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ProviderError('UGEM_BASE_URL must use http or https', {
      code: 'invalid_configuration',
    });
  }
  return url.href.replace(/\/$/, '');
}

function redact(value, credential) {
  const text = String(value);
  return credential ? text.replaceAll(credential, '[redacted]') : text;
}

function parseJson(text, endpoint, credential) {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ProviderError(`${endpoint} returned malformed JSON`, {
      code: 'invalid_response',
      cause: new Error(redact(cause.message, credential)),
    });
  }
}

function streamMetadata(payload) {
  const contextLimit = payload?.generation_settings?.n_ctx ?? payload?.n_ctx;
  const metadata = {
    usage: payload?.usage,
    timings: payload?.timings,
    contextLimit,
    tokensPredicted: payload?.tokens_predicted,
    tokensEvaluated: payload?.tokens_evaluated,
    finishReason: payload?.choices?.[0]?.finish_reason,
  };
  return Object.values(metadata).some((value) => value != null) ? metadata : null;
}

export function createProvider(options = {}) {
  const env = options.env ?? process.env;
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ?? env.UGEM_BASE_URL ?? DEFAULT_BASE_URL,
  );
  let model = options.model ?? env.UGEM_MODEL ?? DEFAULT_MODEL;
  let reasoningMode = 'auto';
  let reasoningCapability;
  let reasoningCapabilityModel;
  const timeoutMs = positiveInteger(
    options.timeoutMs ?? env.UGEM_REQUEST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
    'UGEM_REQUEST_TIMEOUT_MS',
  );
  const credential = options.credential ?? env.UGEM_API_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new ProviderError('This Node.js runtime does not provide fetch', {
      code: 'invalid_configuration',
    });
  }
  if (typeof model !== 'string' || model.trim() === '') {
    throw new ProviderError('UGEM_MODEL must not be empty', {
      code: 'invalid_configuration',
    });
  }

  async function request(path, init, { requestTimeoutMs = timeoutMs } = {}) {
    const endpoint = `${baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    timer.unref?.();

    let response;
    let text;
    try {
      response = await fetchImpl(endpoint, { ...init, signal: controller.signal });
      text = await response.text();
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new ProviderError(`Model endpoint timed out after ${requestTimeoutMs} ms`, {
          code: 'timeout',
          cause,
        });
      }
      throw new ProviderError(`${baseUrl} is inaccessible`, {
        code: 'network_error',
        cause,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let detail = response.statusText;
      if (text) {
        try {
          const payload = JSON.parse(text);
          detail = payload?.error?.message ?? payload?.message ?? detail;
        } catch {
          detail = text;
        }
      }
      const suffix = detail ? `: ${redact(detail, credential)}` : '';
      throw new ProviderError(
        `Model endpoint returned HTTP ${response.status}${suffix}`,
        { code: 'http_error', status: response.status },
      );
    }
    return parseJson(text, endpoint, credential);
  }

  function headers() {
    const result = { 'content-type': 'application/json' };
    if (credential) result.authorization = `Bearer ${credential}`;
    return result;
  }

  function chatBody(messages, stream, { maxTokens, reasoningBudget } = {}) {
    const body = {
      model,
      messages,
      stream,
    };
    if (Number.isSafeInteger(maxTokens) && maxTokens > 0) {
      body.max_tokens = maxTokens;
    }
    if (Number.isSafeInteger(reasoningBudget) && reasoningBudget > 0) {
      body.reasoning_budget_tokens = reasoningBudget;
    }
    if (stream) body.stream_options = { include_usage: true };
    if (reasoningMode !== 'auto') {
      body.chat_template_kwargs = {
        enable_thinking: reasoningMode === 'on',
      };
      // Generation control and response visibility are intentionally separate.
      // DeepSeek format keeps any reasoning trace out of message.content.
      body.reasoning_format = 'deepseek';
    }
    return body;
  }

  function reasoningResult(capability, method = null) {
    return Object.freeze({
      mode: reasoningMode,
      capability,
      method,
      display: 'hidden',
    });
  }

  async function detectReasoningCapability() {
    if (reasoningCapabilityModel === model && reasoningCapability) {
      return reasoningResult(
        reasoningCapability.capability,
        reasoningCapability.method,
      );
    }

    let capability = reasoningResult('unknown');
    try {
      const query = `model=${encodeURIComponent(model)}&autoload=false`;
      const props = await request(`/props?${query}`, {
        method: 'GET',
        headers: credential ? { authorization: `Bearer ${credential}` } : {},
      }, { requestTimeoutMs: Math.min(timeoutMs, 3_000) });
      if (typeof props?.chat_template !== 'string') {
        reasoningCapability = capability;
        reasoningCapabilityModel = model;
        return reasoningResult(capability.capability, capability.method);
      }

      const probe = async (enabled) => request('/apply-template', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'reasoning capability probe' }],
          chat_template_kwargs: { enable_thinking: enabled },
          reasoning_format: 'deepseek',
        }),
      }, { requestTimeoutMs: Math.min(timeoutMs, 3_000) });
      const [disabled, enabled] = await Promise.all([probe(false), probe(true)]);
      if (
        typeof disabled?.prompt === 'string'
        && typeof enabled?.prompt === 'string'
      ) {
        capability = reasoningResult(
          disabled.prompt === enabled.prompt ? 'unsupported' : 'supported',
          disabled.prompt === enabled.prompt ? null : 'chat_template_kwargs',
        );
      }
    } catch {
      // OpenAI-compatible APIs have no standard reasoning capability endpoint.
    }
    reasoningCapability = capability;
    reasoningCapabilityModel = model;
    return reasoningResult(capability.capability, capability.method);
  }

  return {
    async health(requestTimeoutMs = 500) {
      try {
        await request('/health', {
          method: 'GET',
          headers: credential ? { authorization: `Bearer ${credential}` } : {},
        }, { requestTimeoutMs });
        return true;
      } catch {
        return false;
      }
    },

    setModel(modelId) {
      if (typeof modelId !== 'string' || modelId.trim() === '') {
        throw new ProviderError('Model ID must not be empty', {
          code: 'invalid_configuration',
        });
      }
      model = modelId.trim();
      reasoningMode = 'auto';
      reasoningCapability = undefined;
      reasoningCapabilityModel = undefined;
    },

    async runtimeInfo() {
      const fallback = Object.freeze({
        model,
        modelSource: 'configured',
        status: 'unknown',
        contextLimit: null,
        reasoning: reasoningMode === 'auto' ? 'unknown' : reasoningMode,
      });
      try {
        const query = `model=${encodeURIComponent(model)}&autoload=false`;
        const payload = await request(`/props?${query}`, {
          method: 'GET',
          headers: credential ? { authorization: `Bearer ${credential}` } : {},
        }, { requestTimeoutMs: Math.min(timeoutMs, 1_000) });
        const contextLimit = payload?.default_generation_settings?.n_ctx;
        const params = payload?.default_generation_settings?.params;
        const configuredReasoning = params?.reasoning
          ?? params?.chat_template_kwargs?.enable_thinking;
        let reasoning = reasoningMode === 'auto' ? 'unknown' : reasoningMode;
        if (
          reasoningMode === 'auto'
          && (configuredReasoning === true || configuredReasoning === 'true')
        ) {
          reasoning = 'on';
        } else if (
          reasoningMode === 'auto'
          && (configuredReasoning === false || configuredReasoning === 'false')
        ) {
          reasoning = 'off';
        } else if (
          reasoningMode === 'auto'
          && REASONING_MODES.has(configuredReasoning)
        ) {
          reasoning = configuredReasoning;
        }
        return Object.freeze({
          model: typeof payload?.model_alias === 'string' && payload.model_alias
            ? payload.model_alias
            : model,
          modelSource: payload?.model_alias ? 'provider' : 'configured',
          status: payload?.is_sleeping === true ? 'sleeping' : 'ready',
          contextLimit: Number.isSafeInteger(contextLimit) && contextLimit > 0
            ? contextLimit
            : null,
          reasoning,
        });
      } catch {
        return fallback;
      }
    },

    async complete(messages, { maxTokens, reasoningBudget } = {}) {
      const payload = await request('/v1/chat/completions', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(chatBody(messages, false, {
          maxTokens,
          reasoningBudget,
        })),
      });
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new ProviderError(
          'Model endpoint returned an invalid chat completion',
          { code: 'invalid_response' },
        );
      }
      return content;
    },

    async *stream(messages, {
      signal,
      onMetadata,
      maxTokens,
      reasoningBudget,
    } = {}) {
      const endpoint = `${baseUrl}/v1/chat/completions`;
      const controller = new AbortController();
      let timedOut = false;
      const onAbort = () => controller.abort(signal.reason);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });

      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      timer.unref?.();

      try {
        let response;
        try {
          response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify(chatBody(messages, true, {
              maxTokens,
              reasoningBudget,
            })),
            signal: controller.signal,
          });
        } catch (cause) {
          if (signal?.aborted) {
            throw new ProviderError('Model request was cancelled', {
              code: 'cancelled',
              cause,
            });
          }
          if (timedOut) {
            throw new ProviderError(`Model endpoint timed out after ${timeoutMs} ms`, {
              code: 'timeout',
              cause,
            });
          }
          throw new ProviderError(`${baseUrl} is inaccessible`, {
            code: 'network_error',
            cause,
          });
        }
        clearTimeout(timer);

        if (!response.ok) {
          let text;
          try {
            text = await response.text();
          } catch (cause) {
            if (signal?.aborted) {
              throw new ProviderError('Model request was cancelled', {
                code: 'cancelled',
                cause,
              });
            }
            throw new ProviderError('Model error response disconnected unexpectedly', {
              code: 'network_error',
              cause,
            });
          }
          let detail = response.statusText;
          if (text) {
            try {
              const payload = JSON.parse(text);
              detail = payload?.error?.message ?? payload?.message ?? detail;
            } catch {
              detail = text;
            }
          }
          const suffix = detail ? `: ${redact(detail, credential)}` : '';
          throw new ProviderError(
            `Model endpoint returned HTTP ${response.status}${suffix}`,
            { code: 'http_error', status: response.status },
          );
        }
        if (!response.body) {
          throw new ProviderError('Model endpoint returned no response stream', {
            code: 'invalid_response',
          });
        }

        let done = false;
        try {
          for await (const data of parseSse(response.body)) {
            if (data === '[DONE]') {
              done = true;
              break;
            }

            const payload = parseJson(data, endpoint, credential);
            const metadata = streamMetadata(payload);
            if (metadata && typeof onMetadata === 'function') onMetadata(metadata);
            const delta = payload?.choices?.[0]?.delta?.content;
            if (delta != null && typeof delta !== 'string') {
              throw new ProviderError('Model endpoint returned an invalid stream chunk', {
                code: 'invalid_response',
              });
            }
            if (delta) yield delta;
          }
        } catch (cause) {
          if (cause instanceof ProviderError) throw cause;
          if (signal?.aborted) {
            throw new ProviderError('Model request was cancelled', {
              code: 'cancelled',
              cause,
            });
          }
          if (/encoded data was not valid/i.test(cause.message)) {
            throw new ProviderError('Model endpoint returned invalid UTF-8', {
              code: 'invalid_response',
              cause,
            });
          }
          throw new ProviderError('Model stream disconnected unexpectedly', {
            code: 'network_error',
            cause,
          });
        }

        if (!done) {
          throw new ProviderError('Model stream ended before [DONE]', {
            code: 'invalid_response',
          });
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },

    async discoverModels() {
      try {
        const payload = await request('/v1/models', {
          method: 'GET',
          headers: credential ? { authorization: `Bearer ${credential}` } : {},
        });
        const models = payload?.data
          ?.filter((item) => typeof item?.id === 'string' && item.id !== '')
          .map((item) => item.id);
        if (!Array.isArray(models)) {
          throw new ProviderError('Model endpoint returned an invalid model list', {
            code: 'invalid_response',
          });
        }
        return models.length > 0
          ? { models, source: 'provider' }
          : { models: [model], source: 'configured' };
      } catch (error) {
        if (
          error instanceof ProviderError
          && error.code === 'http_error'
          && UNSUPPORTED_DISCOVERY_STATUS.has(error.status)
        ) {
          return { models: [model], source: 'configured' };
        }
        throw error;
      }
    },

    async selectModel(modelId) {
      if (typeof modelId !== 'string' || modelId.trim() === '') {
        throw new ProviderError('Model ID must not be empty', {
          code: 'invalid_configuration',
        });
      }
      const requested = modelId.trim();
      const discovered = await this.discoverModels();
      if (!discovered.models.includes(requested)) {
        throw new ProviderError(
          `Model "${requested}" was not advertised by the endpoint`,
          { code: 'unsupported_model' },
        );
      }
      model = requested;
      reasoningMode = 'auto';
      reasoningCapability = undefined;
      reasoningCapabilityModel = undefined;
      return Object.freeze({ model, source: discovered.source });
    },

    reasoningInfo: detectReasoningCapability,

    reasoningConfiguration() {
      return reasoningResult(
        reasoningCapabilityModel === model && reasoningCapability
          ? reasoningCapability.capability
          : 'unknown',
        reasoningCapabilityModel === model && reasoningCapability
          ? reasoningCapability.method
          : null,
      );
    },

    async selectReasoning(mode) {
      if (!REASONING_MODES.has(mode)) {
        throw new ProviderError(`Invalid reasoning mode: ${mode}`, {
          code: 'invalid_configuration',
        });
      }
      if (mode === reasoningMode) return detectReasoningCapability();
      if (mode === 'auto') {
        reasoningMode = mode;
        return reasoningResult(
          reasoningCapability?.capability ?? 'unknown',
          reasoningCapability?.method ?? null,
        );
      }

      const capability = await detectReasoningCapability();
      if (capability.capability !== 'supported') {
        const unknown = capability.capability === 'unknown';
        throw new ProviderError(
          unknown
            ? 'The endpoint does not expose verifiable reasoning control'
            : 'The active model template does not support reasoning control',
          { code: unknown ? 'unknown_reasoning' : 'unsupported_reasoning' },
        );
      }
      reasoningMode = mode;
      return reasoningResult('supported', capability.method);
    },

    configuration() {
      return Object.freeze({
        baseUrl,
        model,
        timeoutMs,
        hasCredential: Boolean(credential),
      });
    },
  };
}

export { DEFAULT_BASE_URL, DEFAULT_MODEL, DEFAULT_TIMEOUT_MS };
