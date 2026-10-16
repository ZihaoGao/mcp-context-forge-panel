# Third-party notices

The original ContextForge Console implementation is licensed under the [MIT License](LICENSE).
Third-party material retains its own license and attribution.

## ContextForge API contracts

Upstream: [IBM/mcp-context-forge](https://github.com/IBM/mcp-context-forge), tag `v1.0.11`,
commit `077071bbb43599dd5ab9372ebdbb9a8e686a9816`.

Copyright contributors to the MCP-CONTEXT-FORGE project.
Licensed under the Apache License, Version 2.0. A copy of the upstream license
is included in [licenses/ContextForge-Apache-2.0.txt](licenses/ContextForge-Apache-2.0.txt).
There is no root `NOTICE` file in this upstream tag.

The API specifications and route metadata in `contracts/contextforge/` are
captured or extracted from this upstream version. This project also produces
modified, reduced and classified contract assets, including `web-contract.json`,
`auth-contract.json`, the coverage inventories, and the generated API declarations
in `packages/api-client/schema.d.ts`. Changes include removing examples and long
documentation, adding panel classifications, and generating frontend types.
These upstream-derived materials retain the upstream Apache-2.0 license;
the project's MIT license does not replace it.

The frontend is implemented in this repository with React and TypeScript.
During development, searches for backend resource associations and permissions
also returned matching JavaScript snippets from the upstream `mcpgateway/admin_ui/`
directory. This project does not claim that development occurred without viewing
any upstream frontend code. The session review did not establish direct copying;
it was not a comprehensive code similarity audit.

## npm dependencies

Dependencies retain their respective licenses. Installed packages include their
license files; the dependency versions and available license metadata are recorded
in `package-lock.json`.
