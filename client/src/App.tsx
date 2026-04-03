import React, { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import {
  Send,
  Bot,
  User,
  Loader2,
  Globe,
  Database,
  BarChart3,
  RefreshCw,
  Trash2,
  List,
  Zap,
  ChevronRight,
  X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Role = "user" | "assistant" | "tool";
interface Message {
  id: string;
  role: Role;
  content: string;
  toolName?: string;
  timestamp: Date;
}

// ─── useAgentChat hook (connects to Cloudflare Agent via WebSocket) ───────────
function useAgentChat(agentName: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/agents/research-agent/${agentName}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 2s
      setTimeout(connect, 2000);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
      } catch {
        // plain text streaming
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.id === "streaming") {
            return [
              ...prev.slice(0, -1),
              { ...last, content: last.content + event.data },
            ];
          }
          return [
            ...prev,
            {
              id: "streaming",
              role: "assistant",
              content: event.data,
              timestamp: new Date(),
            },
          ];
        });
      }
    };
  }, [agentName]);

  const handleServerMessage = (data: any) => {
    if (data.type === "message") {
      const msg: Message = {
        id: data.id || crypto.randomUUID(),
        role: data.role,
        content: data.content,
        toolName: data.toolName,
        timestamp: new Date(),
      };
      setMessages((prev) => {
        // Replace streaming placeholder
        const filtered = prev.filter((m) => m.id !== "streaming");
        return [...filtered, msg];
      });
      if (data.role === "assistant") setIsLoading(false);
    } else if (data.type === "tool_start") {
      setMessages((prev) => [
        ...prev,
        {
          id: `tool-${Date.now()}`,
          role: "tool",
          content: data.input ? JSON.stringify(data.input) : "",
          toolName: data.name,
          timestamp: new Date(),
        },
      ]);
    } else if (data.type === "done") {
      setIsLoading(false);
      // Finalize streaming message id
      setMessages((prev) =>
        prev.map((m) =>
          m.id === "streaming" ? { ...m, id: crypto.randomUUID() } : m
        )
      );
    } else if (data.type === "error") {
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
  };

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  const sendMessage = useCallback((content: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    wsRef.current.send(JSON.stringify({ type: "message", content }));
  }, []);

  return { messages, isLoading, connected, sendMessage };
}

// ─── Tool icon map ─────────────────────────────────────────────────────────
const TOOL_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  addCompanyAgent: { icon: <Globe size={13} />, label: "Creating company agent", color: "#7c6af7" },
  sourceDiscovery: { icon: <Database size={13} />, label: "Discovering web sources", color: "#4ade80" },
  debateRound: { icon: <BarChart3 size={13} />, label: "Running debate round", color: "#fbbf24" },
  judgeVerdict: { icon: <RefreshCw size={13} />, label: "Judging final verdict", color: "#f472b6" },
};

// ─── Quick action buttons ──────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: "Add Google Agent", prompt: "google.com" },
  { label: "Add Stripe Agent", prompt: "stripe.com" },
  { label: "List company agents", prompt: "list company agents" },
  { label: "Debate on revenue", prompt: "Which company has the best revenue?" },
  { label: "Debate on growth", prompt: "Which company has better growth potential?" },
];

