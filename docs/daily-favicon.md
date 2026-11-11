# 每天轮换的 Ghost 图标

两个前端共用 `@hadesd/ui/daily-favicon`。按北京时间（Asia/Shanghai，UTC+08:00）的星期轮换浏览器标签页图标，不依赖访问者所在时区，不需要服务器定时任务或每天重新发布。

| 星期 | 图标 |
| --- | --- |
| 周一 | 蜜桃 · 眨眼 |
| 周二 | 浅紫 · 困困 |
| 周三 | 晴蓝 · 好奇 |
| 周四 | 薄荷 · 微笑 |
| 周五 | 杏橙 · 开心 |
| 周六 | 莓粉 · 害羞 |
| 周日 | 雾蓝 · 满足 |

[打开七款预览](ghost-icons.html)。SVG 源文件位于 `packages/ui/src/ghosts/`，按统一 32 × 32 网格绘制，参考已选的蜜桃、浅紫、晴蓝像素 Ghost 方向，使用完整对称下摆。没有外部图片、字体或脚本依赖。

页面初始化后选择当天图标；持续打开的页面在下一个北京时间午夜更新。重新聚焦、标签页恢复可见及浏览器前进后退缓存恢复时会重新校准。静态 HTML 与首次 hydration 始终使用周一图标，避免构建日期固化与 hydration 不一致；禁用 JavaScript 时保留周一图标。此功能只更换浏览器 favicon，不会轮换系统已保存的主屏幕快捷方式或站内文字标识。

两站通过 Vite 的 `?no-inline` 导入同一组 SVG，构建时分别输出到带哈希的 `/assets/` 和 `/journal-assets/`。每日选择不同 URL，既能沿用不可变缓存，也不需要添加随机参数。导入方式参见 [Vite 静态资源文档](https://vite.dev/guide/assets#explicit-inline-handling)。

替换图案时编辑七个 SVG 后正常发布即可。若要取消轮换，将两个 `app/root.tsx` 中的 `DailyFavicon` 换为普通 `link rel="icon"`；两个 `public/favicon.svg` 提供稳定的后备图标。测试位于 `apps/journal/app/DailyFavicon.test.tsx`，覆盖星期映射、午夜与跨年边界、周循环、SSR、唤醒恢复和定时器清理。
