# TraceQA · managed AI testing MVP

`web/`: Korean customer workspace. No worker URL, service token or AI key input.
`gateway/`: authenticated Sites Worker proxy with embedded UI, built by `node build.mjs`.
`service/`: Railway service for usage credits, Toss Payments test billing and durable run snapshots.
`worker/`: Playwright + AI recursive exploration engine; legacy standalone server retained for local development.

Build: `npm run build`. Tests: `npm test` and `node --test worker/test.mjs`.
Deploy Sites with `.openai/hosting.json` and `dist/server/index.js`. Deploy Railway with root Dockerfile and railway.json; attach persistent /data volume. See service/README.md for operational configuration and limitations.

The browser UI explicitly separates sample and real results. Operator keys are never sent to customers. Toss Payments billing is test-only; live charges are disabled. The production OPENAI_API_KEY is stored only in Railway Variables. It must never be added to this repository.