// ─── Message bubble ────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === "tool") {
    const meta = msg.toolName ? TOOL_META[msg.toolName] : null;
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 14px",
        margin: "4px 0",
        color: meta?.color ?? "#a0a0c0",
        fontSize: "12px",
        fontFamily: "var(--font-mono)",
        opacity: 0.8,
      }}>
        <span style={{ animation: "spin 1s linear infinite", display: "inline-flex" }}>
          {meta?.icon ?? <Loader2 size={12} />}
        </span>
        <span>{meta?.label ?? msg.toolName} …</span>
        {msg.content && msg.content !== "{}" && (
          <span style={{ color: "var(--text-3)", fontSize: "11px" }}>
            {msg.content.slice(0, 80)}
          </span>
        )}
      </div>
    );
  }

  const isUser = msg.role === "user";
  return (
    <div style={{
      display: "flex",
      gap: "12px",
      padding: "4px 0",
      flexDirection: isUser ? "row-reverse" : "row",
      alignItems: "flex-start",
    }}>
      {/* Avatar */}
      <div style={{
        width: "34px",
        height: "34px",
        borderRadius: "50%",
        background: isUser
          ? "linear-gradient(135deg, #7c6af7, #a78bfa)"
          : "linear-gradient(135deg, #1c1c2a, #252535)",
        border: isUser ? "none" : "1px solid var(--border-bright)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        marginTop: "2px",
      }}>
        {isUser
          ? <User size={16} color="#fff" />
          : <Bot size={16} color="var(--accent-2)" />}
      </div>

      {/* Bubble */}
      <div style={{
        maxWidth: "72%",
        background: isUser
          ? "linear-gradient(135deg, #4c3db5, #7c6af7)"
          : "var(--surface)",
        border: isUser ? "none" : "1px solid var(--border)",
        borderRadius: isUser ? "18px 4px 18px 18px" : "4px 18px 18px 18px",
        padding: "12px 16px",
        fontSize: "14px",
        lineHeight: "1.6",
        color: isUser ? "#fff" : "var(--text)",
        boxShadow: isUser
          ? "0 4px 20px rgba(124,106,247,0.25)"
          : "0 2px 8px rgba(0,0,0,0.3)",
      }}>
        {isUser ? (
          <span>{msg.content}</span>
        ) : (
          <div className="msg-content">
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          </div>
        )}
        <div style={{
          fontSize: "10px",
          color: isUser ? "rgba(255,255,255,0.5)" : "var(--text-3)",
          marginTop: "6px",
          textAlign: isUser ? "right" : "left",
          fontFamily: "var(--font-mono)",
        }}>
          {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}

// ─── Typing indicator ──────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div style={{ display: "flex", gap: "12px", alignItems: "center", padding: "4px 0" }}>
      <div style={{
        width: "34px", height: "34px", borderRadius: "50%",
        background: "linear-gradient(135deg, #1c1c2a, #252535)",
        border: "1px solid var(--border-bright)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <Bot size={16} color="var(--accent-2)" />
      </div>
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: "4px 18px 18px 18px", padding: "14px 18px",
        display: "flex", gap: "5px", alignItems: "center",
      }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            width: "6px", height: "6px", borderRadius: "50%",
            background: "var(--accent-2)",
            animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────
export default function App() {
  const agentId = "default";
  const { messages, isLoading, connected, sendMessage } = useAgentChat(agentId);
  const [input, setInput] = useState("");
  const [showQuickActions, setShowQuickActions] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    sendMessage(trimmed);
    setInput("");
    setShowQuickActions(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickAction = (prompt: string) => {
    sendMessage(prompt);
    setShowQuickActions(false);
  };

  const isEmpty = messages.length === 0;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      background: "var(--bg)",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Ambient background glow */}
      <div style={{
        position: "absolute", top: "-20%", left: "50%", transform: "translateX(-50%)",
        width: "600px", height: "400px",
        background: "radial-gradient(ellipse, rgba(124,106,247,0.06) 0%, transparent 70%)",
        pointerEvents: "none", zIndex: 0,
      }} />

      {/* ── Header ── */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: "60px",
        background: "var(--bg-2)",
        borderBottom: "1px solid var(--border)",
        zIndex: 10, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            width: "36px", height: "36px", borderRadius: "10px",
            background: "linear-gradient(135deg, #4c3db5, #7c6af7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 20px rgba(124,106,247,0.3)",
          }}>
            <Zap size={18} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: "15px", letterSpacing: "-0.02em" }}>
              Competitor Research Agent
            </div>
            <div style={{
              fontSize: "11px", color: "var(--text-3)",
              fontFamily: "var(--font-mono)", letterSpacing: "0.04em",
            }}>
              Powered by Llama 3.3 · Cloudflare Workers AI
            </div>
          </div>
        </div>

        {/* Connection status */}
        <div style={{
          display: "flex", alignItems: "center", gap: "6px",
          padding: "5px 12px", borderRadius: "20px",
          background: connected ? "var(--green-dim)" : "rgba(248,113,113,0.1)",
          border: `1px solid ${connected ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
          fontSize: "11px", fontFamily: "var(--font-mono)",
          color: connected ? "var(--green)" : "var(--red)",
        }}>
          <div style={{
            width: "6px", height: "6px", borderRadius: "50%",
            background: connected ? "var(--green)" : "var(--red)",
            boxShadow: connected ? "0 0 6px var(--green)" : "none",
            animation: connected ? "pulse 2s ease infinite" : "none",
          }} />
          {connected ? "connected" : "reconnecting…"}
        </div>
      </header>

      {/* ── Messages ── */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "24px",
        display: "flex", flexDirection: "column", gap: "8px",
        zIndex: 1,
      }}>
        {/* Welcome screen */}
        {isEmpty && (
          <div style={{
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            flex: 1, gap: "16px", textAlign: "center",
            animation: "fadeIn 0.5s ease",
          }}>
            <div style={{
              width: "72px", height: "72px", borderRadius: "20px",
              background: "linear-gradient(135deg, #4c3db5, #7c6af7)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 40px rgba(124,106,247,0.3)",
            }}>
              <Zap size={34} color="#fff" />
            </div>
            <div>
              <h1 style={{
                fontSize: "26px", fontWeight: 800, letterSpacing: "-0.03em",
                background: "linear-gradient(135deg, #fff 30%, var(--accent-2))",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                marginBottom: "8px",
              }}>
                Competitive Intelligence
              </h1>
              <p style={{ color: "var(--text-2)", fontSize: "14px", maxWidth: "420px", lineHeight: 1.6 }}>
                Research competitors, track pricing & features, and get AI-powered insights — all stored in persistent memory.
              </p>
            </div>

            {/* Capabilities pills */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center", maxWidth: "500px" }}>
              {[
                { icon: <Globe size={12} />, text: "Web scraping" },
                { icon: <Database size={12} />, text: "Vector memory" },
                { icon: <BarChart3 size={12} />, text: "Comparison" },
                { icon: <RefreshCw size={12} />, text: "Auto-refresh" },
              ].map(({ icon, text }) => (
                <div key={text} style={{
                  display: "flex", alignItems: "center", gap: "5px",
                  padding: "5px 12px", borderRadius: "20px",
                  background: "var(--surface)", border: "1px solid var(--border)",
                  fontSize: "12px", color: "var(--text-2)",
                }}>
                  {icon} {text}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Message list */}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {/* Typing indicator */}
        {isLoading && !messages.some((m) => m.id === "streaming") && (
          <TypingIndicator />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Quick actions ── */}
      {showQuickActions && isEmpty && (
        <div style={{
          padding: "0 24px 12px",
          display: "flex", gap: "8px", flexWrap: "wrap",
          zIndex: 1,
          animation: "fadeIn 0.4s ease 0.2s both",
        }}>
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.label}
              onClick={() => handleQuickAction(a.prompt)}
              style={{
                display: "flex", alignItems: "center", gap: "5px",
                padding: "7px 14px", borderRadius: "20px",
                background: "var(--surface-2)", border: "1px solid var(--border)",
                color: "var(--text-2)", fontSize: "12px", cursor: "pointer",
                fontFamily: "var(--font-sans)", transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--accent-glow)";
                (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)";
                (e.currentTarget as HTMLElement).style.color = "var(--accent-2)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--surface-2)";
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                (e.currentTarget as HTMLElement).style.color = "var(--text-2)";
              }}
            >
              <ChevronRight size={11} />
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Input bar ── */}
      <div style={{
        padding: "16px 24px 20px",
        background: "var(--bg-2)",
        borderTop: "1px solid var(--border)",
        zIndex: 10, flexShrink: 0,
      }}>
        <div style={{
          display: "flex", gap: "12px", alignItems: "flex-end",
          background: "var(--surface)",
          border: "1px solid var(--border-bright)",
          borderRadius: "16px",
          padding: "12px 16px",
          transition: "border-color 0.2s ease",
          boxShadow: "0 0 0 0 transparent",
        }}
          onFocusCapture={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)";
            (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 3px var(--accent-glow)";
          }}
          onBlurCapture={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "var(--border-bright)";
            (e.currentTarget as HTMLElement).style.boxShadow = "none";
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a company agent (e.g. 'google.com'), then ask debate questions..."
            rows={1}
            disabled={isLoading}
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              color: "var(--text)", fontSize: "14px", lineHeight: "1.5",
              resize: "none", fontFamily: "var(--font-sans)",
              maxHeight: "120px", overflowY: "auto",
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            style={{
              width: "36px", height: "36px", borderRadius: "10px",
              background: input.trim() && !isLoading
                ? "linear-gradient(135deg, #4c3db5, #7c6af7)"
                : "var(--surface-2)",
              border: "none", cursor: input.trim() && !isLoading ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, transition: "all 0.2s ease",
              boxShadow: input.trim() && !isLoading ? "0 4px 12px rgba(124,106,247,0.35)" : "none",
            }}
          >
            {isLoading
              ? <Loader2 size={16} color="var(--text-3)" style={{ animation: "spin 1s linear infinite" }} />
              : <Send size={15} color={input.trim() ? "#fff" : "var(--text-3)"} />}
          </button>
        </div>
        <div style={{
          textAlign: "center", marginTop: "8px",
          fontSize: "11px", color: "var(--text-3)", fontFamily: "var(--font-mono)",
        }}>
          Enter to send · Shift+Enter for new line · Powered by Cloudflare Workers AI
        </div>
      </div>

      {/* ── CSS animations ── */}
      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
