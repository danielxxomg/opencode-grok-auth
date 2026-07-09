# Grok OAuth Auth Plugin for OpenCode

OpenCode plugin that signs in to **xAI Grok** through the SuperGrok OAuth/PKCE
flow instead of using an `XAI_API_KEY`.

This is the xAI equivalent of the Antigravity OAuth plugin pattern: OpenCode
gets a provider, model definitions, an OAuth login method, automatic token
refresh, and a fetch layer that sends requests to `https://api.x.ai/v1`.

> **Fork maintained by [@danielxxomg](https://github.com/danielxxomg)**
> Includes `grok-4.5` model config with real pricing, image support, and reasoning variants.

## What You Get

- OAuth login for `xai-oauth` inside `opencode auth login`.
- Local loopback callback on `http://127.0.0.1:56121/callback`, with random-port fallback if the port is busy.
- xAI OIDC discovery from `https://auth.x.ai/.well-known/openid-configuration`.
- Endpoint pinning so discovered OAuth URLs must be HTTPS on `x.ai` or `*.x.ai`.
- Token exchange with `code_verifier` plus the original `code_challenge`.
- Automatic refresh token handling through OpenCode's auth store.
- Provider and model definitions for Grok OAuth models.
- Safety guard that refuses to send OAuth bearer tokens to anything except `https://api.x.ai`.

## Installation (from this fork)

### 1. Clone and build

```bash
git clone https://github.com/danielxxomg/opencode-grok-auth.git
cd opencode-grok-auth
bun install
bun run build
```

### 2. Move to OpenCode providers directory

```bash
mv opencode-grok-auth ~/.config/opencode/providers/opencode-grok-auth
```

### 3. Create the plugin wrapper

```bash
cat > ~/.config/opencode/plugins/xai-grok-oauth.js << 'EOF'
export { default } from "file:///home/USER/.config/opencode/providers/opencode-grok-auth/dist/index.js";
EOF
```

Replace `USER` with your username, or use the absolute path to your home directory.

### 4. Add the provider config to `~/.config/opencode/opencode.json`

Add this block inside the `provider` object:

```json
{
  "provider": {
    "xai-oauth": {
      "npm": "@ai-sdk/openai",
      "name": "xAI Grok OAuth",
      "options": {
        "baseURL": "https://api.x.ai/v1"
      },
      "models": {
        "grok-4.5": {
          "attachment": true,
          "cost": {
            "cache_read": 0.5,
            "input": 2,
            "output": 6
          },
          "id": "grok-4.5",
          "limit": {
            "context": 500000,
            "output": 32768
          },
          "modalities": {
            "input": ["text", "image"],
            "output": ["text"]
          },
          "name": "Grok 4.5",
          "reasoning": true,
          "reasoning_options": [
            {
              "type": "effort",
              "values": ["high", "medium", "low"]
            }
          ],
          "temperature": true,
          "tool_call": true,
          "variants": {
            "high": {},
            "medium": {},
            "low": {}
          }
        }
      }
    }
  }
}
```

### 5. Authenticate

```bash
opencode auth login
# Select: xAI Grok OAuth
# Complete the browser login
```

### 6. Use the model

Select `xai-oauth/grok-4.5` in OpenCode.

## Grok 4.5 Model Reference

| Property | Value |
|---|---|
| **Context window** | 500,000 tokens |
| **Input modalities** | text, image (jpg/png, max 20MB) |
| **Output modalities** | text |
| **Reasoning** | Yes (effort: high / medium / low) |
| **Function calling** | Yes |
| **Structured outputs** | Yes |
| **Rate limits** | 150 req/s, 50M tokens/min |

### Pricing (official xAI rates)

| Token type | Price per 1M tokens |
|---|---|
| Input | $2.00 |
| Cached input | $0.50 |
| Output | $6.00 |

Source: [docs.x.ai/pricing](https://docs.x.ai/docs/pricing)

### Other available models

The plugin's default config also registers these models (from `src/constants.ts`):

| Model ID | Description |
|---|---|
| `grok-4.3` | General-purpose (1M context) |
| `grok-4.20-0309-reasoning` | Reasoning-heavy (1M context) |
| `grok-4.20-0309-non-reasoning` | Faster non-reasoning variant |
| `grok-4.20-multi-agent-0309` | Multi-agent oriented |

To add them, extend the `models` object in your config with the same structure.

## Configuration

### Plugin Loading

The plugin loads from:

```text
~/.config/opencode/plugins/xai-grok-oauth.js
```

OpenCode loads global plugins from `~/.config/opencode/plugins/`, so this works
for any project where you run OpenCode.

### Provider Behavior

The plugin auto-injects a default provider at runtime if `provider.xai-oauth`
is missing. The explicit config in `opencode.json` is still useful because it
makes the model list visible and allows you to set pricing, context limits,
and reasoning variants.

Disable auto-injection if you want to manage the provider block manually:

```bash
export OPENCODE_XAI_OAUTH_AUTO_CONFIG=false
```

### Browser Behavior

By default, the plugin tries to open the xAI authorization URL in your browser.

Disable automatic browser launch:

```bash
export OPENCODE_XAI_OAUTH_NO_BROWSER=1
opencode auth login
```

## Troubleshooting

### OAuth Callback Does Not Arrive

The plugin listens on:

```text
http://127.0.0.1:56121/callback
```

If the port is busy, it falls back to a random local port and uses that in the
OAuth `redirect_uri`.

If you are using SSH or a remote shell, forward the callback port:

```bash
ssh -L 56121:127.0.0.1:56121 user@host
```

### Model Not Found

Check that `provider.xai-oauth.models` exists in:

```text
~/.config/opencode/opencode.json
```

Then restart OpenCode and select:

```text
xai-oauth/grok-4.5
```

### API Key Missing

This plugin does not use an API key. The loader returns an OAuth-backed fetch
handler and injects:

```
Authorization: Bearer <xai access token>
```

If OpenCode still asks for an API key, the plugin did not load. Check:

```bash
cat ~/.config/opencode/plugins/xai-grok-oauth.js
ls ~/.config/opencode/providers/opencode-grok-auth/dist/index.js
```

### Token Refresh

The OAuth access token expires after ~6 hours. The plugin refreshes it
automatically using the stored refresh token. If refresh fails, re-run:

```bash
opencode auth login
```

### Shared Auth with Grok CLI

The plugin uses the same OAuth client ID as the official `grok` CLI
(`b1a00492-073a-47ea-816f-4c329264a828`). If you already authenticated with
`grok`, your token may be reusable. The CLI stores auth in `~/.grok/auth.json`.

## Documentation

- xAI API docs: https://docs.x.ai/docs
- xAI models: https://docs.x.ai/docs/models
- xAI pricing: https://docs.x.ai/docs/pricing
- OpenCode plugins: https://opencode.ai/docs/plugins/
- OpenCode providers: https://opencode.ai/docs/providers/

## Security Notes

- Do not commit OpenCode auth files.
- Do not commit `.env`, shell transcripts, callback URLs, access tokens, or refresh tokens.
- The xAI OAuth client ID is public desktop OAuth metadata, not a secret.
- Discovered OAuth endpoints are pinned to HTTPS xAI origins.
- API bearer tokens are blocked from non-`api.x.ai` hosts.
- On auth failure, re-run `opencode auth login`; do not manually paste tokens into config files.

## Credits

Implementation pattern inspired by:

- `opencode-antigravity-auth` by Noe Fabris
- Hermes Agent's xAI Grok OAuth implementation by Nous Research

Original plugin by [@ysnock404](https://github.com/ysnock404).

## License

MIT
