# link-anchor

**Default:** warn

A link to a heading in another markdown file (`[setup](docs/guide.md#setup)`) must point at a
heading that exists. Anchors are computed the way GitHub does (lowercase, punctuation removed,
spaces become `-`, duplicates get `-1`, `-2`…); explicit `id="…"` / `name="…"` anchors count too.

GitHub line anchors (`#L10`, `#L10-L20`) aren't checked. Missing files are reported by
[path-exists](path-exists.md).
