import { describe, expect, it } from "vitest";
import { hasLocalBrowser } from "../src/browser.js";

describe("hasLocalBrowser", () => {
  it("returns false over SSH regardless of platform", () => {
    expect(hasLocalBrowser({ SSH_CONNECTION: "1" }, "darwin")).toBe(false);
    expect(hasLocalBrowser({ SSH_TTY: "/dev/pts/0" }, "win32")).toBe(false);
    expect(hasLocalBrowser({ SSH_CLIENT: "1.2.3.4" }, "linux")).toBe(false);
  });

  it("returns false in container / CI environments", () => {
    expect(hasLocalBrowser({ KUBERNETES_SERVICE_HOST: "10.0.0.1" }, "darwin")).toBe(false);
    expect(hasLocalBrowser({ CI: "true" }, "darwin")).toBe(false);
    expect(hasLocalBrowser({ CONTAINER: "1" }, "linux")).toBe(false);
  });

  it("returns true on macOS and Windows desktops", () => {
    expect(hasLocalBrowser({}, "darwin")).toBe(true);
    expect(hasLocalBrowser({}, "win32")).toBe(true);
  });

  it("on Linux requires a graphical session", () => {
    expect(hasLocalBrowser({}, "linux")).toBe(false);
    expect(hasLocalBrowser({ DISPLAY: ":0" }, "linux")).toBe(true);
    expect(hasLocalBrowser({ WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBe(true);
  });

  it("SSH/CI signals win even when a display is set", () => {
    expect(hasLocalBrowser({ DISPLAY: ":0", SSH_CONNECTION: "1" }, "linux")).toBe(false);
  });
});
