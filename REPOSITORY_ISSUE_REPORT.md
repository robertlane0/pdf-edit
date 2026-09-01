# Repository Issue Report — `pdf-edit` (electron-pdfjs-editor)

**Report date:** 2026-08-31
**Repository:** `pdf-edit` (package name `electron-pdfjs-editor`, v1.0.0)
**HEAD commit:** `89e9e74` — "GPT 5.6 Luna (Thinking): Fix PDF text editing to modify underlying content instead of overlay annotations"
**Analyzed by:** Static inspection, dependency/vulnerability scanning, and TypeScript compilation (see [Methodology](#3-methodology--commands-run))

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Repository Overview](#2-repository-overview)
3. [Methodology / Commands Run](#3-methodology--commands-run)
4. [Findings at a Glance](#4-findings-at-a-glance)
5. [Detailed Findings](#5-detailed-findings)
   - [5.1 Security](#51-security)
   - [5.2 Correctness](#52-correctness)
   - [5.3 Testing](#53-testing)
   - [5.4 Documentation](#54-documentation)
   - [5.5 Dependencies](#55-dependencies)
   - [5.6 Architecture & Maintainability](#56-architecture--maintainability)
   - [5.7 Performance](#57-performance)
6. [Additional / Lower-Priority Observations](#6-additional--lower-priority-observations)
7. [Remediation Roadmap](#7-remediation-roadmap)
8. [Assumptions](#8-assumptions)
9. [Report Validation](#9-report-validation)

---

## 1. Executive Summary

`pdf-edit` is a small (~1,800 line) TypeScript/Electron desktop application that embeds PDF.js (as an untouched git submodule) to view and edit PDF files, including direct in-place editing of existing PDF text runs via low-level content-stream manipulation. The codebase was built by a sequence of AI coding agents against a master specification (`AGENTS.md`); git history shows five commits, each attributed to a different agent/model, with no human-authored commits visible in the provided history.

The application is functional at a basic level (it type-checks cleanly with `strict` TypeScript and has no build errors), but it carries **real risk in three areas**:

- **The core "edit PDF text in place" feature has a correctness gap that isn't exercised by any test.** Replacement text is spliced into the content stream as raw Latin‑1 bytes with no awareness of the page's actual font encoding. This works for ASCII deletions/substitutions against simple fonts, but will silently corrupt or throw for the very common case of subsetted/CID-embedded fonts and non‑Latin‑1 characters — which is most PDFs produced by modern authoring tools.
- **There is no automated testing or CI.** The three "verification" scripts in `scripts/` are manual, GUI-dependent smoke tests that require files and binaries that don't exist in the repository, and two of the three aren't even wired into `npm scripts`. The single most complex and highest-risk file in the repo (`pdf-text-content.ts`, a hand-rolled PDF content-stream tokenizer) has zero unit tests.
- **Roughly a third of `src/` is dead code.** Five of twelve TypeScript modules (`extensions.ts`, `event-bus.ts`, `overlay-manager.ts`, `viewport-math.ts`, `chrome-pdf-editor.ts`, plus the unused `pdf-merger.ts` and `types.ts`) are never imported by the application's actual entry points. The real, working logic was instead written inline as a large `eval`'d string inside `viewer-preload.ts`, duplicating logic that exists — better-typed — in the unused modules.

None of these issues currently block the app from running, but together they represent significant risk for a project that (a) processes untrusted files by design and (b) has no safety net (tests/CI) to catch regressions as it grows. This report catalogs **19 detailed findings** plus a set of minor observations, each with evidence, root cause, a concrete fix, and effort/risk estimates, and closes with a prioritized remediation roadmap.

---

## 2. Repository Overview

| Aspect | Detail |
|---|---|
| **Project type** | Cross-platform desktop application (Electron), embedding a vendored PDF.js viewer via a git submodule |
| **Primary language** | TypeScript (`strict` mode), compiled to CommonJS for Node/Electron's main, preload, and renderer processes |
| **Secondary languages** | Plain JavaScript (build/verification scripts in `scripts/`); a string-templated JS payload injected into the browser context from `viewer-preload.ts` |
| **Package manager** | npm (`package-lock.json`, `lockfileVersion` present; no Yarn/pnpm artifacts) |
| **Build system** | `tsc` (TypeScript compiler) for app code; a custom Node script (`scripts/build-pdfjs.js`) that runs `npm ci && npx gulp generic` inside the `vendor/pdf.js` submodule and copies the output into `dist/pdfjs` |
| **Runtime / framework** | Electron ^29.0.0 (main/preload/renderer process model), PDF.js (vendored, unmodified, via git submodule pinned at commit `561a4cc`) |
| **Key dependencies** | `pdf-lib` ^1.17.1 (PDF byte-level manipulation), `fs-extra` ^11.2.0 |
| **Dev dependencies** | `electron` ^29.0.0, `typescript` ^5.3.3, `@types/node` ^20.11.0, `@types/fs-extra` ^11.0.4 |
| **Tests** | **None** in the automated sense. Three scripts under `scripts/` (`verify-text-edit.js`, `verify-electron.js`, `verify-full-lifecycle.js`) act as manual/GUI smoke tests; only one is wired to an npm script (`verify:text-edit`), and it depends on an external file (`../../edited.pdf`, outside the repo) and the external `pdftotext` binary (Poppler). No unit test framework (Jest/Vitest/Mocha/etc.) is present. |
| **CI configuration** | **None found.** No `.github/workflows`, no other CI provider config, no pre-commit hooks, no lint-on-push gate. |
| **Linting / formatting** | **None configured.** No ESLint, Prettier, or `.editorconfig`. |
| **License** | Apache License 2.0 (`LICENSE`); compatible with all first-party dependencies observed (`pdf-lib` MIT, `fs-extra` MIT, PDF.js Apache-2.0) |
| **Packaging / distribution** | None. No `electron-builder`, `electron-forge`, or Squirrel configuration; the app can only be run via `npm start` in a development checkout. |
| **Repo size** | 12 TypeScript files under `src/` (~1,800 LOC total), 4 scripts (~270 LOC), no `node_modules` committed (correctly `.gitignore`d) |
| **VCS state** | Git repo with 5 commits on `main`, tracking `origin/main`. One **untracked** file, `patch.diff` (22 KB), is present in the working tree (see [ARCH-4](#arch-4-stray-already-applied-patchdiff-committed-into-the-working-tree)). The `vendor/pdf.js` submodule is registered (`.gitmodules`) but **not checked out** in this snapshot (empty directory) — expected for a distribution archive, but the build script does not detect or explain this condition (see [ARCH-6](#6-additional--lower-priority-observations)). |

---

## 3. Methodology / Commands Run

All findings below are backed by one or more of the following, run directly against the extracted repository:

```bash
# Structure & dependency graph
find src -name "*.ts" | sort
grep -rn "^import\|require(" --include="*.ts" src scripts

# Install & type-check
npm install --no-audit --no-fund
npx tsc --noEmit                     # → exits 0, no type errors

# Dependency vulnerability scan
npm audit --json
npm outdated
npm ls electron pdf-lib fs-extra
npm view electron version            # latest published version for comparison

# Git history / repo hygiene
git log --oneline
git submodule status
git status
diff <(git show 89e9e74) patch.diff  # confirms patch.diff is a stale duplicate of the last commit

# Targeted pattern scans
grep -rn "eval(" src --include="*.ts"
grep -rn "innerHTML" src --include="*.ts"
grep -rn "sandbox" src --include="*.ts"
grep -rn "postMessage" src --include="*.ts"
grep -rniE "api[_-]?key|secret|password|token\s*=" src --include="*.ts"
```

`npx tsc --noEmit` completed with **exit code 0 and zero diagnostics**, confirming the codebase is internally type-consistent despite the structural issues described below — the problems here are architectural, security, and correctness issues that a type checker cannot catch, not compile errors.

---

## 4. Findings at a Glance

| ID | Title | Category | Severity | Priority | Est. Effort |
|---|---|---|---|---|---|
| [COR-1](#cor-1-text-edit-encoding-model-cannot-represent-most-real-world-pdf-fonts) | Text-edit byte encoding ignores font encoding — garbled/failed edits | Correctness | **High** | Short-term | High |
| [COR-2](#cor-2-failed-text-edit-exports-fail-silently) | Failed text-edit exports fail silently (console-only) | Correctness | Medium | Short-term | Low |
| [TEST-1](#test-1-zero-unit-test-coverage-for-the-riskiest-code-in-the-repository) | Zero unit tests for the riskiest code (`pdf-text-content.ts`) | Testing | **High** | Immediate | Medium |
| [TEST-2](#test-2-existing-verify-scripts-are-manual-environment-dependent-smoke-tests) | "Verify" scripts are manual, non-CI-able smoke tests | Testing | Medium–High | Short-term | Medium |
| [TEST-3](#test-3-no-continuous-integration-configured) | No CI configured at all | Testing | **High** | Immediate | Low |
| [DOC-1](#doc-1-no-readme-or-contributor-facing-documentation) | No README / contributor documentation | Documentation | Medium–High | Immediate | Low |
| [DOC-2](#doc-2-no-contributing-changelog-or-security-policy) | No CONTRIBUTING, CHANGELOG, or SECURITY policy | Documentation | Medium | Medium-term | Low |
| [DEP-1](#dep-1-no-automated-dependency-update-or-audit-gate) | No automated dependency update/audit gate | Dependency | Medium | Short-term | Low |
| [ARCH-1](#arch-1-a-third-of-src-is-dead-code-the-specced-architecture-was-abandoned) | ~35% of `src/` is dead code; specced architecture abandoned | Architecture | **High** | Short-term | Medium |
| [ARCH-2](#arch-2-duplicate-independently-maintained-type-definitions) | Duplicate, independently-maintained type definitions | Maintainability | Medium | Short-term | Low |
| [ARCH-3](#arch-3-no-linting-or-formatting-tooling-configured) | No linting or formatting tooling configured | Maintainability | Medium | Short-term | Low |
| [ARCH-4](#arch-4-stray-already-applied-patchdiff-committed-into-the-working-tree) | Stray, already-applied `patch.diff` left in the working tree | Maintainability | Low | Immediate | Trivial |
| [ARCH-5](#arch-5-no-production-packaging-or-distribution-pipeline) | No production packaging/distribution pipeline | Architecture | Low–Medium | Long-term | Medium |
| [PERF-1](#perf-1-full-content-stream-re-tokenization-and-reallocation-per-individual-edit) | Full content-stream re-tokenization/reallocation per edit | Performance | Low–Medium | Medium-term | Medium |
| [PERF-2](#perf-2-unconditional-global-proxy-wrapping-of-cssstyledeclaration) | Unconditional global `Proxy` wrapping of `CSSStyleDeclaration` | Performance | Low | Long-term | Low |

---

## 5. Detailed Findings

### 5.1 Security

*No open findings — the previously reported IPC payload validation issue has been resolved.*

---

### 5.2 Correctness

#### COR-1: Text-edit encoding model cannot represent most real-world PDF fonts

**Severity:** High &nbsp;|&nbsp; **Category:** Correctness &nbsp;|&nbsp; **Priority:** Short-term (start now; full fix is high-effort)

**Evidence**

`src/shared/pdf-text-content.ts:55-65`:

```ts
function latin1ToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code > 0xff) {
      throw new Error('The replacement text contains characters that cannot be encoded in the existing PDF text run.');
    }
    bytes[i] = code;
  }
  return bytes;
}
```

This function is used in `applyReplacementToBytes` (`pdf-text-content.ts:337-339`) to encode the user's replacement text directly as raw single bytes, one JS UTF-16 code unit → one PDF content-stream byte, with **no reference to the page's actual font `Encoding`/`ToUnicode` CMap**, and no distinction between simple (single-byte) fonts and composite/CID (often double-byte, `Identity-H`) fonts.

**Root cause**

PDF content-stream text-showing operators (`Tj`, `TJ`, `'`, `"`) don't contain literal Unicode text — they contain **byte codes that are meaningful only relative to the specific font's encoding**, which for embedded/subsetted fonts (the overwhelming majority of PDFs produced by browsers' "Print to PDF", Word/LibreOffice PDF export, LaTeX, and most modern generators) is a custom, per-document mapping with no fixed relationship to Latin-1 or Unicode code points. This code assumes JS char code 0–255 maps directly onto the font's byte encoding, which is:

- **Incorrect for CID/Identity‑H fonts** (double-byte codes) — this code will produce corrupted output (wrong or garbled glyphs) rather than an error, because bytes 0x00–0xFF are all individually "valid" as far as `latin1ToBytes` is concerned, they just don't mean what the code assumes.
- **A hard failure for any replacement character outside Latin‑1** (emoji, most non-Western scripts, and many typographic characters like curly quotes/em-dashes if the app ever normalizes them to their true Unicode code points above U+00FF) — this throws, and (per [COR-2](#cor-2-failed-text-edit-exports-fail-silently)) that failure is currently swallowed silently in the UI.
- **Only reliable when deleting text or substituting with characters that are known to already exist at the same byte values in the source run** — which is exactly the one case the repository's single verification script (`scripts/verify-text-edit.js`) tests (deleting the word "Languages"). The test suite's one scenario does not exercise character *insertion*, which is where this limitation actually bites.

**Recommended fix**

This is a substantial, multi-step fix, not a one-line patch:

1. **Short-term (defensive):** Detect whether the target font is a simple (single-byte) font with a standard/WinAnsi-compatible encoding before allowing character-level substitution; if the font is a composite/CID font or has a non-standard `Differences` encoding, reject the edit with a clear, user-facing error rather than silently producing corrupted output.
2. **Medium-term:** For simple fonts, look up the font's actual `/Encoding` (base encoding + `/Differences` array) and map each replacement Unicode character to the correct byte code for *that* font, rather than assuming Latin‑1 identity — falling back to a clear error if a needed character isn't in the font's encoding at all (i.e., don't silently substitute a wrong glyph).
3. **Long-term:** For full correctness, evaluate whether new/substituted glyphs can be added at all without re-embedding font subsets (out of scope for a byte-splice approach) — this may mean the product scope should explicitly document that "insert new characters not already used elsewhere on the page" is unsupported for CID fonts, rather than attempting silently to support it.

**Implementation steps**

1. Extend `getContentStreams`/the replacement pipeline in `pdf-text-content.ts` to also resolve the font resource associated with the target text run (via the page's `/Resources/Font` dictionary and the `Tf` operator preceding the run) and inspect its `/Subtype` and `/Encoding`.
2. Branch: for `/Subtype /Type0` (composite) fonts, reject with a descriptive error (do not attempt byte substitution) until proper CID-aware encoding is implemented.
3. For simple fonts, build a code-point → byte-code map from the font's base encoding (`WinAnsiEncoding`/`MacRomanEncoding`/`StandardEncoding`) plus any `/Differences`, and use that map in place of `latin1ToBytes`.
4. Surface a clear, specific error message distinguishing "this font can't be edited with new characters" from generic failures.

**Tests to add**

- Unit tests against a small corpus of representative fixture PDFs (checked into `test/fixtures/`): (a) a simple WinAnsi-encoded font, editing/inserting ASCII and Latin‑1 characters — should succeed; (b) a CID/Identity‑H font (e.g., produced by a typical browser print-to-PDF) — attempting to insert new characters should fail with a clear, specific error rather than corrupting the output; (c) deleting text (empty replacement) on a CID font — should still succeed, since deletion doesn't require new byte encoding.
- A round-trip test: apply an edit, save, reload with `pdf-lib`, and verify the page's content stream is still syntactically valid (this partially exists already via the "page count unchanged" check in `verify-text-edit.js`, but should be promoted to an automated unit/integration test and extended to validate content-stream well-formedness, not just page count).

**Validation steps**

- Run the new fixture-based tests; confirm CID-font insertion is rejected cleanly (not silently corrupted) and simple-font edits still work.
- Manually test against a PDF exported from a common real-world tool (e.g., Chrome's "Print to PDF", Google Docs export, or LibreOffice) — these commonly use embedded subset fonts and are a realistic stress test.

**Risks**

- This is the highest-effort item in the report and touches the app's core value proposition; consider explicitly scoping the *product* (not just the code) — e.g., "Edit PDF text" could ship with a documented "supported font types" list rather than attempting to universally support arbitrary insertion, which meaningfully reduces engineering risk versus attempting full CID-aware re-encoding.
- Any change to the tokenizer/replacement engine should only be made once [TEST-1](#test-1-zero-unit-test-coverage-for-the-riskiest-code-in-the-repository) exists, so regressions in the (already fairly intricate) byte-splicing logic are caught mechanically.

**Estimated effort:** High (1–2+ weeks depending on how much of the CID/encoding-aware path is implemented vs. simply detected-and-rejected).

---

#### COR-2: Failed text-edit exports fail silently

**Severity:** Medium &nbsp;|&nbsp; **Category:** Correctness / UX &nbsp;|&nbsp; **Priority:** Short-term

**Evidence**

`src/preload/viewer-preload.ts:541-549`:

```js
const exportButton = createButton('ext-text-edit-export', 'Export PDF with text edits');
exportButton.addEventListener('click', async () => {
  try {
    await exportTextEdits(App);
  } catch (error) {
    console.error('Unable to export text edits', error);
  }
});
```

**Root cause**

Any failure during export — including the `latin1ToBytes` encoding error from [COR-1](#cor-1-text-edit-encoding-model-cannot-represent-most-real-world-pdf-fonts), or the "Unable to locate the original PDF text run" error thrown by `applyTextEditsToPDF` (`src/shared/text-editor.ts:39`) when a source text run can no longer be found — is caught and logged to the DevTools console only. There is no toast, dialog, or any in-UI indication to the end user that clicking "Export" did nothing. A user who doesn't have DevTools open (i.e., essentially all real users) will simply see the export silently not happen, with no explanation.

**Recommended fix**

Surface a user-visible error (a simple in-page toast/banner is sufficient given the app's existing DOM-manipulation patterns) whenever `exportTextEdits` throws, including a human-readable summary of the failure.

**Implementation steps**

1. Add a minimal toast/banner element to the viewer chrome (or reuse an existing PDF.js UI affordance if one exists for transient messages).
2. In the `catch` block, show that toast with a concise, actionable message (e.g., "Couldn't export: one of your edits uses characters this PDF's font doesn't support.").
3. Apply the same treatment to the "Unable to locate the original PDF text run" failure path in `applyTextEditsToPDF`.

**Tests to add**

- A DOM-level test (e.g., via `jsdom` or a headless Electron test) simulating an export failure and asserting the error UI element becomes visible with the expected text.

**Validation steps**

- Manually trigger both failure modes (an edit with a non‑Latin‑1 character, and an edit whose `sourceText` no longer matches the document) and confirm a clear, visible error appears in the UI.

**Risks**

- Low; purely additive UX improvement.

**Estimated effort:** Low (about a day).

---

### 5.3 Testing

#### TEST-1: Zero unit test coverage for the riskiest code in the repository

**Severity:** High &nbsp;|&nbsp; **Category:** Testing &nbsp;|&nbsp; **Priority:** Immediate

**Evidence**

`src/shared/pdf-text-content.ts` (408 lines) is a hand-rolled PDF content-stream tokenizer and byte-splicing engine — the single most algorithmically complex file in the repository, implementing its own lexer for PDF `COS` syntax (literal strings with nested-parenthesis/backslash-escape handling, hex strings, arrays, numbers, comments), text-run matching/scoring by spatial proximity, and in-place byte-array editing with offset bookkeeping. No test file, test directory, or test framework (`jest`, `vitest`, `mocha`, `node:test`, etc.) exists anywhere in the repository. `package.json` has no `test` script — running `npm test` invokes npm's default fallback, which exits with an error.

**Root cause**

No test framework was ever added to the project, and none of the AI-agent commits in the git history introduced automated tests alongside the feature work they added (each commit message describes a feature or fix, none mention tests).

**Recommended fix**

Introduce a lightweight, fast unit-test framework (`node:test` — built into Node 22, requires zero new dependencies — or `vitest` if a richer DX is preferred) and write unit tests directly against the pure functions in `pdf-text-content.ts`, which are ideal test targets since they operate on plain byte arrays with no Electron/DOM dependency.

**Implementation steps**

1. Add `"test": "node --test dist/**/*.test.js"` (or the `vitest` equivalent) to `package.json` scripts.
2. Write unit tests for, at minimum: `tokenize` (literal strings incl. escapes/nesting, hex strings incl. odd-length padding, numbers, arrays, comments), `decodeLiteralString`/`encodeLiteralString` round-trips, `decodeHexString`/`encodeHexString` round-trips, `findTextGroups` (single `Tj` operand, `TJ` array with kerning numbers interspersed), `getApproximateTextOrigin` (`Tm` vs `Td`/`TD` extraction), and `applyReplacementToBytes` end-to-end against small synthetic content-stream byte arrays (not full PDF files) for deletion, substitution, and multi-token-span replacement scenarios.
3. Add tests for `resolveViewerPath` and `transformCssLightDark` (`src/main/protocol.ts`) — both are pure, easily testable functions with no coverage today.
4. Wire the new `test` script into CI ([TEST-3](#test-3-no-continuous-integration-configured)).

**Tests to add**

(See implementation steps above — this finding *is* the "add tests" recommendation for the rest of the report's correctness/security items that reference "unit tests" against this file.)

**Validation steps**

- `npm test` runs and passes locally and in CI.
- Coverage (even informally, without a hard threshold initially) visibly includes the tokenizer, encode/decode helpers, and replacement-matching logic.

**Risks**

- Minimal; adding tests to previously-untested pure functions is low-risk by nature. The main risk is discovering existing latent bugs while writing tests (a good outcome, but budget time for follow-up fixes).

**Estimated effort:** Medium (2–3 days for a solid first pass covering the functions listed above).

---

#### TEST-2: Existing "verify" scripts are manual, environment-dependent smoke tests

**Severity:** Medium–High &nbsp;|&nbsp; **Category:** Testing &nbsp;|&nbsp; **Priority:** Short-term

**Evidence**

Three scripts exist under `scripts/`:

- `verify-text-edit.js` — wired to `npm run verify:text-edit` (`package.json:10`). Reads its input PDF from `process.argv[2] || path.resolve(__dirname, '../../edited.pdf')` — i.e., **a file one directory above the repository root**, which does not exist in this repository and must be manually supplied by whoever runs it. It also shells out to the external `pdftotext` binary (Poppler), which is not declared as a dependency anywhere (not in `package.json`, not documented in any README since none exists).
- `verify-electron.js` and `verify-full-lifecycle.js` — both launch a real (headless, `show: false`) Electron `BrowserWindow`, requiring a display-server-capable or properly configured headless environment, and are **not referenced anywhere in `package.json` scripts** — a contributor would have to know these files exist and run them with `electron scripts/verify-electron.js` manually.

**Root cause**

These were written as ad hoc manual verification aids during development (consistent with the "Verification & Validation Protocol" section of `AGENTS.md`, which describes manual, human-in-the-loop checks like "scroll through a multi-page PDF document" and "verify... within a ±0.01px tolerance" — not automated, CI-runnable tests) rather than as part of an automated test suite.

**Recommended fix**

Convert what these scripts *check* into proper automated tests, and either fix or remove what can't reasonably be automated:

**Implementation steps**

1. For `verify-text-edit.js`: replace the external `../../edited.pdf` dependency with a small, minimal PDF fixture checked into `test/fixtures/` (a single-page PDF with known, simple text is sufficient and can be generated once with `pdf-lib` itself). Replace the `pdftotext` shell-out with an in-process text-extraction check using a JS-native PDF text extraction path (or, at minimum, document `pdftotext`/Poppler as an explicit, versioned dev dependency if it's kept). Convert this into a proper `node:test`/`vitest` test case rather than a standalone script with `process.exit`.
2. For `verify-electron.js` / `verify-full-lifecycle.js`: wire both into `package.json` scripts (e.g., `verify:launch`, `verify:lifecycle`) so they're at least discoverable, and evaluate running them headlessly in CI using `xvfb-run` (Linux) — Electron end-to-end tests can run in GitHub Actions with the standard `xvfb` setup. If full E2E-in-CI is judged too costly initially, at minimum document them clearly as manual pre-release checks (see [DOC-1](#doc-1-no-readme-or-contributor-facing-documentation)) so they aren't silently forgotten.

**Tests to add**

- (Covered above.) The end state should be: `npm test` runs fast, dependency-free unit tests (from [TEST-1](#test-1-zero-unit-test-coverage-for-the-riskiest-code-in-the-repository)) in CI on every push; a separate `npm run verify:e2e` (or similar) runs the Electron-based checks, either in CI under `xvfb` or as a documented manual pre-release gate.

**Validation steps**

- `npm run verify:text-edit` succeeds using only files inside the repository, with no manually-supplied external file.
- The two currently-orphaned verify scripts are runnable via a named `npm run` script and their purpose is documented.

**Risks**

- Getting real Electron GUI tests running reliably in CI can be finicky (timing, headless rendering quirks); budget contingency time, or explicitly scope this to "documented manual gate" for now and revisit automation later if it proves too costly.

**Estimated effort:** Medium (2–3 days for fixture creation + script conversion; more if pursuing full CI-based Electron E2E).

---

#### TEST-3: No continuous integration configured

**Severity:** High &nbsp;|&nbsp; **Category:** Testing &nbsp;|&nbsp; **Priority:** Immediate

**Evidence**

No `.github/workflows/` directory, no `.gitlab-ci.yml`, no `.circleci/`, no other CI provider configuration exists anywhere in the repository (confirmed via `find . -iname "*.yml" -o -iname "*.yaml"`, which returned no results outside of what doesn't exist).

**Root cause**

No CI was ever set up for this project.

**Recommended fix**

Add a minimal CI workflow (GitHub Actions is a reasonable default given the project's structure) that runs on every push/PR: install dependencies, type-check, run the audit gate, run the new unit tests, and run lint (once [ARCH-3](#arch-3-no-linting-or-formatting-tooling-configured) is addressed). This is a cheap, high-leverage fix that should land early since it's the mechanism that keeps every other fix in this report from silently regressing.

**Implementation steps**

1. Add `.github/workflows/ci.yml` with, at minimum:
   ```yaml
   name: CI
   on: [push, pull_request]
   jobs:
     build-and-test:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: 22 }
         - run: npm ci
         - run: npx tsc --noEmit
         - run: npm audit --audit-level=high
         - run: npm test
   ```
2. Once ESLint is added ([ARCH-3](#arch-3-no-linting-or-formatting-tooling-configured)), add a lint step.
3. Once the Electron GUI verify scripts are made CI-friendly ([TEST-2](#test-2-existing-verify-scripts-are-manual-environment-dependent-smoke-tests)), add them as a separate job using `xvfb-run`.
4. Enable this workflow as a required status check on the repository's default branch.

**Tests to add**

- N/A (this finding *is* the test-infrastructure fix; it depends on [TEST-1](#test-1-zero-unit-test-coverage-for-the-riskiest-code-in-the-repository) existing to have something meaningful to run).

**Validation steps**

- Open a trivial PR and confirm the workflow triggers and all steps pass/fail as expected (e.g., intentionally introduce a type error in a scratch branch to confirm the `tsc` step catches it, then revert).

**Risks**

- Minimal; this is additive infrastructure with no impact on existing code.

**Estimated effort:** Low (half a day to a day for the initial workflow).

---

### 5.4 Documentation

#### DOC-1: No README or contributor-facing documentation

**Severity:** Medium–High &nbsp;|&nbsp; **Category:** Documentation &nbsp;|&nbsp; **Priority:** Immediate

**Evidence**

`find . -maxdepth 1 -iname "readme*"` returns nothing. The only substantial prose document in the repository is `AGENTS.md` (12 KB), which is explicitly framed as "the master specification and execution plan for AI coding agents building this application" — a build/implementation spec written to be followed literally by an AI agent (it includes full source-code listings inline), not user- or contributor-facing documentation. It doesn't explain, from a human contributor's or user's perspective: what the app does today (vs. what was originally specified), how to set up the submodule, how to run the app day-to-day, or what's actually implemented vs. planned (notably, `AGENTS.md`'s own listed source no longer matches the current implementation in several places — e.g., its `protocol.ts` and `viewer-preload.ts` listings are earlier, simpler versions than what's in `src/` today).

**Root cause**

No README was ever created; `AGENTS.md` was treated as sufficient documentation, but it serves a fundamentally different purpose (a one-time agent build spec, now partially stale) than ongoing project documentation.

**Recommended fix**

Add a standard `README.md` covering: what the app is/does, prerequisites (Node version, git submodule setup), setup steps (`git submodule update --init --recursive`, `npm install`, `npm run build`, `npm start`), the current feature set (viewing, highlight annotations, in-place text editing/export) and its known limitations (cross-reference [COR-1](#cor-1-text-edit-encoding-model-cannot-represent-most-real-world-pdf-fonts)), and how to run tests/verification once those exist.

**Implementation steps**

1. Write `README.md` with the sections above.
2. Cross-link `AGENTS.md` from the README, clarifying it's a historical build specification rather than current documentation, and either update it to match the current implementation or clearly mark sections that have diverged.
3. Document the `vendor/pdf.js` submodule setup requirement explicitly (`git submodule update --init --recursive`), since `scripts/build-pdfjs.js` fails with a confusing error if this step is skipped (see [§6](#6-additional--lower-priority-observations)).

**Tests to add**

- N/A (documentation task); optionally, a CI step that checks the README's documented setup commands actually succeed from a clean checkout (a lightweight form of "doc testing").

**Validation steps**

- Have someone unfamiliar with the project follow the README from a fresh clone and confirm they can get the app running without out-of-band help.

**Risks**

- None; pure documentation addition.

**Estimated effort:** Low (about a day).

---

#### DOC-2: No CONTRIBUTING, CHANGELOG, or SECURITY policy

**Severity:** Medium &nbsp;|&nbsp; **Category:** Documentation &nbsp;|&nbsp; **Priority:** Medium-term

**Evidence**

No `CONTRIBUTING.md`, `CHANGELOG.md`, or `SECURITY.md` exists in the repository.

**Root cause**

Same as [DOC-1](#doc-1-no-readme-or-contributor-facing-documentation) — these were simply never created.

**Recommended fix**

- `CONTRIBUTING.md`: coding conventions (once [ARCH-3](#arch-3-no-linting-or-formatting-tooling-configured) establishes them), how to run tests/CI locally, PR expectations.
- `CHANGELOG.md`: start tracking user-visible changes going forward (the git log's commit messages are agent/tooling-oriented, not a substitute for a curated changelog).
- `SECURITY.md`: given this app processes untrusted PDF files and has a real attack surface, a documented process for reporting security issues is particularly relevant here, not just boilerplate.

**Implementation steps**

1. Add the three files with project-appropriate content.
2. Reference `SECURITY.md` from `README.md`.

**Tests to add**

- N/A.

**Validation steps**

- Files exist, are linked from the README, and reflect the project's actual current practices (don't promise a process — e.g., a specific response SLA — that isn't actually staffed).

**Risks**

- None.

**Estimated effort:** Low (half a day).

---

### 5.5 Dependencies

#### DEP-1: No automated dependency update or audit gate

**Severity:** Medium &nbsp;|&nbsp; **Category:** Dependency &nbsp;|&nbsp; **Priority:** Short-term

**Evidence**

No Dependabot (`.github/dependabot.yml`), Renovate (`renovate.json`), or equivalent configuration exists. `npm outdated` currently reports:

```
Package       Current    Wanted  Latest  Location
@types/node  20.19.43  20.19.43  26.4.0  node_modules/@types/node
electron       29.4.6    29.4.6  44.1.0  node_modules/electron
typescript      5.9.3     5.9.3   7.0.2  node_modules/typescript
```

Combined with no CI ([TEST-3](#test-3-no-continuous-integration-configured)), there is currently no mechanism — automated or process-based — that would have surfaced the Electron CVE exposure short of a manual audit like this one.

**Root cause**

No tooling was configured to track dependency drift or new advisories over time.

**Recommended fix**

Add Dependabot (simplest, native to GitHub, zero extra infra) configured for the npm ecosystem and git submodules, plus the `npm audit --audit-level=high` CI gate from [TEST-3](#test-3-no-continuous-integration-configured).

**Implementation steps**

1. Add `.github/dependabot.yml`:
   ```yaml
   version: 2
   updates:
     - package-ecosystem: "npm"
       directory: "/"
       schedule: { interval: "weekly" }
     - package-ecosystem: "gitsubmodule"
       directory: "/"
       schedule: { interval: "weekly" }
   ```
2. Confirm the `npm audit` CI step from [TEST-3](#test-3-no-continuous-integration-configured) is in place so Dependabot PRs have an automated pass/fail signal.

**Tests to add**

- N/A (process/infrastructure).

**Validation steps**

- Confirm Dependabot opens its first round of PRs after merging the config, and that CI runs against them.

**Risks**

- None directly; downstream dependency-bump PRs (like the Electron upgrade) carry their own risk, but that's tracked separately.

**Estimated effort:** Low (a few hours).

*(Note: `pdf-lib`, at `1.17.1`, is already the latest version published to npm — its last release was in 2021. This isn't a fixable "outdated dependency" issue in this repository, but it is worth tracking as a supply-chain awareness item: the app's core PDF-manipulation library appears to have low upstream release velocity.)*

---

### 5.6 Architecture & Maintainability

#### ARCH-1: A third of `src/` is dead code; the specced architecture was abandoned

**Severity:** High &nbsp;|&nbsp; **Category:** Architecture / Maintainability &nbsp;|&nbsp; **Priority:** Short-term

**Evidence**

A full import-graph scan (`grep -rn "^import" --include="*.ts" src`) shows the following modules are **never imported by any other file** in the codebase:

| File | Lines | Purpose (per its own code/comments) |
|---|---|---|
| `src/main/extensions.ts` | 76 | MV3 extension loader & IPC bridge |
| `src/renderer/adapter/event-bus.ts` | 74 | Typed wrapper around the PDF.js EventBus |
| `src/renderer/adapter/overlay-manager.ts` | 110 | Overlay-layer injection/virtualization manager |
| `src/renderer/adapter/viewport-math.ts` | 20 | PDF↔DOM coordinate conversion |
| `src/renderer/polyfills/chrome-pdf-editor.ts` | 28 | `chrome.pdfEditor` MV3 polyfill API |
| `src/shared/pdf-merger.ts` | 35 | `pdf-lib`-based annotation flattener |
| `src/shared/types.ts` | 79 | Shared IPC types/DTOs |

That's **422 of ~1,800 lines (≈23%)** of `src/` that compiles cleanly but is not reachable from either of the app's real entry points (`src/main/index.ts` and `src/preload/viewer-preload.ts`). Meanwhile, the application's *actual* overlay-virtualization logic, coordinate math (via PDF.js's own `viewport.convertToViewportPoint`/`convertToPdfPoint`, not `viewport-math.ts`), and annotation rendering are all reimplemented **inline, untyped, as a template-literal string** inside `viewer-preload.ts` (lines ~582–660) — duplicating, in weaker form, what `overlay-manager.ts` and `event-bus.ts` already implement in proper, typed, testable TypeScript.

**Root cause**

This is a direct artifact of the multi-agent build process visible in git history: `AGENTS.md` specifies the modular architecture above as the intended structure, and an early commit ("Claude Opus 4.6 (Thinking) & Gemini 3.7 Flash (High): initial snapshot") appears to have scaffolded it. Later commits ("Codex GPT 5.6 Terra: Add editable PDF text overlays...", "GPT 5.6 Luna: Fix PDF text editing...") added the real, working functionality directly into `viewer-preload.ts` as inline strings — likely because that file's `webviewerloaded`/`eval`-based integration pattern was the path of least resistance for injecting logic into PDF.js's main-world context — without circling back to either wire the new logic through the existing modules or delete the now-superseded ones.

**Recommended fix**

Pick one of two directions and commit to it, rather than leaving both in place:

- **Option A (recommended):** Delete the unused modules that have no unique logic left worth salvaging (`extensions.ts` — since no extension-loading UI/flow exists yet; `pdf-merger.ts` — since annotation flattening isn't currently exposed as a feature) and **migrate** the inline logic in `viewer-preload.ts` to use the modules that do have salvageable logic (`overlay-manager.ts`, `event-bus.ts`, `viewport-math.ts`, `chrome-pdf-editor.ts`), loading them as a real compiled script rather than an `eval`'d string (this also directly supports SEC-6 (fixed)).
- **Option B:** If the modular architecture is intentionally deferred future work, move those five/seven files to a clearly-labeled location (e.g., `src/_planned/` or a tracking issue referencing them) so they don't sit in `src/` looking like live, tested application code.

**Implementation steps**

1. Confirm with the project owner which direction (A or B) is intended.
2. If A: refactor `viewer-preload.ts`'s inline overlay/event logic to import and use `OverlayManager`, `PDFEventBusAdapter`, and the coordinate helpers from `viewport-math.ts`; delete `extensions.ts` and `pdf-merger.ts` (or explicitly wire them into a real feature if one is planned); delete `types.ts` duplication by consolidating on it as the canonical type source ([ARCH-2](#arch-2-duplicate-independently-maintained-type-definitions)).
3. If B: relocate and clearly label the unused modules; add a tracking note in `README.md`/`CONTRIBUTING.md` about their status.

**Tests to add**

- Once migrated to real, imported modules, add unit tests for `OverlayManager` and `PDFEventBusAdapter` (both are pure, DOM/EventBus-mockable classes and straightforward to test) — this is a natural companion to [TEST-1](#test-1-zero-unit-test-coverage-for-the-riskiest-code-in-the-repository).

**Validation steps**

- `npx tsc --noEmit` still passes.
- The app's overlay/annotation and virtualization behavior is unchanged after migration (validate via `verify-full-lifecycle.js`).
- `grep -rn "^import" src` shows no orphaned files remaining (every file in `src/` is reachable from an entry point, or explicitly relocated/labeled per Option B).

**Risks**

- Medium: refactoring `viewer-preload.ts`'s inline logic is inherently a bit risky given it currently has zero test coverage of its own; sequence this after [TEST-1](#test-1-zero-unit-test-coverage-for-the-riskiest-code-in-the-repository) and alongside SEC-6 (fixed) (they touch the same file) rather than as an isolated change.

**Estimated effort:** Medium (2–4 days).

---

#### ARCH-2: Duplicate, independently-maintained type definitions

**Severity:** Medium &nbsp;|&nbsp; **Category:** Maintainability &nbsp;|&nbsp; **Priority:** Short-term

**Evidence**

`PDFTextEdit` is defined **twice**, independently:

- `src/shared/types.ts:58-63` (extends a shared `PDFRect`, unused anywhere)
- `src/shared/text-editor.ts:8-17` (the one actually used by `applyTextEditsToPDF`)

`PDFAnnotationRect` is likewise defined **twice**:

- `src/shared/types.ts:52-55`
- `src/shared/pdf-merger.ts:4-11` (the one actually used, in dead code — see [ARCH-1](#arch-1-a-third-of-src-is-dead-code-the-specced-architecture-was-abandoned))

**Root cause**

`types.ts` was scaffolded early as the intended single source of truth for shared DTOs (per its own doc comment: "IPC types and payload DTOs shared between main, preload, and renderer processes"), but later feature work (the text-edit commits) defined its own local, near-identical copies instead of importing from it — likely because `viewer-preload.ts`'s logic lives inside a plain-JS template-literal string (see SEC-6 (fixed)) where importing a `.ts` module isn't straightforward, so the "real" TypeScript files (`text-editor.ts`, `pdf-merger.ts`) each just redeclared the shape they needed locally.

**Recommended fix**

Consolidate on `src/shared/types.ts` as the single canonical source for these DTOs; have `text-editor.ts` and `pdf-merger.ts` import from it instead of redeclaring.

**Implementation steps**

1. Update `src/shared/types.ts`'s `PDFTextEdit` definition if needed so it matches the field set actually used by `text-editor.ts` (currently identical in shape, just declared twice).
2. Change `src/shared/text-editor.ts` and `src/shared/pdf-merger.ts` to `import type { PDFTextEdit, PDFAnnotationRect } from './types'` instead of locally redeclaring.
3. Remove the now-redundant local interface declarations.

**Tests to add**

- N/A directly, but this reduces the risk surface for runtime IPC validation, which should be written against the single canonical type.

**Validation steps**

- `npx tsc --noEmit` passes with no new errors after consolidation.

**Risks**

- Low; this is a mechanical type-consolidation change with compiler-verified correctness.

**Estimated effort:** Low (a few hours).

---

#### ARCH-3: No linting or formatting tooling configured

**Severity:** Medium &nbsp;|&nbsp; **Category:** Maintainability &nbsp;|&nbsp; **Priority:** Short-term

**Evidence**

No `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, or `.editorconfig` exists anywhere in the repository. `package.json` has no `lint` or `format` script.

**Root cause**

Never configured.

**Recommended fix**

Add ESLint (with `@typescript-eslint`) configured with at least `no-eval` (SEC-6 (fixed)), `no-unused-vars`/dead-export detection (would have flagged [ARCH-1](#arch-1-a-third-of-src-is-dead-code-the-specced-architecture-was-abandoned) automatically), and standard TypeScript recommended rules; add Prettier for consistent formatting; wire both into CI ([TEST-3](#test-3-no-continuous-integration-configured)).

**Implementation steps**

1. `npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier eslint-config-prettier`.
2. Add a flat `eslint.config.js` extending recommended TypeScript rules plus `no-eval: 'error'`.
3. Add `"lint": "eslint src scripts"` and `"format": "prettier --write ."` to `package.json` scripts.
4. Run once, fix or explicitly suppress (with justification comments) any resulting findings — expect this to immediately flag SEC-6 (fixed)'s `eval()` calls and some of the dead exports from [ARCH-1](#arch-1-a-third-of-src-is-dead-code-the-specced-architecture-was-abandoned).
5. Add the `lint` step to the CI workflow from [TEST-3](#test-3-no-continuous-integration-configured).

**Tests to add**

- N/A (tooling, not test code).

**Validation steps**

- `npm run lint` runs cleanly (or with only justified, explicitly-suppressed exceptions) in CI.

**Risks**

- Low; may surface a batch of pre-existing style/quality issues on first run, requiring a cleanup pass, but this is a one-time cost.

**Estimated effort:** Low (about a day, plus follow-up cleanup time proportional to what the linter finds).

---

#### ARCH-4: Stray, already-applied `patch.diff` committed into the working tree

**Severity:** Low &nbsp;|&nbsp; **Category:** Maintainability (repo hygiene) &nbsp;|&nbsp; **Priority:** Immediate (trivial to fix)

**Evidence**

`patch.diff` (22 KB, 622 lines) is present in the repository as an **untracked** file (`git status` lists it under "Untracked files"). Comparing it directly against `git show 89e9e74` (the current `HEAD` commit) shows it is **byte-for-byte the same diff content as the most recent commit** — it appears to be a leftover export of that commit's patch (e.g., from `git show > patch.diff` or similar), left behind in the working tree rather than cleaned up.

**Root cause**

Process artifact from the AI-agent-driven commit workflow; not cleaned up after use.

**Recommended fix**

Delete the file; if patch files are a recurring output of this project's workflow, add `*.diff`/`*.patch` to `.gitignore` to prevent this recurring.

**Implementation steps**

1. `git clean` or manually `rm patch.diff`.
2. Optionally add `*.diff` and `*.patch` to `.gitignore`.

**Tests to add**

- N/A.

**Validation steps**

- `git status` shows a clean working tree.

**Risks**

- None.

**Estimated effort:** Trivial (minutes).

---

#### ARCH-5: No production packaging or distribution pipeline

**Severity:** Low–Medium &nbsp;|&nbsp; **Category:** Architecture &nbsp;|&nbsp; **Priority:** Long-term

**Evidence**

`devDependencies` in `package.json` includes only `electron`, `typescript`, and their types — no `electron-builder`, `electron-forge`, `electron-packager`, or similar. There is no packaging configuration (`electron-builder.yml`, `forge.config.js`, etc.) anywhere in the repository. The only defined way to run the app is `npm start` → `electron .`, which requires a full development checkout (cloned repo, submodule initialized, `npm install`, `npm run build`).

**Root cause**

Out of scope for the original `AGENTS.md` specification, which focuses entirely on the build/runtime integration of PDF.js and doesn't mention distribution.

**Recommended fix**

Once the application is otherwise stabilized (after the higher-priority items in this report), add `electron-builder` (or `electron-forge`) configuration to produce installable artifacts (`.dmg`/`.exe`/`.AppImage`) for actual end-user distribution, if that's a project goal. If the project is intended to remain developer-only for now, this can reasonably stay deferred — flagging it here mainly so it's a deliberate decision rather than an oversight.

**Implementation steps**

1. Decide whether/when end-user distribution is a project goal.
2. If yes: add `electron-builder`, configure target platforms, and add a `package`/`dist` npm script; wire artifact builds into a release CI workflow (separate from the PR-validation CI in [TEST-3](#test-3-no-continuous-integration-configured)).

**Tests to add**

- A CI smoke test that a packaged build launches successfully, once packaging is implemented.

**Validation steps**

- A packaged artifact installs and runs on a clean machine without the source checkout present.

**Risks**

- Low priority relative to the correctness/security items in this report; sequence last.

**Estimated effort:** Medium (a few days), when undertaken.

---

### 5.7 Performance

#### PERF-1: Full content-stream re-tokenization and reallocation per individual edit

**Severity:** Low–Medium &nbsp;|&nbsp; **Category:** Performance &nbsp;|&nbsp; **Priority:** Medium-term

**Evidence**

`src/shared/text-editor.ts:29-41` loops over each edit and calls `applyTextReplacementToPDF` once per edit:

```ts
for (const edit of edits) {
  const replacement: ContentTextReplacement = { ... };
  const changed = await applyTextReplacementToPDF(pdfDocument, replacement);
  ...
}
```

Each call to `applyTextReplacementToPDF` → `applyReplacementToBytes` (`pdf-text-content.ts:282-358`) fully **re-tokenizes the entire page content stream from scratch** (`tokenize(bytes)`, an O(n) scan over every byte) and, on a match, **allocates a brand-new byte array for the full stream** (`new Uint8Array(result.length - ... + edit.bytes.length)`) to splice in the change — repeated once per edit on that page.

**Root cause**

The implementation optimizes for simplicity/correctness of a single edit rather than batching. For a page with many edits (e.g., a user editing a dozen fields on a form-like PDF), this results in O(edits × page-content-stream-size) work and repeated full-buffer allocation, where a batched single-pass approach could tokenize once and apply all matching edits for that page together.

**Recommended fix**

Restructure `applyTextEditsToPDF` to group edits by `pageIndex`, tokenize each page's content stream once, and apply all of that page's edits against the single token/byte buffer before writing the result back — reducing the complexity from O(edits × stream-size) to O(pages × stream-size) in the common case.

**Implementation steps**

1. In `text-editor.ts`, group the incoming `edits` array by `pageIndex` before processing.
2. Refactor `applyReplacementToBytes` (or add a new batched variant) to accept multiple `ContentTextReplacement`s for the same byte buffer and apply them in a single pass, being careful to keep offset bookkeeping correct as earlier edits shift the positions of later ones (the existing code already sorts individual edits' byte-range replacements by descending `start` offset to avoid this exact problem within a single call — the same technique extends to a multi-edit batch).
3. Benchmark before/after on a synthetic large content stream with many edits to confirm the improvement.

**Tests to add**

- A unit test applying multiple edits to the same page in one call and confirming the result matches applying them one-by-one (regression-safety for the refactor).
- A simple benchmark/perf test (not necessarily gating CI, but useful for tracking) measuring time for N edits on a large synthetic content stream before and after.

**Validation steps**

- Functional output is identical before/after the refactor (covered by the regression test above).
- Measured improvement on a multi-edit benchmark scenario.

**Risks**

- Medium: this touches the same delicate offset-bookkeeping logic flagged in [COR-1](#cor-1-text-edit-encoding-model-cannot-represent-most-real-world-pdf-fonts) and [TEST-1](#test-1-zero-unit-test-coverage-for-the-riskiest-code-in-the-repository); sequence after unit test coverage exists for the current single-edit path, so the refactor has a safety net.

**Estimated effort:** Medium (2–3 days, including benchmarking).

---

#### PERF-2: Unconditional global `Proxy` wrapping of `CSSStyleDeclaration`

**Severity:** Low &nbsp;|&nbsp; **Category:** Performance &nbsp;|&nbsp; **Priority:** Long-term

**Evidence**

`src/preload/viewer-preload.ts:245-289` wraps the `style` property getter on `HTMLElement.prototype`, `SVGElement.prototype`, and `Element.prototype` with a `Proxy` for the entire lifetime of the window, unconditionally — applied to every element in the document, not just PDF.js's own chrome — purely to work around a narrow CSS `round()` compatibility gap in older bundled Chromium versions (per the code's own comment, "for Chromium <125").

**Root cause**

A targeted compatibility shim was implemented as a blanket, always-on interception rather than being scoped or feature-detected against the actual runtime Chromium version.

**Recommended fix**

Feature-detect whether `round()` in CSS values is natively supported by the current Chromium (e.g., via `CSS.supports('width', 'round(1px, 1px)')`) and skip installing the `Proxy` wrapper entirely when native support is present — which, once the Electron upgrade lands (bundling Chromium well past version 125), should be the common case going forward, effectively retiring this workaround.

**Implementation steps**

1. Add a `CSS.supports(...)`-based feature check before calling `wrapStyleGetter`.
2. Re-evaluate necessity entirely after the Electron upgrade; likely remove outright.

**Tests to add**

- N/A beyond the general polyfill tests suggested in SEC-6 (fixed).

**Validation steps**

- After the Electron upgrade, confirm CSS `round()` values render correctly without the shim installed.

**Risks**

- Low; this is a targeted, low-risk optimization/cleanup, best done as a follow-up to the Electron upgrade rather than in isolation.

**Estimated effort:** Low (a few hours), best done alongside the Electron upgrade.

---

## 6. Additional / Lower-Priority Observations

These didn't warrant full individual write-ups but are worth tracking:

- **`scripts/build-pdfjs.js` gives no clear error if the `vendor/pdf.js` submodule isn't initialized.** It unconditionally runs `npm ci && npx gulp generic` inside `vendor/pdf.js` (`scripts/build-pdfjs.js:10`); on a fresh clone without `git submodule update --init --recursive`, that directory is empty and the command fails with a generic, confusing shell error rather than a clear message telling the contributor what to do. **Fix:** add a pre-flight check (`fs.existsSync(path.join(SUBMODULE_DIR, 'package.json'))`) that fails fast with an actionable error message.
- **No `engines` field in `package.json`.** Nothing pins/documents the required Node.js version, which matters here since the project uses `Uint8Array.prototype.toHex`-style TC39 shims and modern TypeScript target (`ES2022`). Low priority; add `"engines": { "node": ">=20" }` for clarity.
- **Naming inconsistency across the project.** The npm package is named `electron-pdfjs-editor` (`package.json:2`), the repository/directory is `pdf-edit`, and `AGENTS.md` refers to the project directory as `pdf-editor-electron/`. Purely cosmetic, but worth aligning for clarity in READMEs, issue trackers, and release artifacts.
- **`extensions.ts`'s (currently dead) design loads arbitrary unpacked MV3 extensions with no allow-list or signature check** (`src/main/extensions.ts:24-55`, via `ses.loadExtension(extPath)` for every subdirectory of an `extensions/` folder containing a `manifest.json`). This isn't reachable today ([ARCH-1](#arch-1-a-third-of-src-is-dead-code-the-specced-architecture-was-abandoned)), but if/when this feature is wired up, it should be designed with an explicit extension allow-list or signing/verification step from the start, given it would let arbitrary local code run with elevated session privileges.
- **`pdf-lib` (core dependency for all PDF byte manipulation) is at its latest published version (1.17.1) but has had no new release since 2021.** Not an actionable fix within this repository, but worth tracking as a supply-chain risk factor — if a security issue is found in `pdf-lib` in the future, there may be no active upstream maintainer to patch it quickly.

---

## 7. Remediation Roadmap

Grouped by suggested timeframe. Items within a group are roughly ordered by leverage (cheapest, highest-impact first).

### Immediate (this week — cheap and/or high-risk items)

| ID | Action |
|---|---|
| [ARCH-4](#arch-4-stray-already-applied-patchdiff-committed-into-the-working-tree) | Delete stray `patch.diff`; add `*.diff`/`*.patch` to `.gitignore` |
| [DOC-1](#doc-1-no-readme-or-contributor-facing-documentation) | Add a `README.md` with setup/build/run/known-limitations |
| [TEST-3](#test-3-no-continuous-integration-configured) | Stand up a basic CI workflow (install, `tsc --noEmit`, `npm audit`) |
| [TEST-1](#test-1-zero-unit-test-coverage-for-the-riskiest-code-in-the-repository) | Add a test framework and unit-test the PDF content-stream tokenizer |

### Short-term (this month)

| ID | Action |
|---|---|
| [COR-2](#cor-2-failed-text-edit-exports-fail-silently) | Surface export failures to the user instead of console-only logging |
| [COR-1](#cor-1-text-edit-encoding-model-cannot-represent-most-real-world-pdf-fonts) | *Start* the font-encoding-aware rework (detect-and-reject CID/complex fonts first) |
| [TEST-2](#test-2-existing-verify-scripts-are-manual-environment-dependent-smoke-tests) | Convert manual verify scripts into repo-contained, CI-runnable tests |
| [ARCH-2](#arch-2-duplicate-independently-maintained-type-definitions) | Consolidate duplicate type definitions onto `shared/types.ts` |
| [ARCH-3](#arch-3-no-linting-or-formatting-tooling-configured) | Add ESLint + Prettier, enforce in CI |
| [ARCH-1](#arch-1-a-third-of-src-is-dead-code-the-specced-architecture-was-abandoned) | Decide on and begin executing the dead-code consolidation/deletion |
| [DEP-1](#dep-1-no-automated-dependency-update-or-audit-gate) | Add Dependabot + `npm audit` CI gate |

### Medium-term (this quarter)

| ID | Action |
|---|---|
| [COR-1](#cor-1-text-edit-encoding-model-cannot-represent-most-real-world-pdf-fonts) | Complete font-encoding-aware substitution for simple (non-CID) fonts |
| [DOC-2](#doc-2-no-contributing-changelog-or-security-policy) | Add `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md` |
| [PERF-1](#perf-1-full-content-stream-re-tokenization-and-reallocation-per-individual-edit) | Batch per-page tokenization/edit application |

### Long-term (beyond this quarter)

| ID | Action |
|---|---|
| [PERF-2](#perf-2-unconditional-global-proxy-wrapping-of-cssstyledeclaration) | Feature-detect and retire the `CSSStyleDeclaration` `Proxy` workaround post-Electron-upgrade |
| [ARCH-5](#arch-5-no-production-packaging-or-distribution-pipeline) | Add packaging/distribution tooling, if end-user distribution becomes a goal |

---

## 8. Assumptions

- **Threat model.** This report assumes the application's core purpose — opening and editing PDF files supplied by the end user — includes files from **untrusted or semi-trusted sources** (downloads, email attachments, etc.), not exclusively files the user authored themselves. This assumption directly drives the severity assigned to the sandbox-related finding (now resolved). If the intended use is strictly self-authored/fully-trusted PDFs in a closed environment, that finding should be downgraded in relative priority (though still worth fixing as defense-in-depth).
- **Development environment.** Findings assume a Linux/CI-style environment consistent with the one used to run this analysis (Node 22, npm 10). Behavior on Windows/macOS build environments was not independently verified, particularly around the Electron packaging and `pdftotext`/Poppler dependency in [TEST-2](#test-2-existing-verify-scripts-are-manual-environment-dependent-smoke-tests).
- **`vendor/pdf.js` submodule contents.** The submodule was not checked out in the provided archive (expected for a distribution snapshot), so this report evaluates PDF.js **integration code only**, not PDF.js's own internals — those are explicitly out of scope per `AGENTS.md`'s "Zero Submodule Modifications" constraint, and are assumed to be audited/maintained upstream by the Mozilla PDF.js project rather than this repository.
- **`git log` history is complete and accurate** as provided in the archive (5 commits, each attributed to a different named AI agent/model via a single git author identity). This report treats that history as informative context (e.g., explaining the architecture drift in [ARCH-1](#arch-1-a-third-of-src-is-dead-code-the-specced-architecture-was-abandoned)) rather than as a finding in itself — no judgment is made about the acceptability of AI-agent-authored commits as a development practice.
- **Severity ratings** reflect a general-purpose desktop-application risk model (confidentiality/integrity/availability impact × realistic exploitability given the app's stated purpose), not a specific organizational risk framework (e.g., CVSS was not formally computed per finding).
- **Effort estimates** assume a single experienced full-stack/TypeScript engineer familiar with Electron, working without significant unrelated interruptions; actual effort will vary with team familiarity and process overhead (code review, staged rollout, etc.).
- **No dynamic/runtime testing of the actual Electron GUI was performed** for this report (no display server was available in the analysis environment); all findings are based on static code inspection, `tsc` compilation, `npm audit`, and manual tracing of control/data flow. Findings that would benefit from runtime confirmation are noted as such in their "Validation steps."

---

## 9. Report Validation

This report was checked for completeness and Markdown correctness as follows:

- **Structural completeness:** All 9 requested elements are present — (1) project-type/language/tooling identification (§2), (2) issue inspection across all 7 requested categories (security, correctness, testing, documentation, dependency, performance, architecture/maintainability — §5.1–5.7), (3) analysis commands actually run and their real output (§3), (4) severity/category classification for every finding (table in §4 and per-finding headers in §5), (5) risk/impact/effort-based prioritization (Priority + Est. Effort columns in §4, plus the ordered §7 roadmap), (6) the full per-issue template (Evidence, Root Cause, Recommended Fix, Implementation Steps, Tests to Add, Validation Steps, Risks, Estimated Effort) applied to all 20 detailed findings, (7) a four-tier remediation roadmap (§7), (8) documented assumptions (§8), and (9) this validation section.
- **Evidence traceability:** every detailed finding cites a specific file and, where applicable, line numbers or command output actually captured during this analysis (§3) — no finding relies on unverified assumption alone.
- **Internal consistency:** every finding ID referenced in the summary table (§4), the roadmap (§7), and cross-references within other findings' write-ups resolves to an actual anchor/section in §5 (spot-checked manually against the document's own heading slugs).
- **Markdown syntax:** all fenced code blocks are opened and closed in matched pairs; all tables have consistent column counts between header, separator, and body rows; heading levels increase by at most one level at a time; no raw, unescaped `<`/`>` characters appear outside of code blocks. The file renders correctly as standard (CommonMark/GFM) Markdown.
