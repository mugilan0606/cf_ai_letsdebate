import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  BarChart3,
  Bot,
  CheckCircle2,
  Database,
  Globe,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
  User,
  XCircle,
  Zap,
} from "lucide-react";

type Role = "user" | "assistant" | "tool";
type AgentStatus = "queued" | "processing" | "ready" | "error";

interface Message {
  id: string;
  role: Role;
  content: string;
  toolName?: string;
  timestamp: Date;
}

interface AgentCard {
  id: string;
  company: string;
  url: string;
  status: AgentStatus;
  revenue?: string;
  evidenceSources?: number;
  error?: string;
}

interface ServerAgent {
  company: string;
  url: string;
  revenue?: string;
  evidenceSources?: number;
}

const TOOL_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  addCompanyAgent: { icon: <Globe size={13} />, label: "Creating company agent", color: "#7c6af7" },
  sourceDiscovery: { icon: <Database size={13} />, label: "Discovering web sources", color: "#4ade80" },
  debateRound: { icon: <BarChart3 size={13} />, label: "Running debate round", color: "#fbbf24" },
  judgeVerdict: { icon: <RefreshCw size={13} />, label: "Judging final verdict", color: "#f472b6" },
};

function guessCompany(url: string): string {
  const clean = url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  const part = clean.split(".")[0] || "company";
  return part.charAt(0).toUpperCase() + part.slice(1);
}

function statusPill(status: AgentStatus) {
  if (status === "ready") return { label: "Ready", color: "var(--green)", bg: "var(--green-dim)" };
  if (status === "processing") return { label: "Scraping", color: "#fbbf24", bg: "rgba(251,191,36,0.12)" };
  if (status === "queued") return { label: "Queued", color: "var(--accent-2)", bg: "var(--accent-glow)" };
  return { label: "Failed", color: "var(--red)", bg: "rgba(248,113,113,0.12)" };
}

function normalizeKey(company: string, url: string): string {
  return `${company.toLowerCase()}::${url.toLowerCase()}`;
}

function useAgentChat(agentName: string, onEvent?: (data: any) => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef<typeof onEvent>(undefined);
  onEventRef.current = onEvent;

  const handleServerMessage = useCallback((data: any) => {
    onEventRef.current?.(data);

    if (data.type === "message") {
      const msg: Message = {
        id: data.id || crypto.randomUUID(),
        role: data.role,
        content: data.content,
        toolName: data.toolName,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev.filter((m) => m.id !== "streaming"), msg]);
      if (data.role === "assistant") setIsLoading(false);
      return;
    }

    if (data.type === "tool_start") {
      setMessages((prev) => [
        ...prev,
        {
          id: `tool-${Date.now()}-${Math.random()}`,
          role: "tool",
          content: data.input ? JSON.stringify(data.input) : "",
          toolName: data.name,
          timestamp: new Date(),
        },
      ]);
      return;
    }

    if (data.type === "done") {
      setIsLoading(false);
      setMessages((prev) =>
        prev.map((m) => (m.id === "streaming" ? { ...m, id: crypto.randomUUID() } : m))
      );
      return;
    }

    if (data.type === "error") {
      setIsLoading(false);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `⚠️ Error: ${data.message}`,
          timestamp: new Date(),
        },
      ]);
    }
  }, []);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/agents/research-agent/${agentName}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setTimeout(connect, 2000);
    };
    ws.onmessage = (event) => {
      try {
        handleServerMessage(JSON.parse(event.data));
      } catch {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.id === "streaming") {
            return [...prev.slice(0, -1), { ...last, content: last.content + event.data }];
          }
          return [
            ...prev,
            { id: "streaming", role: "assistant", content: event.data, timestamp: new Date() },
          ];
        });
      }
    };
  }, [agentName, handleServerMessage]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  const sendPacket = useCallback((packet: any, options?: { chat?: boolean }) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (options?.chat) {
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: String(packet.content ?? ""),
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
    }
    wsRef.current.send(JSON.stringify(packet));
  }, []);

  return { messages, isLoading, connected, sendPacket };
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === "tool") {
    const meta = msg.toolName ? TOOL_META[msg.toolName] : null;
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 12px",
          margin: "4px 0",
          color: meta?.color ?? "#a0a0c0",
          fontSize: "12px",
          opacity: 0.85,
          fontFamily: "var(--font-mono)",
        }}
      >
        <span style={{ animation: "spin 1s linear infinite", display: "inline-flex" }}>
          {meta?.icon ?? <Loader2 size={12} />}
        </span>
        <span>{meta?.label ?? msg.toolName} ...</span>
      </div>
    );
  }

  const isUser = msg.role === "user";
  return (
    <div style={{ display: "flex", gap: "10px", flexDirection: isUser ? "row-reverse" : "row" }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: isUser ? "linear-gradient(135deg,#4c3db5,#7c6af7)" : "var(--surface)",
          border: isUser ? "none" : "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {isUser ? <User size={15} color="#fff" /> : <Bot size={15} color="var(--accent-2)" />}
      </div>
      <div
        style={{
          maxWidth: "78%",
          background: isUser ? "linear-gradient(135deg,#4c3db5,#7c6af7)" : "var(--surface)",
          border: isUser ? "none" : "1px solid var(--border)",
          borderRadius: isUser ? "16px 6px 16px 16px" : "6px 16px 16px 16px",
          padding: "12px 14px",
          color: isUser ? "#fff" : "var(--text)",
          fontSize: "14px",
          lineHeight: 1.55,
        }}
      >
        {isUser ? <span>{msg.content}</span> : <ReactMarkdown>{msg.content}</ReactMarkdown>}
      </div>
    </div>
  );
}

