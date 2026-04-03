# cf_ai_competitor_research

> An AI-powered competitive intelligence agent built on Cloudflare's Agent SDK. Research competitors, track pricing & features, and get semantic answers — all with persistent memory.

---

## ✨ Features

| Feature | Implementation |
|---|---|
| 💬 Real-time chat UI | WebSockets via Cloudflare Agents SDK |
| 🤖 LLM reasoning | Llama 3.3 70B on Workers AI |
| 🌐 Web scraping | Cloudflare Browser Rendering + fallback fetch |
| 🧠 Semantic memory | Vectorize (vector DB) |
| 🗃️ Structured storage | D1 (SQLite) |
| 🔄 Scheduled refresh | Agent scheduling (cron) |
| 🔁 Durable state | Durable Objects |

---

## 🏗️ Architecture

```
Browser (React Chat UI)
    │  WebSocket
    ▼
Cloudflare Worker (index.ts)
    │  routeAgentRequest()
    ▼
ResearchAgent (Durable Object)  ← persistent state + SQLite
    │
    ├─► Workers AI (Llama 3.3)        — reasoning & summarization
    ├─► Browser Rendering             — scrape competitor websites
    ├─► Vectorize                     — semantic search over stored research
    └─► D1                            — structured competitor records
```

---

## 🛠️ Tools the Agent Has

| Tool | What it does |
|---|---|
| `researchCompetitor` | Scrapes up to 5 pages (home, pricing, features, product, about) and stores findings |
| `searchMemory` | Semantic vector search across all stored competitor data |
| `listCompetitors` | Lists all researched competitors from D1 |
| `compareCompetitors` | Side-by-side comparison of 2+ competitors |
| `scheduleWeeklyRefresh` | Sets a Monday 9am cron to auto re-scrape all competitors |
| `deleteCompetitor` | Removes a competitor from the database |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- A [Cloudflare account](https://dash.cloudflare.com) (free tier works)
- Wrangler CLI: `npm i -g wrangler`
- Logged in: `wrangler login`

### 1. Clone & Install

```bash
git clone <your-repo>
cd cf_ai_competitor_research
npm install
cd client && npm install && cd ..
```

### 2. Create Cloudflare Resources

```bash
# Create D1 database
wrangler d1 create competitor-research-db
# → Copy the database_id into wrangler.jsonc

# Create Vectorize index (768 dimensions for bge-base-en-v1.5)
wrangler vectorize create competitor-research-index --dimensions=768 --metric=cosine
```

### 3. Update wrangler.jsonc

Replace `YOUR_D1_DATABASE_ID` with the ID from the step above.

### 4. Run Locally

Terminal 1 — Worker:
```bash
npm run dev
```

Terminal 2 — React client:
```bash
npm run client:dev
```

Open [http://localhost:5173](http://localhost:5173)

### 5. Deploy to Production

```bash
# Build the React client
npm run client:build

# Deploy worker + assets
npm run deploy
```

---

## 💬 Example Prompts

```
Research Stripe at https://stripe.com
Research Linear at https://linear.app
Compare Stripe and Linear
What does Stripe charge for international payments?
List all my researched competitors
Schedule weekly auto-refresh
Delete Linear from my database
```

---

## 🧱 Project Structure

```
cf_ai_competitor_research/
├── src/
│   ├── agent.ts        # ResearchAgent — all tools, scraping, LLM calls
│   └── index.ts        # Worker entry point + routing
├── client/
│   ├── src/
│   │   ├── App.tsx     # React chatbot UI
│   │   ├── main.tsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── wrangler.jsonc
├── package.json
├── tsconfig.json
├── README.md
└── PROMPTS.md
```

---

## 📦 Tech Stack

- **Runtime**: Cloudflare Workers
- **Agent SDK**: `agents` npm package (Cloudflare)
- **LLM**: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` via Workers AI
- **Embeddings**: `@cf/baai/bge-base-en-v1.5` via Workers AI
- **State**: Durable Objects + D1 + Vectorize
- **Frontend**: React 18 + Vite + react-markdown
