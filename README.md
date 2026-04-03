# Let's Debate

Multi-agent company debate app on Cloudflare Workers.  
Add multiple company agents, let each build a profile from web sources, run 3 rebuttal cycles, and get a final judged verdict.

---

This project uses a debate-first workflow instead of single-company summary scraping.

- Split-screen UI:
  - Left: add/remove company agents and monitor scraping status
  - Right: debate chat
- Background agent creation queue:
  - You can add multiple companies without waiting
  - Chat is locked until all queued scrapes finish and at least 2 agents are ready
- Structured multi-agent debate:
  - Opening statements
  - 3 rebuttal cycles (each agent counters competitor outputs)
  - Confidence scoreboard
  - Final verdict in a separate assistant message
- Tie-break logic:
  - If top scores tie, a dedicated tie-break judge picks the winner with reasoning

---

## Core Features

- Real-time chat over WebSocket (Cloudflare Agents routing)
- Company agent management (`add`, `remove`, `list`)
- Multi-source web discovery + scraping for company profile building
- Durable persistence with D1 + Durable Objects
- Debate orchestration with Workers AI (`llama-3.3-70b-instruct-fp8-fast`)

---

## Architecture

```text
React UI (client/src/DebateApp.tsx)
  ├─ Left panel: Agent Manager (add/remove/status)
  └─ Right panel: Debate Chat
           │ WebSocket
           ▼
Cloudflare Worker (src/index.ts)
  └─ routeAgentRequest()
           ▼
ResearchAgentSQLite Durable Object (src/debateAgent.ts)
  ├─ Agent commands: agent_add / agent_remove / agent_list
  ├─ Debate flow: opening -> cycle 1 -> cycle 2 -> cycle 3 -> verdict
  ├─ D1 storage: company_agents table
  └─ Workers AI: profile extraction + judging
```

---

## API/Event Flow (WebSocket)

### Client -> Agent

- `type: "agent_add"` with `content: "<url or domain>"`
- `type: "agent_remove"` with `target: "<company or domain>"`
- `type: "agent_list"`
- `type: "message"` for debate query

### Agent -> Client

- `agent_add_started`
- `agent_added`
- `agent_add_failed`
- `agent_removed`
- `agents_list`
- chat stream/events: `message`, `tool_start`, `done`, `error`

---

## Environment and Bindings

Configured in `wrangler.jsonc`:

- `AI` (Workers AI binding)
- `DB` (D1 database: `competitor-research-db`)
- `VECTORIZE` (configured binding; optional in current debate flow)
- `RESEARCH_AGENT` Durable Object (`ResearchAgentSQLite`)
- `ASSETS` (serves `client/dist`)

Optional API keys (if added to env):

- `SERPAPI_KEY`
- `BING_SEARCH_KEY`
- `GOOGLE_CSE_KEY`
- `GOOGLE_CSE_CX`

---

## Project Structure

```text
src/
  index.ts              # Worker entry + routeAgentRequest
  debateAgent.ts        # Durable Object: agent mgmt + debate orchestration
client/
  src/
    DebateApp.tsx       # Split-screen UI (current app entry)
    App.tsx             # Previous UI (kept in repo)
    main.tsx            # Mounts DebateApp
    index.css
wrangler.jsonc
package.json
client/package.json
README.md
```

---

## Example Usage

1. Add agents on the left:
  - `google.com`
  - `stripe.com`
  - `morganstanley.com`
2. Wait until all become `Ready`
3. Ask on the right:
  - `Which company has the best fintech?`
  - `Which company has better work-life balance?`
4. Review:
  - Opening statements
  - Cycle 1/2/3 rebuttals
  - Confidence scoreboard
  - Final verdict (separate chat message)

