import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import { callConvexQuery } from "./convex";

const CONVEX_URL = "https://glad-camel-940.convex.cloud";

function makeFetchMock(status: number, body: unknown): Mock {
  return vi.fn(
    async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })
  );
}

function setFetch(mock: Mock) {
  globalThis.fetch = mock as unknown as typeof fetch;
}

describe("callConvexQuery", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POSTs to /api/query with the right body shape and returns the value", async () => {
    const mock = makeFetchMock(200, { status: "success", value: { businessName: "Dusk Plumbing", week1: ["a"] } });
    setFetch(mock);

    const result = await callConvexQuery<{ businessName: string; week1: string[] }>({
      functionName: "audit_chatbot_leads:get",
      args: { id: "abc-123" },
    });

    expect(mock).toHaveBeenCalledOnce();
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${CONVEX_URL}/api/query`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      path: "audit_chatbot_leads:get",
      args: { id: "abc-123" },
      format: "json",
    });
    expect(result).toEqual({ businessName: "Dusk Plumbing", week1: ["a"] });
  });

  it("returns null when Convex responds with a null value (e.g., row not found)", async () => {
    setFetch(makeFetchMock(200, { status: "success", value: null }));

    const result = await callConvexQuery({
      functionName: "audit_chatbot_leads:get",
      args: { id: "missing" },
    });

    expect(result).toBe(null);
  });

  it("throws on a non-2xx response", async () => {
    setFetch(makeFetchMock(500, "internal error"));

    await expect(
      callConvexQuery({ functionName: "audit_chatbot_leads:get", args: { id: "x" } })
    ).rejects.toThrow(/Convex query failed \(500\)/);
  });

  it("throws when Convex returns status: error", async () => {
    setFetch(makeFetchMock(200, { status: "error", errorMessage: "Function not found" }));

    await expect(
      callConvexQuery({ functionName: "nope", args: {} })
    ).rejects.toThrow(/Function not found/);
  });

  it("propagates fetch errors (network down / CORS / etc.)", async () => {
    setFetch(vi.fn(async () => {
      throw new Error("network down");
    }));

    await expect(callConvexQuery({ functionName: "x", args: {} })).rejects.toThrow(/network down/);
  });
});
