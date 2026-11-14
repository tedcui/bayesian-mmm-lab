# M7 public-release review

This is a local release assessment, not authorization to push or publish. The dashboard is a synthetic portfolio demonstration. No Git remote is configured in the inspected checkout, and no GitHub Pages settings or live site were changed.

## Browser artifact audit

`npm run validate:public` and `npm run validate:dist` enforce the exact five-file JSON inventory, bundle IDs, manifest SHA-256 digests and byte counts, the approved 96-of-3,200 joint-draw simulator subset, and the `/bayesian-mmm-lab/` asset base. The dist check also rejects unexpected artifact files and scans the built scripts, styles and JSON for operational identifiers, contact/loyalty fields, legacy `RSS_SILVER`, MSA and CareDx labels. `npm test` separately validates the full M4 schema and source-to-export reconciliations. The final artifact contains `index.html`, built CSS/JS, and the five JSON files; it contains no Parquet, NetCDF, source detail, ground-truth file, credentials or source contact records. `segments.json` intentionally includes **aggregate synthetic coefficient truth** for the labeled educational evaluation overlay. It is not the generator's full `ground_truth.json`.

These automated checks cover file names, known sensitive field names, checksums and structure. They cannot establish that the user-supplied schema description is cleared for public release.

## Repository metadata requiring a decision

| Location | Finding | Public-release action proposed |
|---|---|---|
| `docs/SOURCE_SCHEMA_AND_ETL.md` | Adapts the supplied three-table source description, including 44/42/19 column names, Oracle-style types, candidate keys and sample joins. These may be organization-specific even though all generated rows are invented. | Obtain explicit approval to publish these metadata, or prepare a coordinated generic public schema and regenerate/test the dependent code and artifacts. Do not silently edit the authoritative private contract. |
| `AGENTS.md`, milestone prompts | Still name MSA and CareDx as exclusions and describe the origin of the supplied schema. No legacy `rss_silver` table name was found in tracked text. | Replace organization references with generic wording in a reviewed public variant if attribution is not approved. |
| `modeling/src/mmm_lab/simulation/schema.py`, ETL code, dictionaries and notebooks | Mirror the source column inventory by design. The two small reference Parquets include **invented** store/contact fields; `data/metadata/ground_truth.json` is synthetic evaluation truth. | Review whether to publish those synthetic examples and detailed field names. If anonymization is required, change code, docs, fixtures, generated data and hashes together, then rerun all gates. |
| `web/public/model-data/` | Contains aggregate synthetic summaries, region/week observations, 96 fitted joint draws and the aggregate known-truth overlay. No source rows or direct identifiers were detected. | Approve the educational synthetic truth and posterior subset as public demo data. Keep the full posterior NetCDF and source detail out of the site. |

## Release checks and remaining gates

- Local CI-equivalent commands: `uv sync --offline --locked`; `uv run --locked mmm-generate-source`; `uv run --locked mmm-build-mart`; `uv run --locked pytest -q` (with the repository-local uv cache); `npm ci`; `npm run validate:public`; `npm run typecheck`; `npm test`; `npm run build`; `npm run validate:dist`. Source regeneration produced the same tracked contents, 171,741 eligible transaction lines, zero join fanout and 601,108 reconciled units over 720 segment-weeks. All 38 Python and 16 frontend tests passed. No MCMC fit ran.
- The built artifact is **2,975,603 bytes** uncompressed, including **1,504,992 bytes** of the five public JSON files. The lazy Plotly chunk is 1,161,700 bytes uncompressed (385.02 kB gzip) and causes Vite's size warning; the main JavaScript chunk is 286,970 bytes. This is a performance item for later review, not a failed build.
- Vite preview served the index, assets and all five model-data files with HTTP 200 at `/bayesian-mmm-lab/`. Hash routes are covered by the React tests. A connected visual browser was unavailable, so desktop/mobile screenshot inspection is **still required before publication**.
- GitHub Actions CI rebuilds the synthetic source and mart and runs locked Python/frontend tests. The separate Pages workflow has **manual dispatch only**, a `main` branch guard and a `github-pages` environment. It rebuilds from committed JSON, validates checksums and schema, and does not fit MCMC.
- Before any public push: decide and explicitly approve the source-schema metadata and generated synthetic examples above. A sanitization choice may require code and export regeneration. Review the result again after those changes.
- In GitHub repository **Settings → Pages**, choose **GitHub Actions** as the source. In **Settings → Environments → github-pages**, require a reviewer and restrict deployment to `main`. After authorized push and passing CI, manually dispatch the Pages workflow, approve its environment gate, and verify the live URL and all four pages at `https://<owner>.github.io/bayesian-mmm-lab/`. A Git remote and repository owner must be supplied before these steps can be completed.

GitHub's [Pages publishing-source guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) describes the repository setting and deployment environment; [Vite's static deployment guide](https://vite.dev/guide/static-deploy) documents the repository subpath base.
