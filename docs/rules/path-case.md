# path-case

**Default:** error · **Fixable:** yes

The path exists, but with different capitalization: `src/Utils/date.ts` vs `src/utils/date.ts`.
This works on macOS and Windows (case-insensitive file systems), but agents running on Linux
(including most CI and cloud agents) won't find the file.

`--fix` rewrites the reference to the exact case on disk when there's a single match.
