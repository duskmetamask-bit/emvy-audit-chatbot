<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Convex types are committed, not auto-generated

`src/lib/convex-generated/audit-chatbot-types.d.ts` is a hand-checked
copy of the website repo's exported types. The Convex schema lives in
`~/Documents/emvy-website-v2/convex/`. When the schema changes there,
the types here MUST be resynced — otherwise the typed call wrapper in
`src/lib/convex.ts` and the three call sites in `src/app/page.tsx`
will silently drift from the server-side validators.

Sync procedure (do all three):
1. `cd ~/Documents/emvy-website-v2 && npm run export:chatbot-types`
2. `cd ~/Documents/audit-chatbot && npm run sync:convex-types`
3. `npm run verify:convex-types` — must exit 0

The `prebuild` script runs `tsc --noEmit` before `next build`, so a
missed sync fails the Vercel build before any code ships.

If you add a new `audit_chatbot_leads:*` function to the website
repo, extend the discriminated union in `src/lib/convex.ts` (the
`ConvexFunctionName` + `ConvexArgsByName` + `ConvexReturnByName`
chain). The drift-gate tests in `src/lib/convex.test.ts` are
self-policing — if anyone weakens `ConvexCallOptions`, the
`@ts-expect-error` directives become unused and the test file
fails to compile.
