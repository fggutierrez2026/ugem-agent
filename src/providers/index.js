import { parseSse } from './sse.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8081';
const DEFAULT_MODEL = 'local-model';
const DEFAULT_TIMEOUT_MS = 30_000;
const UNSUPPORTED_DISCOVERY_STATUS = new Set([404, 405, 501]);

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
  };
  return Object.values(metadata).some((value) => value != null) ? metadata : null;
}

export function createProvider(options = {}) {
  const env = options.env ?? process.env;
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ?? env.UGEM_BASE_URL ?? DEFAULT_BASE_URL,
  );
  let model = options.model ?? env.UGEM_MODEL ?? DEFAULT_MODEL;
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
      model = modelId;
    },

    async runtimeInfo() {
      const fallback = Object.freeze({
        model,
        modelSource: 'configured',
        status: 'unknown',
        contextLimit: null,
        reasoning: 'unknown',
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
        let reasoning = 'unknown';
        if (configuredReasoning === true || configuredReasoning === 'true') {
          reasoning = 'on';
        } else if (configuredReasoning === false || configuredReasoning === 'false') {
          reasoning = 'off';
        } else if (['on', 'off', 'auto'].includes(configuredReasoning)) {
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

    async complete(messages) {
      const payload = await request('/v1/chat/completions', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ model, messages, stream: false }),
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

    async *stream(messages, { signal, onMetadata } = {}) {
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
            body: JSON.stringify({
              model,
              messages,
              stream: true,
              stream_options: { include_usage: true },
            }),
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
