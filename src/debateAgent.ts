import { AIChatAgent } from "agents/ai-chat-agent";
import { createWorkersAI } from "workers-ai-provider";
import { generateText } from "ai";

export interface Env {
  AI: Ai;
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  RESEARCH_AGENT: DurableObjectNamespace;
  SERPAPI_KEY?: string;
  BING_SEARCH_KEY?: string;
  GOOGLE_CSE_KEY?: string;
  GOOGLE_CSE_CX?: string;
}

interface CompanyAgentRow {
  company: string;
  url: string;
  profile_json: string;
  updated_at: string;
}

interface CompanyProfile {
  company: string;
  website: string;
  overview: string;
  revenue: string;
  keyMetrics: string;
  strengths: string;
  weaknesses: string;
  evidence: string[];
}

const ensureUrl = (value: string): string =>
  /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;

const parseJsonObject = (text: string): any | null => {
  const clean = text.replace(/```json/gi, "```").replace(/```/g, "").trim();
  const i = clean.indexOf("{");
  const j = clean.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try {
    return JSON.parse(clean.slice(i, j + 1));
  } catch {
    return null;
  }
};

const fetchText = async (
  url: string,
  init?: RequestInit,
  timeoutMs = 12000
): Promise<string> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
};

const cleanReaderOutput = (raw: string): string => {
  let text = raw;
  const idx = text.search(/^markdown content:\s*/im);
  if (idx !== -1) text = text.slice(idx).replace(/^markdown content:\s*/im, "");
  text = text
    .split("\n")
    .filter(
      (l) =>
        !/^(Title|URL Source|Warning|Published Time|Markdown Content):/i.test(
          l.trim()
        )
    )
    .join("\n")
    .replace(/\r/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/[ \t]{3,}/g, " ")
    .trim();
  const head = text.slice(0, 280).toLowerCase();
  if (/\b(404|not found|captcha|access denied|just a moment)\b/.test(head))
    return "";
  return text.slice(0, 7000);
};

const scrapeSource = async (url: string): Promise<string> => {
  const target = ensureUrl(url);
  const reader = await fetchText(`https://r.jina.ai/${target}`, {
    headers: { Accept: "text/plain", "X-No-Cache": "true" },
  });
  if (reader) {
    const clean = cleanReaderOutput(reader);
    if (clean.length > 220) return clean;
  }
  const html = await fetchText(
    target,
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MultiAgentDebateBot/1.0)",
      },
    },
    10000
  );
  if (!html) return "";
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 7000);
};

