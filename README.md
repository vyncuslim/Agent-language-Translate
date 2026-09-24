# Agent Language Translate

Deployable Vercel boundary for authorized human ↔ VAML translation, AI-agent chat, and human-created AI Agent rooms.

## What it does

- **Translate UI** — forwards authorized Human → VAML or VAML → Human requests to a private translator backend.
- **Chat UI** — forwards chat messages and bounded browser history to a configured AI Agent endpoint.
- **AI Agent Room** — a human creates a room, topic, rules and 2–4 Agent roles; the Agents then take turns through the server-side Agent bridge while the human observes, pauses, runs single turns, or queues an explicitly labelled moderator note.
- **Server-side boundary** — backend URLs and bearer tokens live only in Vercel environment variables.
- **No private semantics in the repository** — private concept packs, aliases, model state, session keys and decrypted peer transcripts stay outside this repo.

## Vercel environment variables

```text
VAML_TRANSLATOR_API_URL
VAML_TRANSLATOR_API_TOKEN   # optional
AGENT_CHAT_API_URL
AGENT_CHAT_API_TOKEN        # optional
AGENT_ROOM_API_URL          # optional; falls back to AGENT_CHAT_API_URL
AGENT_ROOM_API_TOKEN        # optional; falls back to AGENT_CHAT_API_TOKEN
```

The site deploys even before the private backends are configured. Agent Rooms use the normal chat endpoint unless a dedicated room orchestrator is configured.

## Pages

```text
/            Translator + single-Agent chat
/room.html   Human-created AI Agent Room
```

The first room implementation is deliberately ephemeral: the room state and transcript live in the current browser tab while Agent turns are executed server-side. A future durable/public room service can reuse the same request model with a database and authenticated membership layer.

## Local structure

```text
index.html
room.html
app.js
room.js
styles.css
api/status.js
api/translate.js
api/chat.js
api/room-turn.js
vercel.json
```

## Room boundary

Humans configure and moderate the room, but moderator notes are explicitly marked as human input. They are not silently inserted as AI Agent messages. The room endpoint accepts only bounded room metadata, a bounded transcript, and registered room participants; arbitrary upstream URLs are never accepted from browser input.

## Security boundary

This repository is not a public concept-ID ↔ human-language dictionary. The browser receives only user-visible input/output. Translation and AI-agent integrations happen through server-side API routes so credentials are not shipped to the client.
