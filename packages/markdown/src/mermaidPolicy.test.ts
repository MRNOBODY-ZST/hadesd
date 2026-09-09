import { describe, expect, it } from "vitest";
import { validateDiagram } from "./mermaidPolicy";
describe("bounded author-controlled diagram input", () => {
  it("rejects config directives and front matter before loading the renderer", () => {
    expect(validateDiagram('%%{init: {"securityLevel":"loose"}}%%\ngraph TD;A-->B')).toBeTruthy();
    expect(validateDiagram('---\nconfig:\n securityLevel: loose\n---\ngraph TD;A-->B')).toBeTruthy();
    expect(validateDiagram('graph TD\n%% plain comment\nA-->B')).toBeNull();
  });
  it("bounds source work and accepts ordinary diagrams", () => {
    expect(validateDiagram('')).toBeTruthy(); expect(validateDiagram('a'.repeat(20_001))).toBeTruthy();
    expect(validateDiagram('sequenceDiagram\n Alice->>Bob: Hello')).toBeNull();
  });
});
