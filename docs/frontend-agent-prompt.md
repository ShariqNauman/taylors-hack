# Prompt for the frontend build agent

Paste everything below the line into a new Claude Code session opened in `~/Projects/earlyeye`.

---

You are building the EarlyEye dashboard in `web/` for Dormathon 2026 (Taylor's branch, Track 1). I'm Kayla, owner of `web/`, the deployed link and scope. Submission is Sun 11 Oct 08:30, and the deployed Vercel link must work with no camera attached.

**Read these fully, in order, before writing code:**
1. `CLAUDE.md`
2. `docs/frontend-build-brief.md`. This is your spec: design system, every screen, click map, alarm behaviour, real-time video and skeleton views, site map, mock data, backend and model reality checks, build order, acceptance checklist and copy.
3. `docs/kayla-frontend-plan.md`. The TypeScript contract there is binding.
4. `docs/work-split.md`, frontend tasks F1–F10 and the integration tests in §4.
5. `design/README.md`, then `design/canvas/L3*.dc.html` (the visual source of truth; copy sizes, colours and copy from them) and `design/assets/site-plan-taylors-lakeside.svg`.
6. `model/REPORT.md` for the Proof numbers.

**Hard rules:**
- Only touch `web/` and, for contract changes, `docs/kayla-frontend-plan.md` plus `docs/earlyeye-TEAM-FINAL.md` §6 in the same commit. Never edit `edge/`, `api/`, `model/` or `data/`.
- One branch per screen. PR each one, squash-merge, rebase on `main` first. Never add `Co-Authored-By` trailers or "Generated with" footers.
- Light theme only. The only motion is the 300 ms level-pill transition and the 1 Hz alarm pulse, with `prefers-reduced-motion` respected.
- Every route renders from mock data with the API down.
- **No hardcoded or stock video anywhere.** Cameras are 4 real laptop webcams. Live video appears only in the on-site view (the local build on laptop 1, loading each laptop's `edge_url`). The Vercel remote view shows skeletons and data only, and never requests an `edge_url`.
- Never show a number without a source. Missing metrics read "not measured".
- Don't build CUT items, even though the backend has routes for them: auth, multi-site, copilot or chat, knowledge base, notification settings, cloud clip storage.

**Start:**
```bash
git fetch origin
git checkout web/scaffold
git rebase origin/main
cd web && npm install && npm run build
```

**Then follow the build order in brief §13:**
1. `web/shell-v3`: types, tokens, fonts, header, alarm layer, `SkeletonView`, `mock-poses.ts`
2. `web/live-v3`
3. `web/push-v3`
4. `web/cameras`
5. `web/proof-v3`
6. `web/plan-v3`
7. `web/incidents-v3`
8. `web/polish`

For every branch:
- Run the acceptance checklist in brief §14.
- Run `npm run build` and `npm run lint`.
- Check the routes at 1440 px and 390 px with the API unset.
- Open a PR with a 5-line description: what was built, what renders, what is mocked, open questions, and screenshots if you can take them.

**Stop and ask me before:**
- changing the contract beyond the v3 optional fields already documented,
- cutting anything on the "never cut" list,
- adding a dependency other than a small state store such as Zustand.

**After each PR, report back:** the PR link, what works on the deployed preview, which backend gaps from brief §11 you hit, and anything in the docs that contradicts itself.
