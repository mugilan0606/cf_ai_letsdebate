# PROMPTS.md

AI prompts used during the development of this project (as required by the assignment).

---

## 1. Initial Project Scoping

**Tool**: Claude (claude.ai)

**Prompt**:
> I need to create an AI agent application for a Cloudflare job application. They want me to build something using the Cloudflare Agents SDK (https://agents.cloudflare.com). Give me ideas for a chatbot-style agent that uses real Cloudflare products like Workers AI, Browser Rendering, Vectorize, D1, and Durable Objects.

**Used for**: Brainstorming the Competitive Research Agent concept and mapping features to Cloudflare products.

---

## 2. Architecture Design

**Tool**: Claude (claude.ai)

**Prompt**:
> Design a full architecture for a Competitive Research Agent on Cloudflare. It should:
> - Use AIChatAgent from the Agents SDK
> - Scrape competitor websites using Browser Rendering
> - Store findings in Vectorize for semantic search and D1 for structured data
> - Use Llama 3.3 on Workers AI for summarization
> - Have a React chat UI using WebSockets
> - Support scheduled weekly refresh using Agent scheduling
> Show me the folder structure, all tools the agent should have, and the data flow.

**Used for**: Defining the project structure, tool list, and component relationships.

---

## 3. Scraper Implementation

**Tool**: Claude (claude.ai)

**Prompt**:
> Write a TypeScript web scraper for a Cloudflare Worker that:
> 1. Tries Cloudflare Browser Rendering first via REST API
> 2. Falls back to a plain fetch with a bot user-agent
> 3. Strips all HTML tags, scripts, styles cleanly
> 4. Limits output to 8000 chars to stay within LLM context
> 5. Automatically derives pages to scrape (homepage, /pricing, /features, /product, /about) from a base URL

**Used for**: The `scrapeWebsite`, `cleanHtml`, and `getPagesToScrape` functions in `src/agent.ts`.

---

## 4. LLM Extraction Prompt

**Tool**: Claude (claude.ai)

**Prompt**:
> Write a system prompt for Llama 3.3 that takes raw scraped website content and extracts:
> - A 2-3 sentence company summary
> - Pricing model description
> - Top 5-7 features as a comma-separated list
> - Market positioning
> The output must be strict JSON with no preamble or markdown backticks.

**Used for**: The system prompt inside `doResearch()` in `src/agent.ts`.

---

## 5. React Chat UI Design

**Tool**: Claude (claude.ai)

**Prompt**:
> Create a production-grade React chatbot UI with:
> - Dark theme with a deep navy/purple palette
> - WebSocket connection to a Cloudflare Agent at /agents/research-agent/:id
> - Message bubbles with different styles for user, assistant, and tool-call messages
> - Typing indicator with bouncing dots
> - Quick action buttons for common prompts
> - Auto-resizing textarea input
> - Connection status indicator
> - react-markdown rendering for assistant messages
> - Smooth animations and micro-interactions
> Use inline styles only (no Tailwind), Space Mono and Syne fonts.

**Used for**: The full `client/src/App.tsx` component.

---

## 6. Agent System Prompt

**Tool**: Claude (claude.ai)

**Prompt**:
> Write a system prompt for an AI competitive intelligence agent that:
> - Has tools for researching competitors (scraping), searching memory (vector search), listing, comparing, scheduling refresh, and deleting
> - Should proactively suggest researching companies when mentioned
> - Should always search memory before answering questions about specific competitors
> - Formats responses with markdown
> - Is concise but comprehensive

**Used for**: The `system` prompt in the `onMessage` handler in `src/agent.ts`.
