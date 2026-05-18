import { spawn } from "node:child_process";
import type { Plugin } from "@opencode-ai/plugin";
import {
  DEFAULT_XAI_MODELS,
  OAUTH_CALLBACK_TIMEOUT_MS,
  PROVIDER_ID,
  PROVIDER_NAME,
  XAI_API_BASE_URL,
} from "./constants.js";
import { accessTokenExpired, isOAuthAuth, packXaiRefresh, parseXaiRefresh } from "./auth.js";
import {
  buildXaiAuthorizeUrl,
  createOAuthNonce,
  createOAuthState,
  discoverXaiOAuth,
  exchangeXaiCodeForTokens,
  generatePkce,
  parseOAuthCallbackInput,
  refreshXaiTokens,
  tokenResultToAuthResult,
} from "./oauth.js";
import { startXaiOAuthListener } from "./server.js";
import type {
  GetAuth,
  LoaderResult,
  OAuthAuthDetails,
  PluginClient,
  Provider,
  XaiTokenExchangeResult,
} from "./types.js";

type StoredOAuthAuthDetails = OAuthAuthDetails & {
  access: string;
  expires: number;
};

export function createXaiGrokOAuthPlugin(providerId = PROVIDER_ID): Plugin {
  const plugin: Plugin = async ({ client }) => {
    return {
      config: async (config) => {
        applyDefaultProviderConfig(config, providerId);
      },
      auth: {
        provider: providerId,
        async loader(getAuth: GetAuth, provider: Provider): Promise<LoaderResult | Record<string, never>> {
          const auth = await getAuth();
          if (!isOAuthAuth(auth)) {
            return {};
          }

          if (provider.models) {
            for (const model of Object.values(provider.models)) {
              model.cost = { input: 0, output: 0, cache: { read: 0, write: 0 } };
            }
          }

          return {
            apiKey: auth.access ?? "",
            baseURL: XAI_API_BASE_URL,
            async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
              const latest = await getAuth();
              if (!isOAuthAuth(latest)) {
                return fetch(input, init);
              }

              const freshAuth = await ensureFreshAuth(latest, client, providerId);
              const request = buildBearerRequest(input, init, freshAuth.access ?? "");
              const retrySeed = request.clone();
              let response = await fetch(request);

              if (response.status === 401) {
                const refreshed = await refreshStoredAuth(freshAuth, client, providerId);
                response = await fetch(buildBearerRequest(retrySeed, undefined, refreshed.access));
              }

              return response;
            },
          };
        },
        methods: [
          {
            label: "OAuth with xAI Grok (SuperGrok)",
            type: "oauth",
            async authorize(): Promise<{
              url: string;
              instructions: string;
              method: "auto";
              callback: () => Promise<XaiTokenExchangeResult>;
            }> {
              const discovery = await discoverXaiOAuth();
              const listener = await startXaiOAuthListener();
              const pkce = generatePkce();
              const state = createOAuthState();
              const nonce = createOAuthNonce();
              const authorizationUrl = buildXaiAuthorizeUrl({
                authorizationEndpoint: discovery.authorizationEndpoint,
                redirectUri: listener.redirectUri,
                codeChallenge: pkce.challenge,
                state,
                nonce,
              });

              const browserOpened = shouldOpenBrowser() ? await openBrowser(authorizationUrl) : false;
              const instructions = [
                browserOpened
                  ? "Complete sign-in in your browser. OpenCode will capture the xAI callback locally."
                  : "Open the OAuth URL and complete xAI sign-in.",
                "",
                authorizationUrl,
                "",
                `Callback listener: ${listener.redirectUri}`,
                "If this is a remote shell, forward the callback port to this machine first.",
              ].join("\n");

              return {
                url: authorizationUrl,
                instructions,
                method: "auto",
                callback: async (): Promise<XaiTokenExchangeResult> => {
                  try {
                    const callbackUrl = await listener.waitForCallback(OAUTH_CALLBACK_TIMEOUT_MS);
                    const params = parseOAuthCallbackInput(callbackUrl.toString(), state);
                    if ("error" in params) {
                      return { type: "failed", error: params.error };
                    }

                    const tokenPayload = await exchangeXaiCodeForTokens({
                      tokenEndpoint: discovery.tokenEndpoint,
                      code: params.code,
                      redirectUri: listener.redirectUri,
                      codeVerifier: pkce.verifier,
                      codeChallenge: pkce.challenge,
                    });

                    const refresh = packXaiRefresh({
                      refreshToken: tokenPayload.refreshToken,
                      tokenEndpoint: discovery.tokenEndpoint,
                      redirectUri: listener.redirectUri,
                    });

                    return tokenResultToAuthResult({
                      accessToken: tokenPayload.accessToken,
                      refresh,
                      expiresAt: tokenPayload.expiresAt,
                    });
                  } catch (error) {
                    return {
                      type: "failed",
                      error: error instanceof Error ? error.message : String(error),
                    };
                  } finally {
                    await listener.close().catch(() => undefined);
                  }
                },
              };
            },
          },
        ],
      },
    };
  };

  return plugin;
}

