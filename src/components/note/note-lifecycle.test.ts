import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLifecycleHandlers,
  isLeavingClick,
  watchForLeaving,
  type LifecycleDeps,
} from "./note-lifecycle";

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(overrides: Partial<Omit<LifecycleDeps, "autosaver">> = {}, unsaved = false) {
  const autosaver = {
    flushKeepalive: vi.fn(),
    hasUnsavedChanges: vi.fn(() => unsaved),
    flush: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
  const deps: LifecycleDeps = {
    autosaver,
    isAbandoned: () => false,
    isRelocating: () => false,
    isThrowaway: () => false,
    discard: vi.fn(),
    ...overrides,
  };
  return { autosaver, deps, handlers: createLifecycleHandlers(deps) };
}

describe("onPageHide", () => {
  it("never discards an empty Untitled note (reload, back/forward cache)", () => {
    const t = setup({ isThrowaway: () => true });
    t.handlers.onPageHide();
    expect(t.deps.discard).not.toHaveBeenCalled();
    expect(t.autosaver.dispose).not.toHaveBeenCalled(); // the page may come back from the bfcache
  });

  it("sends the keepalive save", () => {
    const t = setup({}, true);
    t.handlers.onPageHide();
    expect(t.autosaver.flushKeepalive).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an abandoned note", () => {
    const t = setup({ isAbandoned: () => true }, true);
    t.handlers.onPageHide();
    expect(t.autosaver.flushKeepalive).not.toHaveBeenCalled();
  });
});

describe("onLeave", () => {
  it("discards an empty Untitled note when navigating away in the app", async () => {
    const t = setup({ isThrowaway: () => true });
    await t.handlers.onLeave();
    expect(t.deps.discard).toHaveBeenCalledTimes(1);
    expect(t.autosaver.flushKeepalive).not.toHaveBeenCalled();
    expect(t.autosaver.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not discard a note whose rename is still on its way", async () => {
    const t = setup({ isThrowaway: () => true, isRelocating: () => true });
    await t.handlers.onLeave();
    expect(t.deps.discard).not.toHaveBeenCalled();
    expect(t.autosaver.flushKeepalive).toHaveBeenCalledTimes(1);
  });

  it("saves pending edits, then stops the autosaver", async () => {
    const t = setup({}, true);
    await t.handlers.onLeave();
    expect(t.autosaver.flushKeepalive).toHaveBeenCalledTimes(1);
    expect(t.autosaver.flush).toHaveBeenCalledTimes(1);
    expect(t.autosaver.dispose.mock.invocationCallOrder[0]).toBeGreaterThan(
      t.autosaver.flush.mock.invocationCallOrder[0],
    );
  });
});

describe("isLeavingClick", () => {
  const here = { origin: "https://write.test", pathname: "/notes/notebook/Untitled" };
  const link = (href: string, attrs: Record<string, string> = {}) => ({
    href: new URL(href, here.origin).href,
    target: attrs.target ?? "",
    hasAttribute: (name: string) => name in attrs,
  });
  const click = (anchor: ReturnType<typeof link> | null, extra: Partial<MouseEvent> = {}) =>
    ({
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: { closest: () => anchor },
      ...extra,
    }) as unknown as MouseEvent;

  it("is true for a plain click on a link to another note or the library", () => {
    expect(isLeavingClick(click(link("/notes/notebook/Crlf")), here)).toBe(true);
    expect(isLeavingClick(click(link("/notes")), here)).toBe(true);
  });

  it("is false for clicks that keep this page", () => {
    expect(isLeavingClick(click(null), here)).toBe(false);
    expect(isLeavingClick(click(link(here.pathname)), here)).toBe(false);
    expect(isLeavingClick(click(link("/notes"), { metaKey: true }), here)).toBe(false);
    expect(isLeavingClick(click(link("/notes"), { button: 1 }), here)).toBe(false);
    expect(isLeavingClick(click(link("/api/download", { download: "" })), here)).toBe(false);
    expect(isLeavingClick(click(link("/notes", { target: "_blank" })), here)).toBe(false);
  });
});

describe("watchForLeaving", () => {
  function stubBrowser() {
    const location = { origin: "https://write.test", pathname: "/notes/notebook/Untitled" };
    vi.stubGlobal("window", Object.assign(new EventTarget(), { location }));
    vi.stubGlobal("document", new EventTarget());
    return location;
  }

  it("stays put while nothing happens, so the rename can follow the note", () => {
    stubBrowser();
    const leaving = watchForLeaving();
    expect(leaving.hasLeft()).toBe(false);
    leaving.stop();
  });

  it("notices a navigation that already committed", () => {
    const location = stubBrowser();
    const leaving = watchForLeaving();
    location.pathname = "/notes/notebook/Crlf";
    expect(leaving.hasLeft()).toBe(true);
  });

  it("notices back/forward, and stops listening when stopped", () => {
    stubBrowser();
    const first = watchForLeaving();
    window.dispatchEvent(new Event("popstate"));
    expect(first.hasLeft()).toBe(true);

    const second = watchForLeaving();
    second.stop();
    window.dispatchEvent(new Event("popstate"));
    expect(second.hasLeft()).toBe(false);
  });
});
