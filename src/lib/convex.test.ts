import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import { callConvexQuery, callConvexMutation, type ConvexCallOptions, type ConvexFunctionName } from "./convex";
import type { AuditChatbotLeadsCreateArgs } from "./convex-generated/audit-chatbot-types";

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

    const result = await callConvexQuery({
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
      // Cast: this test simulates a malformed function name to verify
      // the HTTP error path. Real callers can't pass arbitrary names
      // because the discriminated union blocks them at compile time.
      callConvexQuery({ functionName: "nope" as ConvexFunctionName, args: {} as never })
    ).rejects.toThrow(/Function not found/);
  });

  it("propagates fetch errors (network down / CORS / etc.)", async () => {
    setFetch(vi.fn(async () => {
      throw new Error("network down");
    }));

    await expect(
      callConvexQuery({ functionName: "x" as ConvexFunctionName, args: {} as never })
    ).rejects.toThrow(/network down/);
  });
});

describe("callConvexMutation", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POSTs to /api/mutation with the right body shape and returns the value", async () => {
    // The wizard submits name/email/company upfront and expects back a
    // chatbotLeadId to stash in the store so :update can target the same
    // row after the report lands. This pins the HTTP shape — if Convex
    // changes /api/mutation's contract, this test fails first.
    const mock = makeFetchMock(200, {
      status: "success",
      value: { chatbotLeadId: "lead-abc-789" },
    });
    setFetch(mock);

    const result = (await callConvexMutation({
      functionName: "audit_chatbot_leads:create",
      args: {
        name: "Jane Smith",
        email: "jane@example.com",
        company: "Smith Plumbing",
        findings: [],
        painPoints: [],
        manualTasks: [],
      },
    })) as { chatbotLeadId?: string } | null;

    expect(mock).toHaveBeenCalledOnce();
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${CONVEX_URL}/api/mutation`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      path: "audit_chatbot_leads:create",
      args: {
        name: "Jane Smith",
        email: "jane@example.com",
        company: "Smith Plumbing",
        findings: [],
        painPoints: [],
        manualTasks: [],
      },
      format: "json",
    });
    expect(result?.chatbotLeadId).toBe("lead-abc-789");
  });

  it("returns the raw value envelope (null is possible if Convex returns null)", async () => {
    setFetch(makeFetchMock(200, { status: "success", value: null }));
    const result = await callConvexMutation({
      functionName: "audit_chatbot_leads:create",
      args: { name: "x", email: "y@z.com", findings: [], painPoints: [], manualTasks: [] },
    });
    expect(result).toBe(null);
  });

  it("throws on a non-2xx response", async () => {
    setFetch(makeFetchMock(500, "boom"));

    await expect(
      callConvexMutation({
        functionName: "audit_chatbot_leads:create",
        args: { name: "x", email: "y@z.com", findings: [], painPoints: [], manualTasks: [] },
      })
    ).rejects.toThrow(/Convex mutation failed \(500\)/);
  });

  it("throws when Convex returns status: error", async () => {
    setFetch(makeFetchMock(200, { status: "error", errorMessage: "Bad args" }));

    await expect(
      callConvexMutation({
        functionName: "audit_chatbot_leads:create",
        args: { name: "x", email: "y@z.com", findings: [], painPoints: [], manualTasks: [] },
      })
    ).rejects.toThrow(/Bad args/);
  });

  it("propagates fetch errors (network down / CORS / etc.)", async () => {
    setFetch(vi.fn(async () => {
      throw new Error("network down");
    }));

    await expect(
      callConvexMutation({
        functionName: "audit_chatbot_leads:create",
        args: { name: "x", email: "y@z.com", findings: [], painPoints: [], manualTasks: [] },
      })
    ).rejects.toThrow(/network down/);
  });
});

// === DRIFT GATE ===
// Self-policing test: if anyone weakens the typed call wrapper
// (e.g. widens args back to Record<string, unknown>), the
// ts-expect-error directives below become unused and the test file
// fails to compile. The gate is enforced by the test suite itself.
//
// Each negative example must:
//   1. Have a typed annotation `ConvexCallOptions<...>` so excess
//      property + missing-required + wrong-type checks fire on the
//      object literal.
//   2. Place the directive on the EXACT line that triggers the
//      error (TypeScript suppresses one error per directive; the
//      directive must be on the line where the error is reported).
describe("Convex drift gate (compile-time)", () => {
  it("rejects unknown fields on :create via the typed wrapper", () => {
    // GOOD: matches the generated arg shape. If the schema changes,
    // this stops compiling before any runtime damage.
    const good: ConvexCallOptions<"audit_chatbot_leads:create"> = {
      functionName: "audit_chatbot_leads:create",
      args: {
        name: "Jane Smith",
        email: "jane@example.com",
        company: "Smith Plumbing",
        findings: [],
        painPoints: [],
        manualTasks: [],
      },
    };
    expect(good.args.name).toBe("Jane Smith");
  });

  it("rejects an unknown field on :create (excess-property check)", () => {
    // The annotation forces excess-property checking on the literal.
    // `nonExistentField` is not in AuditChatbotLeadsCreateArgs, so tsc
    // reports an error on that line. The directive silences it. If the
    // wrapper is ever widened back to Record<string, unknown>, this
    // directive becomes unused → tsc fails the test file → CI fails.
    const bad: ConvexCallOptions<"audit_chatbot_leads:create"> = {
      functionName: "audit_chatbot_leads:create",
      args: {
        name: "Jane Smith",
        email: "jane@example.com",
        findings: [],
        painPoints: [],
        manualTasks: [],
        // @ts-expect-error — excess property not in generated CreateArgs
        nonExistentField: "should not compile",
      },
    };
    void bad;
  });

  it("rejects wrong field type on :create", () => {
    // `name` must be string; passing a number fires on that line.
    const wrong: ConvexCallOptions<"audit_chatbot_leads:create"> = {
      functionName: "audit_chatbot_leads:create",
      args: {
        // @ts-expect-error — name must be string, not number
        name: 42,
        email: "jane@example.com",
        findings: [],
        painPoints: [],
        manualTasks: [],
      },
    };
    void wrong;
  });

  it("infers the correct return type from the function name", () => {
    // The return type of :create is { chatbotLeadId: string; leadId: string }.
    // If the schema changes the return shape, this assertion breaks at
    // compile time before it runs.
    type CreateReturn = Awaited<
      ReturnType<typeof callConvexMutation<"audit_chatbot_leads:create">>
    >;
    const sample: CreateReturn = {
      chatbotLeadId: "lead-abc",
      leadId: "lead-xyz",
    };
    expect(sample.chatbotLeadId).toMatch(/^lead-/);
  });

  it("the generated CreateArgs type is structurally complete", () => {
    // Sanity check: the generated type has all required keys and
    // surfaces them to callers. If the codegen output ever loses
    // a field, this fails at compile time.
    const requiredKeys: Array<keyof AuditChatbotLeadsCreateArgs> = [
      "name",
      "email",
      "findings",
      "painPoints",
      "manualTasks",
    ];
    expect(requiredKeys).toContain("name");
    expect(requiredKeys).toContain("email");
    expect(requiredKeys).toContain("findings");
    expect(requiredKeys).toContain("painPoints");
    expect(requiredKeys).toContain("manualTasks");
  });
});
