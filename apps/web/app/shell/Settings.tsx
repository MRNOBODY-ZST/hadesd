import { TerminalProgram } from "./TerminalProgram";
import { usePreferences } from "./store";
import type { Theme, CrtLevel } from "@hadesd/contracts";
export function Settings() {
  const p = usePreferences();
  return (
    <TerminalProgram
      label="DISPLAY / 显示设置"
      onClose={() => p.toggle("settingsOpen", false)}
      help="theme amber|green|paper · crt off|low|full · reader on|off · :q 返回"
      onCommand={command => {
        const [name, value, extra] = command.split(/\s+/);
        if (!extra && name === "theme" && ["amber", "green", "paper"].includes(value)) { p.setTheme(value as Theme); return "主题已保存。"; }
        if (!extra && name === "crt" && ["off", "low", "full"].includes(value)) { p.setCrt(value as CrtLevel); return "CRT 设置已保存。"; }
        if (!extra && name === "reader" && ["on", "off"].includes(value)) { p.setReader(value === "on"); return "阅读设置已保存。"; }
        return "用法：theme amber|green|paper，crt off|low|full，reader on|off。";
      }}
    >
      <div className="settings-body">
        <fieldset>
          <legend>界面主题</legend>
          <div className="segmented">
            {(["amber", "green", "paper"] as Theme[]).map((t, i) => (
              <button
                key={t}
                aria-pressed={p.theme === t}
                onClick={() => p.setTheme(t)}
              >
                <span className={"theme-dot " + t} />
                {["琥珀", "荧绿", "纸张"][i]}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>CRT 氛围</legend>
          <div className="segmented">
            {(["off", "low", "full"] as CrtLevel[]).map((v, i) => (
              <button
                key={v}
                aria-pressed={p.crt === v}
                onClick={() => p.setCrt(v)}
              >
                {["关闭", "轻微", "完整"][i]}
              </button>
            ))}
          </div>
          <p>
            完整模式显示 GPU
            曲面、辉光与动态场景。减少动态效果时自动减轻运动；关闭模式保留原生终端文字。
          </p>
        </fieldset>
        <label className="reader-setting">
          <span>
            专注阅读<small>关闭环境光效，保留终端与逐屏阅读。</small>
          </span>
          <input
            type="checkbox"
            checked={p.reader}
            onChange={(e) => p.setReader(e.target.checked)}
          />
        </label>
        <p className="settings-note">设置仅保存在当前浏览器。</p>
      </div>
    </TerminalProgram>
  );
}
