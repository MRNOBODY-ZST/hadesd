// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { validateUpload } from "./MediaLibrary";
describe("upload client bounds", () => {
  it("rejects active formats and empty files before a network request", () => {
    expect(
      validateUpload(new File(["<svg/>"], "a.svg", { type: "image/svg+xml" })),
    ).toContain("仅支持");
    expect(
      validateUpload(new File(["<script/>"], "a.html", { type: "text/html" })),
    ).toContain("仅支持");
    expect(
      validateUpload(new File([], "a.png", { type: "image/png" })),
    ).toContain("空文件");
  });
  it("applies separate actual-size limits to images and PDFs", () => {
    const image = new File(
      [new Uint8Array(10 * 1024 * 1024 + 1)],
      "large.png",
      { type: "image/png" },
    );
    const pdf = new File([new Uint8Array(25 * 1024 * 1024 + 1)], "large.pdf", {
      type: "application/pdf",
    });
    expect(validateUpload(image)).toContain("10 MB");
    expect(validateUpload(pdf)).toContain("25 MB");
    expect(
      validateUpload(
        new File(["sample"], "valid.webp", { type: "image/webp" }),
      ),
    ).toBeNull();
  });
});
