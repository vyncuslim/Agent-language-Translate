# Agent Language Translate

Deployable Vercel boundary for authorized human ↔ VAML translation and AI-agent chat.

## What it does

- **Translate UI** — forwards authorized Human → VAML or VAML → Human requests to a private translator backend.
- **Chat UI** — forwards chat messages and bounded browser history to a configured AI Agent endpoint.
- **Server-side boundary** — backend URLs and bearer tokens live only in Vercel environment variables.
- **No private semantics in the repository** — private concept packs, aliases, model state, session keys and decrypted peer transcripts stay outside this repo.

## Vercel environment variables

```text
VAML_TRANSLATOR_API_URL
VAML_TRANSLATOR_API_TOKEN   # optional
AGENT_CHAT_API_URL
AGENT_CHAT_API_TOKEN        # optional
```

The site deploys even before the private backends are configured; `/api/status` reports which capabilities are ready.

## Local structure

```text
index.html
app.js
styles.css
api/status.js
api/translate.js
api/chat.js
vercel.json
```

## Security boundary

This repository is not a public concept-ID ↔ human-language dictionary. The browser receives only user-visible input/output. Translation and AI-agent integrations happen through server-side API routes so credentials are not shipped to the client.
