---
"@pnpm/fs.hard-link-dir": patch
"pnpm": patch
---

Don't crash with `ERR_PNPM_ENOENT` when concurrent postinstall backfills race while hard linking a built package into its other hoisted locations [#10179](https://github.com/pnpm/pnpm/issues/10179).