const isWebUrl = (value: string): boolean => {
  try {
    const u = new URL(ensureUrl(value));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

const extractDomainInput = (
  text: string
): { company: string; url: string } | null => {
  const m = text.match(
    /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.[a-z]{2,})(?:\/[^\s]*)?/i
  );
  if (!m) return null;
  const domain = m[1];
  const company = domain.split(".")[0].replace(/-/g, " ");
  return {
    company: company.charAt(0).toUpperCase() + company.slice(1),
    url: ensureUrl(m[0].startsWith("http") ? m[0] : `https://${m[0]}`),
  };
};

const normalizeAgentTarget = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");

const hostFromUrl = (value: string): string => {
  try {
    return new URL(ensureUrl(value)).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return normalizeAgentTarget(value).split("/")[0];
  }
};

async function ensureSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS company_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL UNIQUE,
      url TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )`
    )
    .run();
}

export class ResearchAgent extends AIChatAgent<Env> {
  async onStart(): Promise<void> {
    await ensureSchema(this.env.DB);
  }

  private model() {
    return createWorkersAI({ binding: this.env.AI })(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
    );
  }

  private async searchDuckDuckGo(query: string): Promise<string[]> {
    const html = await fetchText(
      `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      undefined,
      10000
    );
    if (!html) return [];
    const urls = new Set<string>();
    const matches = html.matchAll(/class="result__a"[^>]*href="([^"]+)"/gim);
    for (const m of matches) {
      let href = m[1] ?? "";
      if (!href) continue;
      try {
        if (href.includes("duckduckgo.com/l/?")) {
          const parsed = new URL(href);
          href = decodeURIComponent(parsed.searchParams.get("uddg") ?? "");
        }
      } catch {
        // ignore
      }
      if (isWebUrl(href)) urls.add(ensureUrl(href));
      if (urls.size >= 10) break;
    }
    return [...urls];
  }

  private async discoverSources(company: string, website: string): Promise<string[]> {
    const base = new URL(ensureUrl(website));
    const websiteTargets = [
      `${base.protocol}//${base.hostname}`,
      `${base.protocol}//${base.hostname}/about`,
      `${base.protocol}//${base.hostname}/pricing`,
      `${base.protocol}//${base.hostname}/features`,
      `${base.protocol}//${base.hostname}/blog`,
    ];

    const queries = [
      `${company} company overview`,
      `${company} funding news`,
      `${company} engineering blog`,
      `${company} annual revenue`,
      `${company} competitors`,
    ];

    const discovered = new Set<string>();
    for (const q of queries) {
      const ddg = await this.searchDuckDuckGo(q);
      for (const u of ddg) discovered.add(u);
      if (discovered.size >= 12) break;
    }

    discovered.add(
      `https://en.wikipedia.org/wiki/${encodeURIComponent(
        company.replace(/\s+/g, "_")
      )}`
    );

    const merged = [...websiteTargets, ...[...discovered]];
    const seen = new Set<string>();
    return merged.filter((u) => (seen.has(u) ? false : (seen.add(u), true))).slice(0, 16);
  }

  private async buildCompanyProfile(
    company: string,
    website: string
  ): Promise<CompanyProfile> {
    const urls = await this.discoverSources(company, website);
    const settled = await Promise.allSettled(
      urls.map(async (url) => ({ url, content: await scrapeSource(url) }))
    );
    const docs = settled
      .filter((r): r is PromiseFulfilledResult<{ url: string; content: string }> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((d) => d.content.length > 220)
      .map((d) => ({ url: d.url, title: d.content.slice(0, 120), content: d.content.slice(0, 5000) }));

    if (!docs.length) {
      return {
        company,
        website,
        overview: "Insufficient public data could be scraped for this company.",
        revenue: "Unknown",
        keyMetrics: "Unknown",
        strengths: "Unknown",
        weaknesses: "Unknown",
        evidence: urls.slice(0, 8),
      };
    }

    const corpus = docs
      .map((d) => `URL: ${d.url}\nTitle: ${d.title}\nContent:\n${d.content}`)
      .join("\n\n========\n\n");
    const { text } = await generateText({
      model: this.model(),
      system: `Build a factual company profile from multiple web sources.
Return ONLY JSON:
{"company":"string","website":"string","overview":"string","revenue":"string","keyMetrics":"string","strengths":"string","weaknesses":"string","evidence":["url"]}`,
      messages: [
        {
          role: "user",
          content: `Company: ${company}\nWebsite: ${website}\n\n${corpus.slice(
            0,
            32000
          )}`,
        },
      ],
    });

    const parsed = parseJsonObject(text) ?? {};
    const evidence = Array.isArray(parsed.evidence)
      ? parsed.evidence.filter((x: unknown) => typeof x === "string")
      : docs.map((d) => d.url);
    return {
      company,
      website,
      overview: parsed.overview ?? "No overview extracted.",
      revenue: parsed.revenue ?? "Unknown",
      keyMetrics: parsed.keyMetrics ?? "Unknown",
      strengths: parsed.strengths ?? "Unknown",
      weaknesses: parsed.weaknesses ?? "Unknown",
      evidence: evidence.slice(0, 10),
    };
  }

  private async upsertCompanyAgent(profile: CompanyProfile): Promise<void> {
    await this.env.DB
      .prepare(
        `INSERT INTO company_agents (company, url, profile_json, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(company) DO UPDATE SET
           url=excluded.url,
           profile_json=excluded.profile_json,
           updated_at=datetime('now')`
      )
      .bind(profile.company, profile.website, JSON.stringify(profile))
      .run();
  }

  private async listCompanyAgents(): Promise<CompanyAgentRow[]> {
    const rows = await this.env.DB
      .prepare(
        `SELECT company, url, profile_json, updated_at
         FROM company_agents
         ORDER BY updated_at DESC`
      )
      .all<CompanyAgentRow>();
    return rows.results ?? [];
  }

  private async removeCompanyAgent(target: string): Promise<string | null> {
    const rows = await this.listCompanyAgents();
    if (!rows.length) return null;
    const norm = normalizeAgentTarget(target);
    const matched = rows.find((r) => {
      const c = r.company.toLowerCase();
      const u = normalizeAgentTarget(r.url);
      const h = hostFromUrl(r.url);
      return c === norm || h === norm || u === norm || c.includes(norm) || h.includes(norm);
    });
    if (!matched) return null;
    await this.env.DB
      .prepare(`DELETE FROM company_agents WHERE company = ?`)
      .bind(matched.company)
      .run();
    return matched.company;
  }

  private async runDebate(
    query: string,
    rows: CompanyAgentRow[]
  ): Promise<{ roundsReport: string; verdictReport: string }> {
    const profiles = rows.slice(0, 6).map((r) => {
      const parsed = parseJsonObject(r.profile_json) as CompanyProfile | null;
      return (
        parsed ?? {
          company: r.company,
          website: r.url,
          overview: "Unknown",
          revenue: "Unknown",
          keyMetrics: "Unknown",
          strengths: "Unknown",
          weaknesses: "Unknown",
          evidence: [r.url],
        }
      );
    });

    const openings: Array<{ company: string; text: string }> = [];
    for (const p of profiles) {
      const out = await generateText({
        model: this.model(),
        system: `You are the ${p.company} agent. Create an opening statement for a competitive debate.
Rules:
- Use only profile evidence.
- Make 3-5 concise claims.
- Mention uncertainty when data is limited.
- Avoid generic filler.`,
        messages: [
          {
            role: "user",
            content: `Query: ${query}\nProfile:\n${JSON.stringify(p, null, 2)}`,
          },
        ],
      });
      openings.push({ company: p.company, text: out.text.trim() });
    }

    const confidenceToNumeric = (value: string): number => {
      const v = value.toLowerCase().trim();
      if (v === "high") return 85;
      if (v === "medium") return 65;
      return 45;
    };

    type RoundArgument = {
      company: string;
      counter: string;
      confidence: "low" | "medium" | "high";
      score: number;
    };

    const buildRebuttalRound = async (
      cycle: number,
      previousRound: Array<{ company: string; text: string }>
    ): Promise<RoundArgument[]> => {
      const result: RoundArgument[] = [];
      for (const p of profiles) {
        const rivals = previousRound
          .filter((o) => o.company !== p.company)
          .map((o) => `### ${o.company}\n${o.text}`)
          .join("\n\n");
        const ownPrevious =
          previousRound.find((o) => o.company === p.company)?.text ?? "No prior argument.";

        const out = await generateText({
          model: this.model(),
          system: `You are the ${p.company} agent in rebuttal cycle ${cycle}.
Return ONLY JSON:
{"counter":"string","confidence":"low|medium|high","score":0}
Rules:
- Counter competitor claims directly using your profile evidence.
- Respond to strongest rival points first.
- Improve your previous argument without repeating it verbatim.
- score is your self-assessed argument strength from 0-100.`,
          messages: [
            {
              role: "user",
              content: `Debate query: ${query}
Rebuttal cycle: ${cycle}
Your profile:
${JSON.stringify(p, null, 2)}

Your previous argument:
${ownPrevious}

Competitor responses from previous cycle:
${rivals}`,
            },
          ],
        });

        const parsed = parseJsonObject(out.text) ?? {};
        const confidenceRaw =
          typeof parsed.confidence === "string"
            ? parsed.confidence.toLowerCase()
            : "low";
        const confidence: "low" | "medium" | "high" =
          confidenceRaw === "high" || confidenceRaw === "medium"
            ? confidenceRaw
            : "low";
        const scoreValue =
          typeof parsed.score === "number" && Number.isFinite(parsed.score)
            ? Math.max(0, Math.min(100, parsed.score))
            : confidenceToNumeric(confidence);
        const counter =
          typeof parsed.counter === "string" && parsed.counter.trim().length > 0
            ? parsed.counter.trim()
            : out.text.trim().slice(0, 900);

        result.push({
          company: p.company,
          counter,
          confidence,
          score: scoreValue,
        });
      }
      return result;
    };

    const rebuttalRounds: RoundArgument[][] = [];
    let priorRound = openings.map((o) => ({ company: o.company, text: o.text }));
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      const currentRound = await buildRebuttalRound(cycle, priorRound);
      rebuttalRounds.push(currentRound);
      priorRound = currentRound.map((r) => ({ company: r.company, text: r.counter }));
    }
    const finalRound = rebuttalRounds[rebuttalRounds.length - 1] ?? [];

    const judge = await generateText({
      model: this.model(),
      system: `You are an impartial judge. Return ONLY JSON:
{"winner":"company","reasoning":"string","ranking":["c1","c2"],"confidence":"low|medium|high","scoreboard":[{"company":"string","score":0,"confidence":"low|medium|high","why":"string"}]}
Scoring rubric:
- Evidence quality and specificity (40%)
- Strength of rebuttal against rivals (40%)
- Internal consistency and uncertainty handling (20%)`,
      messages: [
        {
          role: "user",
          content: `Query: ${query}

Opening statements:
${openings.map((o) => `### ${o.company}\n${o.text}`).join("\n\n")}

Rebuttal round:
${rebuttalRounds
  .map(
    (round, idx) =>
      `## Cycle ${idx + 1}\n${round
        .map(
          (r) =>
            `### ${r.company}\nConfidence: ${r.confidence}\nSelf score: ${r.score}\nCounter:\n${r.counter}`
        )
        .join("\n\n")}`
  )
  .join("\n\n")}`,
        },
      ],
    });
    const verdict =
      parseJsonObject(judge.text) ?? {
        winner: "No clear winner",
        reasoning: judge.text.slice(0, 300),
        ranking: profiles.map((p) => p.company),
        confidence: "low",
        scoreboard: finalRound.map((r) => ({
          company: r.company,
          score: r.score,
          confidence: r.confidence,
          why: "Fallback score from rebuttal confidence.",
        })),
      };

    const scoreboard = Array.isArray(verdict.scoreboard)
      ? verdict.scoreboard
          .map((s: any) => ({
            company: typeof s?.company === "string" ? s.company : "Unknown",
            score:
              typeof s?.score === "number" && Number.isFinite(s.score)
                ? Math.max(0, Math.min(100, s.score))
                : 0,
            confidence:
              s?.confidence === "high" || s?.confidence === "medium" || s?.confidence === "low"
                ? s.confidence
                : "low",
            why: typeof s?.why === "string" ? s.why : "No rationale provided.",
          }))
          .sort((a: any, b: any) => b.score - a.score)
      : [];

    let finalWinner =
      typeof verdict.winner === "string" && verdict.winner.trim().length > 0
        ? verdict.winner
        : "No clear winner";
    let finalRanking = Array.isArray(verdict.ranking) ? verdict.ranking : [];
    let finalReasoning =
      typeof verdict.reasoning === "string" ? verdict.reasoning : "No reasoning provided.";
    let finalConfidence =
      verdict.confidence === "high" || verdict.confidence === "medium" || verdict.confidence === "low"
        ? verdict.confidence
        : "low";

    if (scoreboard.length > 0) {
      const topScore = scoreboard[0].score;
      const topCompanies = scoreboard
        .filter((s: any) => s.score === topScore)
        .map((s: any) => s.company);

      if (topCompanies.length === 1) {
        finalWinner = topCompanies[0];
        finalRanking = scoreboard.map((s: any) => s.company);
      } else {
        const tieBreaker = await generateText({
          model: this.model(),
          system: `You are an impartial tie-break judge.
Return ONLY JSON:
{"winner":"company","ranking":["c1","c2"],"reasoning":"string","confidence":"low|medium|high"}
Rules:
- Use only debate content.
- Prefer arguments with concrete evidence and direct rebuttal quality.
- You must choose one winner from tied companies.`,
          messages: [
            {
              role: "user",
              content: `Debate query: ${query}
Tied companies: ${topCompanies.join(", ")}
Top tied score: ${topScore}

Openings:
${openings.map((o) => `### ${o.company}\n${o.text}`).join("\n\n")}

Rebuttal cycles:
${rebuttalRounds
  .map(
    (round, idx) =>
      `## Cycle ${idx + 1}\n${round
        .map(
          (r) =>
            `### ${r.company}\nConfidence: ${r.confidence}\nScore: ${r.score}\n${r.counter}`
        )
        .join("\n\n")}`
  )
  .join("\n\n")}

Scoreboard:
${scoreboard
  .map((s: any) => `- ${s.company}: ${s.score} (${s.confidence}) - ${s.why}`)
  .join("\n")}`,
            },
          ],
        });

        const tieParsed = parseJsonObject(tieBreaker.text) ?? {};
        const tieWinner =
          typeof tieParsed.winner === "string" && tieParsed.winner.trim().length > 0
            ? tieParsed.winner
            : topCompanies[0];
        const tieReasoning =
          typeof tieParsed.reasoning === "string" && tieParsed.reasoning.trim().length > 0
            ? tieParsed.reasoning
            : "Tie broken by comparative rebuttal strength and evidence specificity.";
        const tieConfidence =
          tieParsed.confidence === "high" ||
          tieParsed.confidence === "medium" ||
          tieParsed.confidence === "low"
            ? tieParsed.confidence
            : "medium";
        const rankedFromTie = Array.isArray(tieParsed.ranking)
          ? tieParsed.ranking.filter((c: unknown) => typeof c === "string")
          : [];
        const remaining = scoreboard
          .map((s: any) => s.company)
          .filter((c: string) => !rankedFromTie.includes(c));

        finalWinner = tieWinner;
        finalReasoning = tieReasoning;
        finalConfidence = tieConfidence;
        finalRanking = [...rankedFromTie, ...remaining];
      }
    }

    const roundsReport = `## 🧠 **Debate Rounds**
**Query:** ${query}

## 🎤 **Opening Statements**
${openings.map((o) => `### **${o.company}**\n${o.text}`).join("\n\n")}

## ⚔️ **Rebuttal Cycles**
${rebuttalRounds
  .map(
    (round, idx) =>
      `## 🔁 **Cycle ${idx + 1}**\n${round
        .map(
          (r) =>
            `### **${r.company}**\n- **Confidence (self):** ${r.confidence}\n- **Self Score:** ${r.score}\n${r.counter}`
        )
        .join("\n\n")}`
  )
  .join("\n\n")}

## 📊 **Confidence Scoreboard**
${
  scoreboard.length
    ? scoreboard
        .map(
          (s: any, i: number) =>
            `${i + 1}. **${s.company}** - Score: ${s.score}, Confidence: ${s.confidence}\n   - ${s.why}`
        )
        .join("\n")
    : finalRound
        .sort((a, b) => b.score - a.score)
        .map(
          (r, i) =>
            `${i + 1}. **${r.company}** - Score: ${r.score}, Confidence: ${r.confidence}`
        )
        .join("\n")
}`;

    const verdictReport = `## 🏁 **Final Verdict**
- **Winner:** ${finalWinner}
- **Confidence:** ${finalConfidence}
- **Reasoning:** ${finalReasoning}
- **Ranking:** ${(finalRanking ?? []).join(" > ")}`;

    return { roundsReport, verdictReport };
  }

  async onMessage(connection: any, message: any): Promise<void> {
    let payload = message;
    if (typeof message === "string") {
      try {
        payload = JSON.parse(message);
      } catch {
        return;
      }
    }
    if (!payload || typeof payload.type !== "string") return;
    const content = String(payload.content ?? "").trim();

    try {
      await ensureSchema(this.env.DB);
      if (payload.type === "agent_list") {
        const rows = await this.listCompanyAgents();
        const agents = rows.map((r) => {
          const profile = (parseJsonObject(r.profile_json) as CompanyProfile | null) ?? null;
          return {
            company: r.company,
            url: r.url,
            updatedAt: r.updated_at,
            revenue: profile?.revenue ?? "Unknown",
            evidenceSources: Array.isArray(profile?.evidence) ? profile!.evidence.length : 0,
          };
        });
        connection.send(JSON.stringify({ type: "agents_list", agents }));
        connection.send(JSON.stringify({ type: "done" }));
        return;
      }

      if (payload.type === "agent_remove") {
        const target = String(payload.target ?? payload.content ?? "").trim();
        if (!target) {
          connection.send(JSON.stringify({ type: "error", message: "Missing target to remove." }));
          connection.send(JSON.stringify({ type: "done" }));
          return;
        }
        const removed = await this.removeCompanyAgent(target);
        connection.send(
          JSON.stringify({
            type: "agent_removed",
            target,
            removed: Boolean(removed),
            company: removed ?? null,
          })
        );
        connection.send(JSON.stringify({ type: "done" }));
        return;
      }

      if (payload.type === "agent_add") {
        const addText = String(payload.content ?? "").trim();
        const addInput = extractDomainInput(addText);
        if (!addInput) {
          connection.send(
            JSON.stringify({
              type: "agent_add_failed",
              input: addText,
              message: "Please provide a valid domain or URL.",
            })
          );
          connection.send(JSON.stringify({ type: "done" }));
          return;
        }
        connection.send(JSON.stringify({ type: "agent_add_started", input: addInput }));
        const profile = await this.buildCompanyProfile(addInput.company, addInput.url);
        await this.upsertCompanyAgent(profile);
        connection.send(
          JSON.stringify({
            type: "agent_added",
            agent: {
              company: profile.company,
              url: profile.website,
              revenue: profile.revenue,
              evidenceSources: profile.evidence.length,
            },
          })
        );
        connection.send(JSON.stringify({ type: "done" }));
        return;
      }

      if (payload.type !== "message" && payload.type !== "agent_add" && payload.type !== "agent_remove") {
        return;
      }

      if (!content) {
        connection.send(JSON.stringify({ type: "done" }));
        return;
      }

      const lower = content.toLowerCase();

      if (/\b(list|show)\b/.test(lower) && /\b(agents|companies)\b/.test(lower)) {
        const rows = await this.listCompanyAgents();
        const msg = rows.length
          ? `## Company Agents\n${rows
              .map((r, i) => `${i + 1}. **${r.company}** - ${r.url}`)
              .join("\n")}`
          : "No company agents yet. Add one by typing a domain like `google.com`.";
        connection.send(
          JSON.stringify({ type: "message", role: "assistant", content: msg })
        );
        connection.send(JSON.stringify({ type: "done" }));
        return;
      }

      const addInput = extractDomainInput(content);
      if (addInput) {
        connection.send(
          JSON.stringify({
            type: "tool_start",
            name: "addCompanyAgent",
            input: addInput,
          })
        );
        connection.send(
          JSON.stringify({
            type: "tool_start",
            name: "sourceDiscovery",
            input: { query: addInput.company },
          })
        );
        const profile = await this.buildCompanyProfile(
          addInput.company,
          addInput.url
        );
        await this.upsertCompanyAgent(profile);
        connection.send(
          JSON.stringify({
            type: "message",
            role: "assistant",
            content:
              `## Company Agent Added\n- **Company:** ${profile.company}\n- **Website:** ${profile.website}\n- **Revenue:** ${profile.revenue}\n- **Evidence Sources:** ${profile.evidence.length}\n\n` +
              `Add another company, then ask a query like:\n"Which company has the best revenue?"`,
          })
        );
        connection.send(JSON.stringify({ type: "done" }));
        return;
      }

      const agents = await this.listCompanyAgents();
      if (agents.length < 2) {
        connection.send(
          JSON.stringify({
            type: "message",
            role: "assistant",
            content:
              "Add at least **2 company agents** first (e.g. `google.com`, `stripe.com`), then ask a debate query.",
          })
        );
        connection.send(JSON.stringify({ type: "done" }));
        return;
      }

      connection.send(
        JSON.stringify({
          type: "tool_start",
          name: "debateRound",
          input: { query: content },
        })
      );
      const result = await this.runDebate(content, agents);
      connection.send(
        JSON.stringify({
          type: "tool_start",
          name: "judgeVerdict",
          input: { query: content },
        })
      );
      connection.send(
        JSON.stringify({ type: "message", role: "assistant", content: result.roundsReport })
      );
      connection.send(
        JSON.stringify({ type: "message", role: "assistant", content: result.verdictReport })
      );
      connection.send(JSON.stringify({ type: "done" }));
    } catch (error) {
      connection.send(
        JSON.stringify({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        })
      );
      connection.send(JSON.stringify({ type: "done" }));
    }
  }
}

export class ResearchAgentSQLite extends ResearchAgent {}
