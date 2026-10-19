import { afterEach, describe, expect, it } from "vitest";
import { isScreensaverShortcut, screensaverShortcutLabel } from "./Screensaver";

function keyEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    code: "KeyL",
    key: "L",
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...init,
  } as KeyboardEvent;
}

function setPlatform(platform: string) {
  Object.defineProperty(globalThis, "navigator", {
    value: { platform, userAgent: platform },
    configurable: true,
  });
}

describe("screensaver shortcut", () => {
  afterEach(() => setPlatform("Win32"));

  it("uses Ctrl+Shift+L on Windows and Linux", () => {
    setPlatform("Win32");
    expect(screensaverShortcutLabel()).toBe("Ctrl + Shift + L");
    expect(isScreensaverShortcut(keyEvent({ ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isScreensaverShortcut(keyEvent({ ctrlKey: true }))).toBe(false);
    expect(isScreensaverShortcut(keyEvent({ ctrlKey: true, shiftKey: true, code: "KeyK", key: "K" }))).toBe(false);
  });

  it("uses Command+Option+L on macOS even though Option changes the character", () => {
    setPlatform("MacIntel");
    expect(screensaverShortcutLabel()).toBe("⌘ ⌥ L");
    expect(isScreensaverShortcut(keyEvent({ metaKey: true, altKey: true, key: "¬" }))).toBe(true);
    expect(isScreensaverShortcut(keyEvent({ ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});
