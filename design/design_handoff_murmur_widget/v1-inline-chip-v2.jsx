// V1: Inline chip — refined
// Idle: pill with minutes counter ("Read aloud · 8 min")
// Playing: chip expands smoothly to full transport with scrubber
// Animation: outer container animates width + padding via CSS transitions;
// inner sections cross-fade. Toggle "playing" by clicking the chip.

const V1ChipV2 = ({ playing: forcedPlaying, dark, demo = false }) => {
  // If demo=true, the chip is interactive (click to toggle). Otherwise it
  // honors the forcedPlaying prop. This lets the canvas show static states,
  // and a demo artboard show the live transition.
  const [internalPlaying, setInternalPlaying] = React.useState(forcedPlaying);
  const playing = demo ? internalPlaying : forcedPlaying;

  const dur = "8:42";
  const pos = "2:13";
  const pct = 25;

  const onIdleClick = () => demo && setInternalPlaying(true);
  const onClose = () => demo && setInternalPlaying(false);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 32,
        background: playing ? "var(--m-bg-secondary)" : "transparent",
        border: "1px solid var(--m-border)",
        borderRadius: 999,
        color: "var(--m-text)",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: 12,
        overflow: "hidden",
        // Animate everything that changes between states.
        transition:
          "background 280ms ease, border-color 280ms ease, padding 280ms cubic-bezier(0.22, 1, 0.36, 1), max-width 320ms cubic-bezier(0.22, 1, 0.36, 1)",
        padding: playing ? "0 10px 0 4px" : "0 12px 0 10px",
        maxWidth: playing ? 380 : 130,
        cursor: playing ? "default" : "pointer",
      }}
      onClick={!playing ? onIdleClick : undefined}
    >
      {/* Idle face */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "var(--m-text-muted)",
          opacity: playing ? 0 : 1,
          transform: playing ? "translateX(-6px)" : "translateX(0)",
          transition: "opacity 180ms ease, transform 220ms ease",
          pointerEvents: playing ? "none" : "auto",
          // When hidden, take it out of layout so the playing face fills the chip.
          width: playing ? 0 : "auto",
          whiteSpace: "nowrap",
        }}
      >
        <Icon name="play" size={11} />
        <span>Read aloud</span>
        <span style={{ color: "var(--m-text-faint)" }}>· 8 min</span>
      </div>

      {/* Playing face */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          opacity: playing ? 1 : 0,
          transform: playing ? "translateX(0)" : "translateX(8px)",
          transition: "opacity 220ms ease 60ms, transform 280ms cubic-bezier(0.22, 1, 0.36, 1) 40ms",
          pointerEvents: playing ? "auto" : "none",
          width: playing ? "auto" : 0,
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        <button
          style={{
            width: 24,
            height: 24,
            borderRadius: 999,
            background: "var(--m-text)",
            color: "var(--m-bg)",
            border: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Icon name="pause" size={10} />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 2, color: "var(--m-text-muted)" }}>
          <button style={iconBtnStyleV2()} onClick={(e) => e.stopPropagation()}><Icon name="skip-back" size={11} /></button>
          <button style={iconBtnStyleV2()} onClick={(e) => e.stopPropagation()}><Icon name="skip-forward" size={11} /></button>
        </div>

        <div style={{ width: 130, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 11, color: "var(--m-text-muted)" }}>{pos}</span>
          <div style={{ flex: 1, height: 2, background: "var(--m-border)", borderRadius: 999, position: "relative" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct + "%", background: "var(--m-text)", borderRadius: 999, transition: "width 200ms linear" }} />
          </div>
          <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 11, color: "var(--m-text-faint)" }}>{dur}</span>
        </div>

        <button style={{ ...iconBtnStyleV2(), padding: "0 6px", width: "auto", fontSize: 11, color: "var(--m-text-muted)", fontFamily: "ui-sans-serif, system-ui, sans-serif" }} onClick={(e) => e.stopPropagation()}>1×</button>
        <button
          style={{ ...iconBtnStyleV2(), color: "var(--m-text-faint)" }}
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        >
          <Icon name="x" size={11} />
        </button>
      </div>
    </div>
  );
};

function iconBtnStyleV2() {
  return {
    height: 22,
    minWidth: 22,
    padding: 0,
    background: "transparent",
    border: "none",
    color: "var(--m-text-muted)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    flexShrink: 0,
  };
}

window.V1ChipV2 = V1ChipV2;
