import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";

export const setMurmurHighlight =
  StateEffect.define<{ from: number; to: number } | null>();

const activeMark = Decoration.mark({ class: "murmur-active" });

export const murmurHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setMurmurHighlight)) {
        if (e.value === null) {
          decorations = Decoration.none;
        } else {
          const max = tr.state.doc.length;
          const from = Math.max(0, Math.min(e.value.from, max));
          const to = Math.max(0, Math.min(e.value.to, max));
          decorations =
            from < to
              ? Decoration.set([activeMark.range(from, to)])
              : Decoration.none;
        }
      }
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});
