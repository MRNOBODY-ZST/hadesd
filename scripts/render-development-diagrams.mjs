#!/usr/bin/env node
// Original explanatory diagrams. Render locally; no external images or services.
// Requires Playwright Chromium and a CJK system font (PingFang SC / Noto Sans CJK SC).
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
const out = resolve(import.meta.dirname, '../content/development/images');
await mkdir(out, { recursive: true });
const esc = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const text = (x, y, value, size = 30, color = '#202124', anchor = 'middle', weight = 500) => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${weight}">${esc(value)}</text>`;
const box = (x, y, w, h, title, subtitle, fill = '#fff', color = '#202124') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${fill}" stroke="#d7dce2"/>${text(x+w/2, y+(subtitle?42:h/2+10), title, 30, color)}${subtitle?text(x+w/2,y+78,subtitle,26,color):''}`;
const line = (d, color = '#6a7788') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="3" marker-end="url(#arrow)"/>`;
const base = (title, sub, body, h = 700) => `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${h}" viewBox="0 0 760 ${h}" role="img" aria-label="${title}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="#6a7788"/></marker></defs><rect width="760" height="${h}" fill="#f5f6f8"/><g font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Noto Sans CJK SC',sans-serif">${text(42,64,title,38,'#1d1d1f','start',650)}${text(42,107,sub,27,'#4b5663','start')}${body}</g></svg>`;
const diagrams = {
  'architecture-v1': base('一份内容，两个阅读入口', '保存决定草稿，发布决定读者看到什么。',
    box(40,145,680,100,'后台编辑 → 后端保存','修订留在数据库，保存不等于公开') +
    line('M380 245V288') + box(40,296,680,100,'冻结快照 → 发布器构建','同一份正文与设置，生成两套静态页面','#e9f1fb') +
    line('M380 396V423H206V453')+line('M380 423H554V453')+
    box(40,461,332,100,'终端站','hadesd.sh')+box(388,461,332,100,'阅读站','itshades.dev')+
    text(380,613,'两个域名共用一次版本切换',29,'#285b8e')+
    text(380,660,'搜索、账号、评论 → 同一个动态 API',27)),
  'terminal-v1': base('字在哪里，效果就画在哪里', '真实 DOM 是排版和交互的依据。',
    box(40,145,680,100,'DOM：正文、链接与输入框','选择文字、点击和中文输入都在这里')+
    line('M236 245V292')+line('M550 245V457')+
    box(40,300,390,100,'Canvas 纹理','按可见位置绘制内容','#e9f1fb')+
    line('M236 400V457')+
    box(40,465,390,100,'Three.js 图形层','扫描线、辉光等 CRT 效果')+
    box(462,465,258,100,'原生显示','关闭效果或回退')+
    text(380,620,'图形层改变观感，不重新定义点击位置。',27)+
    text(380,665,'图片可走原生叠层，避免跨域纹理问题。',26,'#4b5663')),
  'publishing-v1': base('发布的关键，是最后那次切换', '设定：旧版 A1 + B3，本次只发布 A2。',
    box(40,145,680,94,'冻结 A2 + B3','后台继续保存，也不改变这份输入')+
    line('M380 239V277')+
    box(40,285,680,94,'构建终端站，再构建阅读站','分别生成各自域名的页面与资源','#e9f1fb')+
    line('M380 379V414')+
    box(40,422,680,70,'两套产物都通过校验？','')+
    line('M235 492V550')+line('M555 492V550')+
    box(40,558,355,100,'通过：切换 current','两个域名一起更新','#e6f2eb')+
    box(411,558,309,100,'失败：保持旧版','修好后重新发布','#fbeee2')+
    text(380,710,'切换后回报失败？读 manifest 对账。',27,'#4b5663'),750),
  'hosting-v1': base('能恢复的备份，要把这些带齐', '同一实例、同一时间点，避免互相对不上。',
    box(40,145,332,110,'私有配置','域名、密钥与存储配置')+
    box(388,145,332,110,'MySQL','文章、账号与发布记录')+
    box(40,275,332,110,'媒体存储','本地文件或 S3 对象')+
    box(388,275,332,110,'发布目录','页面、快照与 current')+
    line('M380 403V447')+
    box(40,455,680,100,'在隔离环境恢复','核对正文、附件和当前版本后再开放流量','#e9f1fb')+
    text(380,607,'Redis 会话可以重建，让用户重新登录。',27)+
    text(380,653,'正文和图片不能靠重新登录找回来。',28,'#285b8e')),
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 760, height: 800 }, deviceScaleFactor: 2 });
  for (const [name, svg] of Object.entries(diagrams)) {
    await writeFile(resolve(out, `${name}.svg`), svg + '\n');
    await page.setContent(`<html lang="zh-CN"><style>body{margin:0}svg{display:block}</style>${svg}</html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('svg').screenshot({ path: resolve(out, `${name}.png`) });
    console.log(`Rendered ${name}.png`);
  }
} finally { await browser.close(); }
