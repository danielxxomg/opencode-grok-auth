import type { PluginInput } from "@opencode-ai/plugin";

export interface OAuthAuthDetails {
  type: "oauth";
  refresh: string;
  access?: string;
  expires?: number;
}

export interface ApiKeyAuthDetails {
  type: "api_key";
  key: string;
}

export interface UnknownAuthDetails {
  type: string;
  [key: string]: unknown;
}

export type AuthDetails = OAuthAuthDetails | ApiKeyAuthDetails | UnknownAuthDetails;
export type GetAuth = () => Promise<AuthDetails>;
export type PluginClient = PluginInput["client"];

export interface ProviderModel {
  name?: string;
  cost?: {
    input: number;
    output: number;
    cache?: { read: number; write: number };
  };
  [key: string]: unknown;
}

export interface Provider {
  models?: Record<string, ProviderModel>;
}

export interface LoaderResult {
  apiKey: string;
  baseURL?: string;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export type XaiTokenExchangeResult =
  | {
      type: "success";
      provider: string;
      refresh: string;
      access: string;
      expires: number;
    }
  | {
      type: "failed";
      error: string;
    };

export interface XaiRefreshParts {
  refreshToken: string;
  tokenEndpoint?: string;
  redirectUri?: string;
}

export interface XaiDiscovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

export interface XaiTokenPayload {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  idToken?: string;
  tokenType: string;
}
