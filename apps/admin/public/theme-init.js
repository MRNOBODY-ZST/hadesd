// Runs before styles and React; external script preserves the admin's strict CSP.
(() => {
  let theme = "paper";
  try {
    const saved = localStorage.getItem("hadesd.admin.theme.v1");
    if (["paper", "graphite", "glacier", "amber"].includes(saved)) theme = saved;
  } catch { /* Storage is optional. */ }
  document.documentElement.dataset.adminTheme = theme;
  document.documentElement.style.colorScheme = theme === "graphite" || theme === "amber" ? "dark" : "light";
  const chrome = { paper: "#f5f4ee", graphite: "#111419", glacier: "#eef3f8", amber: "#15130e" }[theme];
  document.documentElement.style.backgroundColor = chrome;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", chrome);
})();
