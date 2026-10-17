You are a Staff Developer Tools Engineer. Build a complete, production-ready CLI tool called `ctx-lint` (Context Linter & Sync for AI Coding Agents).

### Problem Statement
Developers use multiple AI coding agents (Claude Code, Cursor, OpenCode, Windsurf/Devin, GitHub Copilot), each requiring separate rule files (`CLAUDE.md`, `.cursor/rules/*.mdc`, `AGENTS.md`, `.github/copilot-instructions.md`). Furthermore, these instruction files suffer from "Context Rot"—referencing deleted file paths, renamed directories, outdated CLI commands, or uninstalled packages, which causes AI agents to hallucinate and waste tokens.

### Core Requirements & Features
Build a fast, zero-LLM-dependency CLI tool with three core commands:

1. `ctx-lint check` (The Context Linter)
   - Scans existing agent instruction files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`).
   - Extracts all inline code blocks and backticked references that look like:
     a) File or directory paths (e.g., `src/auth/guards/`, `./scripts/deploy.sh`) and verifies they actually exist on the filesystem.
     b) Package script commands (e.g., `npm run test:e2e`, `pnpm build`, `make migrate`) and cross-checks them against `package.json` or `Makefile` to verify the script exists.
     c) Referenced dependencies/libraries (e.g., if the rule says "Use `zod` for validation", check if `zod` is actually in `package.json` dependencies).
   - Outputs a clean, ESLint-style terminal report showing line numbers, broken references, and warnings. Returns a non-zero exit code on errors so it can run in GitHub Actions / Git hooks.

2. `ctx-lint sync` (Cross-Agent Compiler)
   - Reads a single source of truth directory (`.context/rules/*.md` with YAML frontmatter for `description`, `globs`, and `alwaysApply`).
   - Compiles and transpiles these rules into target-specific formats based on a `.context/config.json`:
     - Generates/updates `CLAUDE.md` and `AGENTS.md` (consolidating global rules and mapping path-specific rules cleanly).
     - Generates `.cursor/rules/*.mdc` files with proper Cursor frontmatter.
     - Generates `.github/copilot-instructions.md`.
   - Adds a header comment to generated files warning against manual edits.

3. `ctx-lint audit` (Token Budget Analyzer)
   - Calculates the approximate token count of each rule file (using a lightweight offline tokenizer or heuristic).
   - Warns if the always-on baseline context exceeds a configurable threshold (e.g., 2,500 tokens).

### Technical Stack & Architecture
- Language: [Specify TypeScript with Commander.js/Chalk OR Go with Cobra/Lipgloss].
- Modularity: Keep the parser, filesystem verifier, manifest inspector (`package.json`/`Makefile`), and target compilers decoupled in clean modules.
- Edge Cases: Ignore URLs, generic code snippets, and placeholder paths like `path/to/file` or `<id>` during path linting.

### Deliverables
1. Provide the project directory structure.
2. Write the complete, working implementation for all core modules (`cli`, `linter`, `syncer`, `auditor`, and `parsers`).
3. Include a sample `.context/` configuration and a test markdown file with intentional broken paths/scripts to demonstrate `ctx-lint check` catching errors.