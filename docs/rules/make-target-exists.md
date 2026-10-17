# make-target-exists

**Default:** error

`make <target>` and `just <recipe>` must exist in the Makefile/justfile that would run them: the
nearest one at or above the instruction file, or the one given with `-C` / `-f` (`-d` / `-f` for just).

Makefile parsing covers rules, `.PHONY` declarations, pattern rules (`%.o`) and `include`d files
(one level). If the Makefile computes target names (`$(BIN): …`), a missing target is only a
warning. justfiles: recipes, aliases, `import`s and `mod` modules.
