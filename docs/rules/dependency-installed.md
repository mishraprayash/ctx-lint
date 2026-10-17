# dependency-installed

**Default:** warn · Skipped with `--no-deps`

Libraries the instructions tell agents to use must be declared in some `package.json`
(`dependencies`, `devDependencies`, `peerDependencies` or `optionalDependencies`), or be a
package in the repo.

A backticked name only counts as a library when the words right next to it say so:

- import statements in code blocks (`import { z } from 'zod'`);
- a cue word right before it: "install / add / import / require `x`", "the `x` package";
- a weaker cue ("use / prefer / recommend `x`") for plain or scoped names only, so
  `Use `user.name`` or `Prefer `snake_case`` are not libraries;
- a package noun right after it: "`zod` library", "`vitest` framework".

Mentions that warn *against* a package (`instead of `moment``, `don't use `axios``, `avoid …`)
don't need it installed. Node built-ins and common words are ignored.

## Other ecosystems

The rule only checks JavaScript libraries:

- It does nothing in a repo without a `package.json`.
- An instruction file whose nearest manifest (in its directory or the closest ancestor that has
  one) is a `pyproject.toml`, `requirements.txt`, `Cargo.toml`, `go.mod`, `Gemfile` or similar
  is skipped, including when that manifest sits next to a `package.json`.
- Names declared as Python dependencies anywhere in the repo (`pyproject.toml` dependencies,
  optional dependencies, dependency groups and Poetry sections, `requirements*.txt`) count as
  declared, compared the way pip does (`Typing_Extensions` = `typing-extensions`).
