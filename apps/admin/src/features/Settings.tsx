import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SiteSettings } from "@hadesd/contracts";
import { api } from "../api";
import { useUi } from "../store";
import { usePublish } from "./Publishing";
import { ErrorNotice, Loading, PageHeading } from "../components/Shared";
import styles from "../styles.module.css";
export default function Settings() {
  const query = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
  return <SettingsForm initial={query.data} />;
}
function SettingsForm({ initial }: { initial: SiteSettings }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [message, setMessage] = useState("");
  const publish = usePublish();
  const client = useQueryClient();
  const dirty = JSON.stringify(value) !== saved;
  const save = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: (next, submitted) => {
      setSaved(JSON.stringify(submitted));
      setMessage("站点设置已保存。发布一个新版本后，公开站点会更新。");
      client.setQueryData(["settings"], next);
    },
  });
  useEffect(() => {
    useUi.getState().setDirty(dirty, save.isPending);
  }, [dirty, save.isPending]);
  useEffect(() => () => useUi.getState().setDirty(false), []);
  const field = <K extends keyof SiteSettings>(
    key: K,
    next: SiteSettings[K],
  ) => {
    setMessage("");
    setValue((v) => ({ ...v, [key]: next }));
  };
  return (
    <>
      <PageHeading
        eyebrow="MAKE THIS SPACE YOURS"
        title="站点设置"
        description="用自己的文字，介绍自己的世界。"
        action={
          <button
            form="site-settings"
            className={styles.primary}
            disabled={!dirty || save.isPending}
          >
            {save.isPending ? "保存中…" : "保存设置"}
          </button>
        }
      />
      {save.error && <ErrorNotice error={save.error} />}
      {publish.error && <ErrorNotice error={publish.error} />}
      {message && (
        <p role="status" className={styles.successNote}>
          {message}
        </p>
      )}
      <form
        id="site-settings"
        className={styles.settingsForm}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(value);
        }}
      >
        <section className={styles.settingsSection}>
          <div>
            <p className={styles.eyebrow}>01 / IDENTITY</p>
            <h2>站点与介绍</h2>
            <p>这些文字构成访客的第一印象。</p>
          </div>
          <div className={styles.settingsFields}>
            <label>
              站点名称
              <input
                required
                maxLength={100}
                value={value.title}
                onChange={(e) => field("title", e.target.value)}
              />
            </label>
            <label>
              一句话标语
              <input
                maxLength={200}
                value={value.tagline}
                onChange={(e) => field("tagline", e.target.value)}
              />
            </label>
            <label>
              个人简介
              <textarea
                rows={4}
                maxLength={500}
                value={value.introduction}
                onChange={(e) => field("introduction", e.target.value)}
              />
            </label>
            <label>
              首页短文案
              <textarea
                rows={3}
                maxLength={5000}
                value={value.homeText}
                onChange={(e) => field("homeText", e.target.value)}
              />
            </label>
          </div>
        </section>
        <section className={styles.settingsSection}>
          <div>
            <p className={styles.eyebrow}>02 / NAVIGATION</p>
            <h2>导航入口</h2>
            <p>按显示顺序填写站内栏目。</p>
          </div>
          <div className={styles.settingsFields}>
            {value.navigation.map((nav, i) => (
              <div className={styles.linkEditor} key={i}>
                <label>
                  名称
                  <input
                    required
                    maxLength={40}
                    value={nav.label}
                    onChange={(e) =>
                      field(
                        "navigation",
                        value.navigation.map((n, index) =>
                          index === i ? { ...n, label: e.target.value } : n,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  站内路径
                  <input
                    required
                    pattern="/(?!/).*"
                    placeholder="/posts"
                    maxLength={200}
                    value={nav.href}
                    onChange={(e) =>
                      field(
                        "navigation",
                        value.navigation.map((n, index) =>
                          index === i ? { ...n, href: e.target.value } : n,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  aria-label={`移除导航 ${nav.label || i + 1}`}
                  onClick={() =>
                    field(
                      "navigation",
                      value.navigation.filter((_, index) => index !== i),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.textButton}
              disabled={value.navigation.length >= 15}
              onClick={() =>
                field("navigation", [
                  ...value.navigation,
                  { label: "", href: "/" },
                ])
              }
            >
              ＋ 添加导航入口
            </button>
          </div>
        </section>
        <section className={styles.settingsSection}>
          <div>
            <p className={styles.eyebrow}>03 / CONNECTIONS</p>
            <h2>外部链接</h2>
            <p>
              只展示你愿意分享的链接。
              <br />
              未填写的项目不会出现在公开站点。
            </p>
          </div>
          <div className={styles.settingsFields}>
            {!value.links.length && (
              <p className={styles.muted}>尚未添加外部链接。</p>
            )}
            {value.links.map((link, i) => (
              <div className={styles.externalLinkEditor} key={i}>
                <div className={styles.linkEditor}>
                  <label>
                    名称
                    <input
                      required
                      maxLength={80}
                      value={link.label}
                      onChange={(e) =>
                        field(
                          "links",
                          value.links.map((n, index) =>
                            index === i ? { ...n, label: e.target.value } : n,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    链接地址
                    <input
                      required
                      pattern="(https?://|mailto:).+"
                      placeholder="https://…"
                      maxLength={1000}
                      value={link.url}
                      onChange={(e) =>
                        field(
                          "links",
                          value.links.map((n, index) =>
                            index === i ? { ...n, url: e.target.value } : n,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={`移除外部链接 ${link.label || i + 1}`}
                    onClick={() =>
                      field(
                        "links",
                        value.links.filter((_, index) => index !== i),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
                <label>
                  说明（可选）
                  <input
                    maxLength={200}
                    value={link.description || ""}
                    onChange={(e) =>
                      field(
                        "links",
                        value.links.map((n, index) =>
                          index === i
                            ? { ...n, description: e.target.value }
                            : n,
                        ),
                      )
                    }
                  />
                </label>
              </div>
            ))}
            <button
              type="button"
              className={styles.textButton}
              disabled={value.links.length >= 50}
              onClick={() =>
                field("links", [
                  ...value.links,
                  { label: "", url: "", description: "" },
                ])
              }
            >
              ＋ 添加外部链接
            </button>
          </div>
        </section>
        <div className={styles.settingsBottom}>
          <span>
            {dirty ? "有未保存的修改" : "所有设置已保存"} ·
            保存后需要发布才能更新线上版本
          </span>
          <div className={styles.inlineActions}>
            <button
              type="button"
              disabled={dirty || save.isPending || publish.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    "发布已保存的站点设置？当前公开内容保持现有修订。",
                  )
                )
                  publish.mutate({ operation: "SETTINGS" });
              }}
            >
              发布站点设置 ↗
            </button>
            <button
              className={styles.primary}
              disabled={!dirty || save.isPending}
            >
              {save.isPending ? "保存中…" : "保存设置"}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
