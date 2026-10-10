# Prompt for the frontend build agent

Paste everything below the line into a new Claude Code session opened in `~/Projects/earlyeye`. For the 3D campus, you can also run a second agent in parallel with `docs/campus-3d-agent-prompt.md`.

---

You are building the EarlyEye dashboard in `web/` for Dormathon 2026 (Taylor's branch, Track 1). I'm Kayla, owner of `web/`, the deployed link and scope. Submission is Sun 11 Oct 08:30, and the deployed Vercel link must work with no camera attached.

**Read these fully, in order, before writing code:**
1. `CLAUDE.md`
2. `docs/frontend-build-brief.md`. This is your spec: design system, every screen, click map, alarm behaviour, real-time video and skeleton views, the 3D campus, mock data, backend and model reality checks, build order, acceptance checklist and copy.
3. `docs/kayla-frontend-plan.md`. The TypeScript contract there is binding.
4. `docs/work-split.md`, frontend tasks F1–F10 and the integration tests in §4.
5. `design/README.md`, then `design/canvas/L3*.dc.html` and `design/canvas/Campus3D.dc.html` (the visual source of truth; copy sizes, colours and copy from them), and `design/assets/` (the real campus GeoJSON and the 3D seed).
6. `docs/campus-3d-agent-prompt.md`: the 3D model of the real Taylor's Lakeside campus, used on Cameras, Plan and the Live card.
7. `model/REPORT.md` for the Proof numbers.

**Hard rules:**
- Only touch `web/` and, for contract changes, `docs/kayla-frontend-plan.md` plus `docs/earlyeye-TEAM-FINAL.md` §6 in the same commit. Never edit `edge/`, `api/`, `model/` or `data/`.
- One branch per screen. PR each one, squash-merge, rebase on `main` first. Never add `Co-Authored-By` trailers or "Generated with" footers.
- Light theme only. The only motion is the 300 ms level-pill transition, the 1 Hz alarm pulse and the 3D fly-to, all with `prefers-reduced-motion` respected.
- Every route renders from mock data with the API down.
- **Cameras:** 1 live webcam (`CAM-AU-01`, the Grand Hall in Block B, on the demo laptop), 4 recordings of our own staged clips played through the same edge pipeline, and 1 seeded black camera.
  - Recordings are **always labelled REC** with their recording time, and never shown as live.
  - No video file goes in `web/`.
  - Video appears only in the on-site view, on laptop 1, loading each camera's `edge_url`.
  - The Vercel remote view shows skeletons and data only, and never requests an `edge_url`.
- **Real campus only.** Every building, room, name and pin follows the real Taylor's University Lakeside Campus, as in brief §9. Never invent one. Google Maps 3D and Taylor's own facilities page are the truth.
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
5. `web/campus-3d`: you, or a parallel agent, using `docs/campus-3d-agent-prompt.md`
6. `web/proof-v3`
7. `web/plan-v3`
8. `web/incidents-v3`
9. `web/polish`

For every branch:
- Run the acceptance checklist in brief §14.
- Run `npm run build` and `npm run lint`.
- Check the routes at 1440 px and 390 px with the API unset.
- Open a PR with a 5-line description: what was built, what renders, what is mocked, open questions, and screenshots if you can take them.

**Stop and ask me before:**
- changing the contract beyond the v3 optional fields already documented,
- cutting anything on the "never cut" list,
- adding a dependency other than a small state store such as Zustand and the deck.gl and loaders.gl packages named in the 3D prompt.

**Ask me for:**
- the Google Maps API key, if you build the real 3D tiles,
- the room the demo laptop will film on pitch day, if it isn't the Grand Hall.

**After each PR, report back:** the PR link, what works on the deployed preview, which backend gaps from brief §11 you hit, and anything in the docs that contradicts itself.
