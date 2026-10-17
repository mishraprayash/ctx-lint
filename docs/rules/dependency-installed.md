# dependency-installed

**Default:** warn · Skipped with `--no-deps`

Libraries the instructions tell agents to use must be declared in some `package.json`
(`dependencies`, `devDependencies`, `peerDependencies` or `optionalDependencies`), or be a
package in the repo.

A backticked name only counts as a library when the sentence says so:

- import statements in code blocks (`import { z } from 'zod'`);
- "library", "package", "dependency", "install", "framework"… anywhere nearby;
- "use / using / with / via / built with" right before a one-word name (`Use `zod` for validation`);
- scoped names (`@tanstack/react-query`) always count.

Mentions that warn *against* a package (`instead of `moment``, `don't use `axios``, `avoid …`)
don't need it installed. Node built-ins and common words are ignored.
