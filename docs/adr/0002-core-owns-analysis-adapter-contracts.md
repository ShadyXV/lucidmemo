# ADR: Core owns analysis adapter contracts

`@lucidmemo/core` defines the `ExtractionAdapter` and `EmbeddingAdapter` interfaces. Adapter packages (`@lucidmemo/extraction`, `@lucidmemo/embedding`) implement these interfaces and re-export them from core. Core services depend on the interfaces only. CLI and MCP wiring choose concrete adapters and pass them in.

**Why:** Analysis orchestration (`createDreamAnalysis`, `createSubmittedDreamAnalysis`) is domain logic that lives in `@lucidmemo/core`. It needs stable contracts to depend on. If adapter interfaces lived in their implementation packages, core would have to import from those packages — coupling domain logic to concrete adapters — or orchestration would have to move back into CLI/MCP.

**Future contributor rule:** When adding a new extraction or embedding adapter, implement the interfaces exported by `@lucidmemo/core`. Do not define a second adapter contract in the adapter package.
