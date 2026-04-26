# Legacy — vanilla TS/JS implementation

This folder contains the original **FreeBabyPhoneJs** implementation: a zero-build, vanilla TypeScript + static HTML PWA deployed on GitHub Pages.

It is **frozen** and kept here only as a reference while the project is rebuilt with Ionic + Angular at the repo root.

- No CI: the GitHub Actions workflow previously at `.github/workflows/deploy.yml` has been moved into `legacy/.github/workflows/deploy.yml` so it no longer runs.
- The codebase is still self-contained and can be built locally from this folder:

```bash
cd legacy
npm install
npm run build
npm run serve
```

See `DESCRIPTION.md` and `PLAN.md` in this folder for the original feature set and improvement ideas (most of which will be re-evaluated in the new stack).
