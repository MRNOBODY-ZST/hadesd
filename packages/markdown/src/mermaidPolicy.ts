export function validateDiagram(source: string): string | null {
  if (source.length > 20_000) return "图表超过 20,000 字符，请拆分后重试。";
  if (!source.trim()) return "图表内容为空。";
  // Diagram authors cannot override the site's renderer/security configuration.
  if (/%%\s*\{|^\s*---(?:\r?\n|$)/m.test(source)) return "图表不接受初始化指令或配置前言，请仅保留图表语法。";
  return null;
}
