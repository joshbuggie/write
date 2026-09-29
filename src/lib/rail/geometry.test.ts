import { describe, expect, it } from "vitest";
import { indexAt, railStops, stepFrom, thumbSize } from "./geometry";

describe("railStops", () => {
  it("puts the title at the top and each heading just below the sticky header", () => {
    expect(railStops([40, 500, 1200], 60, 5000)).toEqual([0, 440, 1140]);
  });

  it("clamps headings the page can't scroll to, without ever going backwards", () => {
    expect(railStops([40, 30, 900, 1500, 1600], 60, 1000)).toEqual([0, 0, 840, 1000, 1000]);
  });
});

describe("indexAt", () => {
  const stops = [0, 400, 800, 800, 1000];

  it("is whole at a heading and fractional between two", () => {
    expect(indexAt(stops, 0)).toBe(0);
    expect(indexAt(stops, 400)).toBe(1);
    expect(indexAt(stops, 600)).toBe(1.5);
  });

  it("skips headings that share a position, and ends on the last", () => {
    expect(indexAt(stops, 900)).toBe(3.5);
    expect(indexAt(stops, 1000)).toBe(4);
  });

  it("never reads a whole step before the next heading is reached", () => {
    expect(indexAt(stops, 399)).toBeLessThan(1);
  });
});

describe("stepFrom", () => {
  it("goes to the next heading", () => {
    expect(stepFrom(2, 1)).toBe(3);
    expect(stepFrom(2.6, 1)).toBe(3);
  });

  it("goes back to the current section's heading before the one before it", () => {
    expect(stepFrom(2.6, -1)).toBe(2);
    expect(stepFrom(2, -1)).toBe(1);
  });
});

describe("thumbSize", () => {
  it("is proportional between 28 and 52 px", () => {
    expect(thumbSize(800, 20000, 800)).toBe(32);
    expect(thumbSize(800, 50000, 800)).toBe(28);
    expect(thumbSize(900, 3000, 850)).toBe(52);
  });
});
