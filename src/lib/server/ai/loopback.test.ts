import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listModels, openReply } from ".";
import { chunkLine, failure, replyOf } from "./test-utils";
import { callUpstream, readBody } from "./upstream";

/**
 * The adapters against a real HTTP server on 127.0.0.1, through Node's own fetch: the other tests imitate
 * its error shapes (TypeError with a cause code, AbortError on the body), and this checks that they match.
 */

let server: Server;
let base: string;
let closed: Promise<void> = Promise.resolve();
const REQUEST = { system: "", messages: [{ role: "user" as const, content: "Hi" }] };

function route(req: IncomingMessage, res: ServerResponse) {
  if (req.url === "/redirect/chat/completions") {
    res.writeHead(301, { Location: "/v1/chat/completions" }).end();
  } else if (req.url === "/v1/chat/completions") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(chunkLine({ content: "Hel" }));
    setTimeout(() => res.end(chunkLine({ content: "lo" }, "stop") + "data: [DONE]\n\n"), 20);
  } else if (req.url === "/endless/chat/completions") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(chunkLine({ content: "tick" }));
    closed = new Promise((resolve) => res.on("close", resolve));
  } else if (req.url === "/drip" || req.url === "/stall") {
    // Twenty chunks 25 ms apart; /stall goes quiet after the first one.
    res.writeHead(200, { "Content-Type": "text/plain" });
    let sent = 0;
    const drip = () => {
      res.write(`chunk${sent++} `);
      if (sent === 20) res.end();
      else if (req.url === "/drip") setTimeout(drip, 25);
    };
    drip();
  } else if (req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" }).end('{"data":[{"id":"b"},{"id":"a"}]}');
  } else {
    res.writeHead(404).end();
  }
}

beforeAll(async () => {
  server = createServer(route);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const target = (path: string) => ({
  provider: "custom" as const,
  baseUrl: base + path,
  apiKey: null,
  model: "m",
});

describe("over a real socket", () => {
  it("streams a reply and lists models", async () => {
    expect(await replyOf(await openReply(target("/v1"), REQUEST, AbortSignal.timeout(5000)))).toEqual({
      text: "Hello",
      stop: "end",
    });
    expect(await listModels(target("/v1"), AbortSignal.timeout(5000))).toEqual(["a", "b"]);
  });

  it("refuses to follow a redirect", async () => {
    expect(
      (await failure(openReply(target("/redirect"), REQUEST, AbortSignal.timeout(5000)))).message,
    ).toMatch(/answered with a redirect/);
  });

  it("closes the upstream connection when the reader stops", async () => {
    const reply = await openReply(target("/endless"), REQUEST, AbortSignal.timeout(5000));
    expect(await reply.next()).toEqual({ done: false, value: { text: "tick" } });
    await reply.return(undefined);
    await closed; // the test times out if the connection stays open
  });

  it("blames a key that HTTP can't carry, before anything is sent", async () => {
    for (const apiKey of ["sk-abc\u200b", "sk-ab\u2014c"]) {
      const bad = { ...target("/v1"), apiKey };
      expect(await failure(openReply(bad, REQUEST, AbortSignal.timeout(5000)))).toEqual({
        code: "ai_upstream",
        message: `The API key for ${new URL(base).host} has a character that can't be sent, such as a space or an invisible one. Enter the key again in Settings.`,
      });
    }
  });

  it("times out on silence, never on a body that keeps coming", async () => {
    const read = async (path: string) => {
      const up = await callUpstream({
        url: new URL(base + path),
        method: "GET",
        headers: {},
        apiKey: null,
        signal: AbortSignal.timeout(5000),
        idleTimeoutMs: 250, // ten times a gap, about half the whole body
        notFound: "",
      });
      return readBody(up, 4096);
    };
    expect((await read("/drip")).text).toBe(Array.from({ length: 20 }, (_, i) => `chunk${i} `).join(""));
    expect(await failure(read("/stall"))).toEqual({
      code: "ai_upstream",
      message: `${new URL(base).host} went silent partway through its answer.`,
    });
  });

  it("names a port where nothing listens", async () => {
    const spare = createServer();
    await new Promise<void>((resolve) => spare.listen(0, "127.0.0.1", resolve));
    const port = (spare.address() as AddressInfo).port;
    await new Promise((resolve) => spare.close(resolve));
    const dead = { ...target(""), baseUrl: `http://127.0.0.1:${port}/v1` };
    expect(await failure(openReply(dead, REQUEST, AbortSignal.timeout(5000)))).toEqual({
      code: "ai_unreachable",
      message: `Couldn't reach 127.0.0.1:${port}: nothing answered there. Is the server running?`,
    });
  });
});
