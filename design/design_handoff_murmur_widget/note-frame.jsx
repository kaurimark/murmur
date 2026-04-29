// Reusable Obsidian-note frame so each variation sits in identical context.
// Uses CSS vars so we can flip light/dark and theme accent.

const NoteFrame = ({ children, theme = "light", title = "demo-claude-design-research", showBody = true, scale = 1 }) => {
  const isDark = theme === "dark";
  const vars = isDark
    ? {
        "--m-bg": "#1e1e1e",
        "--m-bg-secondary": "#262626",
        "--m-bg-secondary-alt": "#2a2a2a",
        "--m-text": "#dcdcdc",
        "--m-text-muted": "#9a9a9a",
        "--m-text-faint": "#6a6a6a",
        "--m-border": "rgba(255,255,255,0.08)",
        "--m-accent": "#a78bfa",
        "--m-hover": "rgba(255,255,255,0.06)",
        "--m-active": "rgba(167,139,250,0.18)",
        "--m-shadow": "0 1px 2px rgba(0,0,0,0.4)",
        "--m-traffic": "#3a3a3a",
      }
    : {
        "--m-bg": "#fffdf3",
        "--m-bg-secondary": "#f7f3e0",
        "--m-bg-secondary-alt": "#f0ecd6",
        "--m-text": "#1c1c1c",
        "--m-text-muted": "#6b6b6b",
        "--m-text-faint": "#a8a39a",
        "--m-border": "rgba(0,0,0,0.08)",
        "--m-accent": "#7c5cff",
        "--m-hover": "rgba(0,0,0,0.04)",
        "--m-active": "rgba(124,92,255,0.12)",
        "--m-shadow": "0 1px 2px rgba(0,0,0,0.05)",
        "--m-traffic": "#e0dccc",
      };

  return (
    <div
      style={{
        ...vars,
        background: "var(--m-bg)",
        color: "var(--m-text)",
        borderRadius: 14,
        boxShadow: isDark
          ? "0 20px 50px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.35)"
          : "0 20px 50px rgba(120,100,40,0.10), 0 2px 6px rgba(120,100,40,0.06)",
        overflow: "hidden",
        fontFamily: '"iA Writer Quattro", "Source Serif Pro", "Iowan Old Style", Georgia, serif',
        width: "100%",
      }}
    >
      {/* Window chrome */}
      <div style={{ display: "flex", gap: 8, padding: "14px 16px 10px" }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <div key={c} style={{ width: 12, height: 12, borderRadius: 999, background: c }} />
        ))}
      </div>

      {/* Title */}
      <div style={{ padding: "0 56px 20px" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: '"Iowan Old Style", "Source Serif Pro", Georgia, serif',
            fontWeight: 800,
            fontSize: 32,
            letterSpacing: "-0.01em",
            lineHeight: 1.1,
            color: "var(--m-text)",
          }}
        >
          {title}
        </h1>
      </div>

      {/* Slot for widget */}
      <div style={{ padding: "0 56px" }}>{children}</div>

      {/* Note body */}
      {showBody && (
        <div
          style={{
            padding: "28px 56px 48px",
            fontFamily: '"Iowan Old Style", "Source Serif Pro", Georgia, serif',
            fontSize: 20,
            lineHeight: 1.55,
            color: "var(--m-text)",
          }}
        >
          <div style={{ display: "flex", gap: 14 }}>
            <span style={{ color: "var(--m-text-faint)", flexShrink: 0 }}>•</span>
            <span>
              Claude actually doesn't have the data for Claude Design because it's so recent.
              <span style={{ display: "inline-block", width: 1, height: "1em", background: "var(--m-text)", marginLeft: 1, verticalAlign: "-3px" }} />
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// Tiny SVG icon set so we don't depend on lucide
const Icon = ({ name, size = 16, stroke = 1.6 }) => {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  switch (name) {
    case "play":
      return (
        <svg {...common}>
          <path d="M6 4.5v15l13-7.5z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pause":
      return (
        <svg {...common}>
          <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
          <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "skip-back":
      return (
        <svg {...common}>
          <polygon points="19 20 9 12 19 4" fill="currentColor" stroke="none" />
          <line x1="5" y1="19" x2="5" y2="5" />
        </svg>
      );
    case "skip-forward":
      return (
        <svg {...common}>
          <polygon points="5 4 15 12 5 20" fill="currentColor" stroke="none" />
          <line x1="19" y1="5" x2="19" y2="19" />
        </svg>
      );
    case "stop":
      return (
        <svg {...common}>
          <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "audio-lines":
      return (
        <svg {...common}>
          <path d="M2 12h2" />
          <path d="M6 8v8" />
          <path d="M10 4v16" />
          <path d="M14 8v8" />
          <path d="M18 10v4" />
          <path d="M22 12h0" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <line x1="5" y1="5" x2="19" y2="19" />
          <line x1="19" y1="5" x2="5" y2="19" />
        </svg>
      );
    case "arrow-up-right":
      return (
        <svg {...common}>
          <line x1="7" y1="17" x2="17" y2="7" />
          <polyline points="8 7 17 7 17 16" />
        </svg>
      );
    default:
      return null;
  }
};

window.NoteFrame = NoteFrame;
window.Icon = Icon;
