#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROVIDER_ID = "xai-oauth";
const DEFAULT_TOKEN_ENDPOINT = "https://auth.x.ai/oauth2/token";
const DEFAULT_REDIRECT_URI = "http://127.0.0.1:56121/callback";

const hermesAuthPath = resolveInputPath(
  process.argv[2] ||
    process.env.HERMES_AUTH_JSON ||
    path.join(os.homedir(), ".hermes", "auth.json"),
);
const opencodeAuthPath = resolveInputPath(
  process.env.OPENCODE_AUTH_JSON ||
    path.join(os.homedir(), ".local", "share", "opencode", "auth.json"),
);

function main() {
  if (!fs.existsSync(hermesAuthPath)) {
    fail(
      `Hermes auth file not found: ${hermesAuthPath}\n` +
        "Pass the copied Hermes auth.json path:\n" +
        "  bun run import:hermes -- C:\\\\path\\\\to\\\\auth.json",
    );
  }

  const hermes = readJson(hermesAuthPath, "Hermes auth");
  const xaiState = getXaiProviderState(hermes);
  const tokens = xaiState.tokens;
  const accessToken = stringValue(tokens.access_token);
  const refreshToken = stringValue(tokens.refresh_token);

  if (!refreshToken) {
    fail("Hermes xai-oauth state does not contain a refresh_token.");
  }

  const tokenEndpoint =
    stringValue(xaiState.discovery?.token_endpoint) ||
    stringValue(xaiState.token_endpoint) ||
    DEFAULT_TOKEN_ENDPOINT;
  validateXaiEndpoint(tokenEndpoint, "token_endpoint");

  const redirectUri =
    stringValue(xaiState.redirect_uri) ||
    stringValue(tokens.redirect_uri) ||
    DEFAULT_REDIRECT_URI;

  const opencode = fs.existsSync(opencodeAuthPath)
    ? readJson(opencodeAuthPath, "OpenCode auth")
    : {};

  const expires = calculateExpires(tokens, xaiState, accessToken);
  opencode[PROVIDER_ID] = {
    type: "oauth",
    refresh: packRefresh({
      refreshToken,
      tokenEndpoint,
      redirectUri,
    }),
    access: accessToken,
    expires,
  };

  fs.mkdirSync(path.dirname(opencodeAuthPath), { recursive: true });
  if (fs.existsSync(opencodeAuthPath)) {
    const backupPath = `${opencodeAuthPath}.bak.${timestamp()}`;
    fs.copyFileSync(opencodeAuthPath, backupPath);
    console.log(`Backup written: ${backupPath}`);
  }

  writeJsonAtomic(opencodeAuthPath, opencode);
  console.log(`Imported Hermes xAI OAuth credentials into: ${opencodeAuthPath}`);
  console.log(`Provider: ${PROVIDER_ID}`);
  console.log(`Token endpoint: ${tokenEndpoint}`);
  console.log("No tokens were printed.");
}

function getXaiProviderState(authStore) {
  const state = authStore?.providers?.[PROVIDER_ID];
  if (state && typeof state === "object" && state.tokens && typeof state.tokens === "object") {
    return state;
  }

  fail(
    "Could not find providers.xai-oauth.tokens in the Hermes auth file.\n" +
      "On the Hermes machine, make sure `hermes auth add xai-oauth` or the xAI Grok OAuth login completed.",
  );
}

function packRefresh(parts) {
  return `xai:${Buffer.from(JSON.stringify(parts), "utf8").toString("base64url")}`;
}

function calculateExpires(tokens, state, accessToken) {
  const jwtExpires = getJwtExpiry(accessToken);
  if (jwtExpires) {
    return jwtExpires;
  }

  const lastRefresh = Date.parse(stringValue(state.last_refresh) || stringValue(tokens.obtained_at));
  const expiresIn = Number(tokens.expires_in);
  if (Number.isFinite(lastRefresh) && Number.isFinite(expiresIn) && expiresIn > 0) {
    return lastRefresh + expiresIn * 1000;
  }

  return Date.now() + 3600 * 1000;
}

function getJwtExpiry(token) {
  if (!token || !token.includes(".")) {
    return undefined;
  }
  try {
    const payload = token.split(".")[1];
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof parsed.exp === "number" ? parsed.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function validateXaiEndpoint(value, field) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    fail(`Hermes ${field} is not HTTPS: ${value}`);
  }
  const host = url.hostname.toLowerCase();
  if (host !== "x.ai" && !host.endsWith(".x.ai")) {
    fail(`Hermes ${field} is not on xAI origin: ${value}`);
  }
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    fail(`${label} file is not valid JSON: ${filePath}\n${error.message}`);
  }
}

function writeJsonAtomic(filePath, value) {
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function resolveInputPath(value) {
  return path.resolve(value.replace(/^~(?=$|[\\/])/, os.homedir()));
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