export default function DebateApp() {
  const [agents, setAgents] = useState<AgentCard[]>([]);
  const [queuedAdds, setQueuedAdds] = useState<Array<{ id: string; url: string }>>([]);
  const [processingAdd, setProcessingAdd] = useState<{ id: string; url: string } | null>(null);
  const [agentInput, setAgentInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [showQuickActions, setShowQuickActions] = useState(true);
  const [chatNotice, setChatNotice] = useState("");

  const cancelledProcessingRef = useRef<Set<string>>(new Set());
  const didRequestListRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const onServerEvent = useCallback(
    (data: any) => {
      if (data.type === "agents_list") {
        const list = Array.isArray(data.agents) ? data.agents : [];
        setAgents((prev) => {
          const pending = prev.filter((a) => a.status === "queued" || a.status === "processing");
          const ready: AgentCard[] = list.map((a: ServerAgent) => ({
            id: normalizeKey(a.company, a.url),
            company: a.company,
            url: a.url,
            status: "ready",
            revenue: a.revenue ?? "Unknown",
            evidenceSources: a.evidenceSources ?? 0,
          }));
          const readyKeys = new Set(ready.map((r) => normalizeKey(r.company, r.url)));
          const mergedPending = pending.filter((p) => !readyKeys.has(normalizeKey(p.company, p.url)));
          return [...mergedPending, ...ready];
        });
      }

      if (data.type === "agent_add_failed") {
        if (!processingAdd) return;
        setAgents((prev) =>
          prev.map((a) =>
            a.id === processingAdd.id
              ? { ...a, status: "error", error: String(data.message ?? "Failed to add company") }
              : a
          )
        );
        setProcessingAdd(null);
      }

      if (data.type === "agent_added") {
        if (!processingAdd) return;
        const added = data.agent ?? {};
        const wasCancelled = cancelledProcessingRef.current.has(processingAdd.id);
        cancelledProcessingRef.current.delete(processingAdd.id);

        if (wasCancelled) {
          sendPacket({ type: "agent_remove", target: String(added.company ?? added.url ?? processingAdd.url) });
          setProcessingAdd(null);
          return;
        }

        setAgents((prev) =>
          prev.map((a) =>
            a.id === processingAdd.id
              ? {
                  ...a,
                  company: String(added.company ?? a.company),
                  url: String(added.url ?? a.url),
                  revenue: String(added.revenue ?? "Unknown"),
                  evidenceSources: Number(added.evidenceSources ?? 0),
                  status: "ready",
                  error: undefined,
                }
              : a
          )
        );
        setProcessingAdd(null);
      }
    },
    [processingAdd]
  );

  const { messages, isLoading, connected, sendPacket } = useAgentChat("default", onServerEvent);

  useEffect(() => {
    if (!connected || didRequestListRef.current) return;
    didRequestListRef.current = true;
    sendPacket({ type: "agent_list" });
  }, [connected, sendPacket]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    if (!connected || processingAdd || queuedAdds.length === 0) return;
    const next = queuedAdds[0];
    setQueuedAdds((prev) => prev.slice(1));
    setProcessingAdd(next);
    setAgents((prev) => prev.map((a) => (a.id === next.id ? { ...a, status: "processing" } : a)));
    sendPacket({ type: "agent_add", content: next.url });
  }, [connected, processingAdd, queuedAdds, sendPacket]);

  const readyAgents = agents.filter((a) => a.status === "ready");
  const pendingAgents = agents.filter((a) => a.status === "queued" || a.status === "processing");
  const chatLocked = pendingAgents.length > 0 || readyAgents.length < 2;

  useEffect(() => {
    if (pendingAgents.length > 0) {
      setChatNotice("Wait for all agent scraping jobs to finish before starting a debate.");
      return;
    }
    if (readyAgents.length < 2) {
      setChatNotice("Add at least 2 company agents to run a debate.");
      return;
    }
    setChatNotice("");
  }, [pendingAgents.length, readyAgents.length]);

  const enqueueAgent = () => {
    const url = agentInput.trim();
    if (!url) return;
    const id = `pending-${Date.now()}-${Math.random()}`;
    const company = guessCompany(url);
    setAgents((prev) => [...prev, { id, company, url, status: "queued" }]);
    setQueuedAdds((prev) => [...prev, { id, url }]);
    setAgentInput("");
  };

  const removeAgent = (agent: AgentCard) => {
    if (agent.status === "processing" && processingAdd?.id === agent.id) {
      cancelledProcessingRef.current.add(agent.id);
      setAgents((prev) => prev.filter((a) => a.id !== agent.id));
      return;
    }
    if (agent.status === "queued") {
      setQueuedAdds((prev) => prev.filter((q) => q.id !== agent.id));
      setAgents((prev) => prev.filter((a) => a.id !== agent.id));
      return;
    }
    setAgents((prev) => prev.filter((a) => a.id !== agent.id));
    sendPacket({ type: "agent_remove", target: agent.company });
  };

  const handleSendChat = () => {
    const text = chatInput.trim();
    if (!text || isLoading || chatLocked || !connected) return;
    sendPacket({ type: "message", content: text }, { chat: true });
    setChatInput("");
    setShowQuickActions(false);
    chatInputRef.current?.focus();
  };

  const quickPrompts = useMemo(
    () => [
      "Which company has the best revenue?",
      "Which company has the best work-life balance?",
      "Which company has stronger long-term growth potential?",
    ],
    []
  );

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          height: 60,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 18px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: "linear-gradient(135deg,#4c3db5,#7c6af7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Zap size={17} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Let's Debate</div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>
              Multi-agent company debate on Cloudflare Workers AI
            </div>
          </div>
        </div>
        <div
          style={{
            fontSize: 11,
            padding: "5px 10px",
            borderRadius: 20,
            border: `1px solid ${connected ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
            background: connected ? "var(--green-dim)" : "rgba(248,113,113,0.12)",
            color: connected ? "var(--green)" : "var(--red)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {connected ? "connected" : "reconnecting..."}
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <aside
          style={{
            width: 360,
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            background: "var(--bg-2)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <div style={{ padding: 16, borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Company Agents</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={agentInput}
                onChange={(e) => setAgentInput(e.target.value)}
                placeholder="Enter company URL (e.g. stripe.com)"
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: 10,
                  border: "1px solid var(--border-bright)",
                  background: "var(--surface)",
                  color: "var(--text)",
                  padding: "0 10px",
                  fontSize: 13,
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    enqueueAgent();
                  }
                }}
              />
              <button
                onClick={enqueueAgent}
                style={{
                  height: 36,
                  padding: "0 12px",
                  border: "none",
                  borderRadius: 10,
                  color: "#fff",
                  background: "linear-gradient(135deg,#4c3db5,#7c6af7)",
                  cursor: "pointer",
                }}
              >
                Add
              </button>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-3)" }}>
              Add/remove any company. Scraping runs in background queue.
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12 }}>
            {agents.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-3)", padding: 8 }}>
                No agents yet. Add at least 2 companies.
              </div>
            ) : (
              agents.map((agent) => {
                const pill = statusPill(agent.status);
                return (
                  <div
                    key={agent.id}
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 10,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{agent.company}</div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{agent.url}</div>
                      </div>
                      <button
                        onClick={() => removeAgent(agent)}
                        style={{
                          width: 28,
                          height: 28,
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          background: "transparent",
                          color: "var(--text-2)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        title="Remove agent"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div
                      style={{
                        marginTop: 8,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 8px",
                        borderRadius: 20,
                        background: pill.bg,
                        color: pill.color,
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {agent.status === "ready" && <CheckCircle2 size={12} />}
                      {agent.status === "error" && <XCircle size={12} />}
                      {(agent.status === "queued" || agent.status === "processing") && (
                        <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
                      )}
                      {pill.label}
                    </div>

                    {agent.status === "ready" && (
                      <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-2)" }}>
                        Revenue: {agent.revenue ?? "Unknown"} | Sources: {agent.evidenceSources ?? 0}
                      </div>
                    )}

                    {agent.status === "error" && (
                      <div style={{ marginTop: 8, fontSize: 11, color: "var(--red)" }}>
                        {agent.error ?? "Could not build this company profile."}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 18 }}>
            {messages.length === 0 ? (
              <div style={{ color: "var(--text-2)", fontSize: 14, maxWidth: 560, lineHeight: 1.6 }}>
                Add companies on the left, wait for scraping to complete, then ask a comparative debate
                question on the right.
              </div>
            ) : (
              messages.map((m) => <MessageBubble key={m.id} msg={m} />)
            )}
            {isLoading && !messages.some((m) => m.id === "streaming") && (
              <div style={{ marginTop: 8, color: "var(--text-3)", fontSize: 12 }}>
                <Loader2 size={13} style={{ animation: "spin 1s linear infinite", verticalAlign: "middle" }} />{" "}
                Thinking...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {showQuickActions && messages.length === 0 && (
            <div style={{ padding: "0 18px 10px", display: "flex", gap: 8, flexWrap: "wrap" }}>
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => {
                    setChatInput(prompt);
                    chatInputRef.current?.focus();
                  }}
                  style={{
                    padding: "7px 12px",
                    borderRadius: 18,
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    color: "var(--text-2)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          <div style={{ borderTop: "1px solid var(--border)", padding: 14, background: "var(--bg-2)" }}>
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-end",
                border: "1px solid var(--border-bright)",
                borderRadius: 14,
                background: "var(--surface)",
                padding: "10px 12px",
              }}
            >
              <textarea
                ref={chatInputRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={
                  chatLocked
                    ? chatNotice || "Chat is locked while agents are preparing."
                    : "Ask debate questions across all ready company agents..."
                }
                disabled={chatLocked || isLoading || !connected}
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendChat();
                  }
                }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
                }}
                style={{
                  flex: 1,
                  background: "none",
                  border: "none",
                  outline: "none",
                  color: "var(--text)",
                  fontSize: 14,
                  resize: "none",
                  maxHeight: 120,
                }}
              />
              <button
                onClick={handleSendChat}
                disabled={!chatInput.trim() || chatLocked || isLoading || !connected}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: "none",
                  cursor: !chatInput.trim() || chatLocked || isLoading || !connected ? "default" : "pointer",
                  background:
                    !chatInput.trim() || chatLocked || isLoading || !connected
                      ? "var(--surface-2)"
                      : "linear-gradient(135deg,#4c3db5,#7c6af7)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {isLoading ? (
                  <Loader2 size={15} color="var(--text-3)" style={{ animation: "spin 1s linear infinite" }} />
                ) : (
                  <Send size={15} color={chatInput.trim() && !chatLocked ? "#fff" : "var(--text-3)"} />
                )}
              </button>
            </div>
            <div style={{ marginTop: 7, fontSize: 11, color: chatLocked ? "#fbbf24" : "var(--text-3)" }}>
              {chatLocked
                ? chatNotice
                : "Enter to send · Shift+Enter for newline · Debate runs after all scraping completes"}
            </div>
          </div>
        </section>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