export const XaiGrokOAuthPlugin = createXaiGrokOAuthPlugin();
export default XaiGrokOAuthPlugin;

export function applyDefaultProviderConfig(config: unknown, providerId = PROVIDER_ID): void {
  if (process.env.OPENCODE_XAI_OAUTH_AUTO_CONFIG === "false") {
    return;
  }
  if (!config || typeof config !== "object") {
    return;
  }

  const root = config as Record<string, unknown>;
  const providers = getOrCreateRecord(root, "provider");
  const provider = getOrCreateRecord(providers, providerId);

  provider.npm ??= "@ai-sdk/openai";
  provider.name ??= PROVIDER_NAME;

  const options = getOrCreateRecord(provider, "options");
  options.baseURL ??= XAI_API_BASE_URL;

  const models = getOrCreateRecord(provider, "models");
  for (const model of DEFAULT_XAI_MODELS) {
    const existing = models[model];
    if (!existing || typeof existing !== "object") {
      models[model] = { name: model };
    }
  }
}

async function ensureFreshAuth(
  auth: OAuthAuthDetails,
  client: PluginClient | undefined,
  providerId: string,
): Promise<OAuthAuthDetails> {
  if (!accessTokenExpired(auth)) {
    return auth;
  }
  return refreshStoredAuth(auth, client, providerId);
}

async function refreshStoredAuth(
  auth: OAuthAuthDetails,
  client: PluginClient | undefined,
  providerId: string,
): Promise<StoredOAuthAuthDetails> {
  const parts = parseXaiRefresh(auth.refresh);
  if (!parts.refreshToken) {
    throw new Error("xAI OAuth refresh token is missing. Run `opencode auth login` again.");
  }

  const tokenEndpoint = parts.tokenEndpoint ?? (await discoverXaiOAuth()).tokenEndpoint;
  const refreshed = await refreshXaiTokens({
    tokenEndpoint,
    refreshToken: parts.refreshToken,
  });

  const nextAuth: StoredOAuthAuthDetails = {
    type: "oauth",
    refresh: packXaiRefresh({
      refreshToken: refreshed.refreshToken,
      tokenEndpoint,
      redirectUri: parts.redirectUri,
    }),
    access: refreshed.accessToken,
    expires: refreshed.expiresAt,
  };

  if (client) {
    await client.auth.set({
      path: { id: providerId },
      body: {
        type: "oauth",
        refresh: nextAuth.refresh,
        access: nextAuth.access,
        expires: nextAuth.expires,
      },
    });
  }

  return nextAuth;
}

function buildBearerRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  accessToken: string,
): Request {
  if (!accessToken) {
    throw new Error("xAI OAuth access token is missing. Run `opencode auth login` again.");
  }

  const request = new Request(input, init);
  const url = new URL(request.url);
  if (!isSafeXaiApiUrl(url)) {
    throw new Error(`Refusing to send xAI OAuth token to non-xAI URL: ${url.origin}`);
  }

  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  headers.delete("x-api-key");

  if (!headers.has("x-grok-source")) {
    headers.set("x-grok-source", "opencode-grok-auth");
  }

  return new Request(request, { headers });
}

export function isSafeXaiApiUrl(url: URL): boolean {
  return url.protocol === "https:" && url.hostname.toLowerCase() === "api.x.ai";
}

function getOrCreateRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = parent[key];
  if (current && typeof current === "object" && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function shouldOpenBrowser(): boolean {
  if (process.env.OPENCODE_XAI_OAUTH_NO_BROWSER === "1") {
    return false;
  }
  if (process.env.SSH_CLIENT || process.env.SSH_TTY || process.env.SSH_CONNECTION) {
    return false;
  }
  if (process.env.REMOTE_CONTAINERS || process.env.CODESPACES) {
    return false;
  }
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return false;
  }
  return true;
}

function openBrowser(url: string): Promise<boolean> {
  const command = browserCommand(url);
  if (!command) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

function browserCommand(url: string): { file: string; args: string[] } | undefined {
  if (process.platform === "darwin") {
    return { file: "open", args: [url] };
  }
  if (process.platform === "win32") {
    return { file: "explorer.exe", args: [url] };
  }
  return { file: "xdg-open", args: [url] };
}
