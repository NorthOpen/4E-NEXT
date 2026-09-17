import { mdToHtml } from "./lib/markdown";
import { safeHtml } from "./lib/sanitize";
import { CREATION_FIELDS, type Character } from "./sheet/character";

interface Props {
  mode: "edit" | "render";
  char: Character;
  setChar: React.Dispatch<React.SetStateAction<Character>>;
}

export default function BackgroundView({ mode, char, setChar }: Props) {
  return (
    <div className="background">
      <section className="block">
        <div className="block-head">
          <h3 className="block-title">人物背景</h3>
        </div>
        {mode === "edit" ? (
          CREATION_FIELDS.map((f) => (
            <div key={f.key} className="bg-field">
              <div className="bg-label">{f.label}</div>
              <textarea
                className="bg-input"
                value={char.creation[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => setChar((p) => ({ ...p, creation: { ...p.creation, [f.key]: e.target.value } }))}
              />
            </div>
          ))
        ) : CREATION_FIELDS.some((f) => char.creation[f.key].trim()) ? (
          CREATION_FIELDS.map((f) =>
            char.creation[f.key].trim() ? (
              <div key={f.key} className="bg-field">
                <div className="bg-label">{f.label}</div>
                <div className="bg-render" dangerouslySetInnerHTML={safeHtml(mdToHtml(char.creation[f.key]))} />
              </div>
            ) : null
          )
        ) : (
          <p className="hint">尚未填写人物背景内容。</p>
        )}
      </section>
    </div>
  );
}
