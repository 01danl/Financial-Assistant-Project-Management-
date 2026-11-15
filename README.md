# Financial Assistant — prototype v1.0
Next.js (App Router) prototype of the BDA-2402 project: purchase-feasibility verdict + Kazakhstan deposit comparator.

    npm install && npm run dev      # http://localhost:3000
    npm run build

Deploy: push to GitHub → import in Vercel (framework auto-detected, no env vars). Or `npx vercel`.

- `lib/engine.ts` — guardrail rules + weighted factor scoring, deposit math
- `app/api/analyze/route.ts` — API endpoint (stand-in for the FastAPI service)
