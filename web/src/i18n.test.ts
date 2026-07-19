import { expect, it } from "vitest";
import { resolveLanguage, strings } from "./i18n";

it("resolves Simplified Chinese from browser languages", () => {
  expect(resolveLanguage("auto", ["zh-CN", "en-US"])).toBe("zh-CN");
});

it("falls back to English for automatic non-Chinese languages", () => {
  expect(resolveLanguage("auto", ["fr-FR", "en-US"])).toBe("en");
});

it("formats hidden path segment labels in both supported languages", () => {
  expect(strings.en.hiddenPathSegments(3)).toBe("Show 3 hidden folders");
  expect(strings["zh-CN"].hiddenPathSegments(3)).toBe("显示 3 个隐藏文件夹");
});
