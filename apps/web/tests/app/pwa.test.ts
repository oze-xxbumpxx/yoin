import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));

function expectIcon(path: string, size: number) {
  const icon = read(`public${path}`);
  expect(icon.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(icon.readUInt32BE(16)).toBe(size);
  expect(icon.readUInt32BE(20)).toBe(size);
  expect(icon).toEqual(read(`../../docs/design-assets/icon/${path.split("/").at(-1)}`));
}

describe("U07 PWA", () => {
  it("points to the yoin manifest and uses the approved Apple icon", () => {
    const html = read("index.html").toString();
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    const apple = html.match(/<link rel="apple-touch-icon" sizes="180x180" href="([^"]+)"/u);
    expect(apple).not.toBeNull();
    expectIcon(apple?.[1] ?? "", 180);
  });

  it("ships normal and maskable icons at both required sizes", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest").toString());
    expect(manifest).toMatchObject({ name: "yoin", short_name: "yoin", scope: "/", start_url: "/", display: "standalone" });
    expect(manifest.icons).toHaveLength(4);
    for (const purpose of ["any", "maskable"]) {
      for (const size of [192, 512]) {
        const icon = manifest.icons.find((item: { sizes: string; purpose: string }) =>
          item.sizes === `${size}x${size}` && item.purpose === purpose);
        expect(icon).toMatchObject({ type: "image/png" });
        expectIcon(icon.src, size);
      }
    }
  });

  it("defines both palettes and uses only the self-hosted Latin Figtree subset", () => {
    const css = read("src/styles/app.css").toString();
    const light = css.match(/:root\s*\{([^}]+)/u)?.[1] ?? "";
    const dark = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]+)/u)?.[1] ?? "";
    const tokens = [
      ["bg", "f7f5f1", "121212"], ["surface", "ffffff", "1f1f1f"], ["raised", "ece9e3", "2a2a2a"],
      ["text", "121212", "ffffff"], ["text-sub", "6b6b6b", "b3b3b3"], ["accent", "f5b83d", "f5b83d"],
      ["accent-ink", "9a6200", "f5b83d"], ["accent-soft", "fff0d1", "3a2a10"], ["danger", "d93a4a", "f3727f"],
      ["fade-to", "ece9e3", "1c1c1c"],
    ];
    for (const [name, lightValue, darkValue] of tokens) {
      expect(light).toContain(`--${name}: #${lightValue};`);
      const darkOverride = dark.match(new RegExp(`--${name}: (#\\w+);`, "u"))?.[1];
      expect(darkOverride ?? `#${lightValue}`).toBe(`#${darkValue}`);
    }
    expect(css).toContain("figtree-latin-wght-normal.woff2");
    expect(css).toContain('font-latin: "Figtree Variable"');
    expect(css).toContain('font-sans: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN"');
    expect(css).toContain("font-variant-numeric: tabular-nums");
  });
});
