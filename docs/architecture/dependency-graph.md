# Implementation Dependency Graph

## Runtime graph

```mermaid
flowchart TD
    Request["User request"] --> Router["Agent Router (server)"]
    Router -->|technical| Technical["Technical Agent (server)"]
    Router -->|documentation| Docs["Documentation Agent (server)"]
    Router -.->|research - future| Research["Research Agent (server)"]

    Technical -->|implementation| Planning["Planning Agent (server)"]
    Technical -->|debug| Diagnosis["Diagnosis Agent (server)"]
    Planning --> Engine["Execution Engine (client)"]

    Engine --> Strategy["Strategy Agent (server)"]
    Strategy --> Context["Project Context Builder (client)"]
    Context --> Codegen["Code Generation Agent (server)"]
    Codegen --> Security["Security Layer (client)"]
    Security --> Writer["File Writer (client)"]
    Writer --> Verify["Verification Engine (client)"]

    Verify -->|pass| State["Persist step state (SQLite)"]
    State -->|more steps| Engine
    State -->|complete| Result["Task complete"]

    Verify -->|fail| Diagnosis
    Diagnosis --> Repair["Repair Agent (server)"]
    Repair --> Security

    Docs --> Security
```

## Build-order graph

```mermaid
flowchart TD
    A["1. Toolchain + monorepo"] --> B["2. Shared config, types, schemas"]
    B --> C["3. UI primitives + design tokens"]
    B --> D["4. Rust domain/application ports"]
    C --> E["5. Desktop shell + routes"]
    D --> E
    E --> F["6. Persistence + settings"]
    F --> G["7. Ollama HTTP/WS transport"]
    G --> H["8. Workspace/project context"]
    H --> I["9. Security authorization"]
    I --> J["10. File Writer + Verification"]
    J --> K["11. Execution Engine"]
    K --> L["12. Agent workflows"]
    L --> M["13. Packaging, signing, updater"]
```

## Package dependencies

```mermaid
flowchart LR
    Desktop["apps/desktop"] --> UI["@tome/ui"]
    Desktop --> API["@tome/api"]
    Desktop --> Stores["@tome/stores"]
    Desktop --> Hooks["@tome/hooks"]
    Desktop --> Config["@tome/config"]
    Desktop --> Types["@tome/types"]

    UI --> Utils["@tome/utils"]
    API --> Types
    API --> Config
    Stores --> Types
    Hooks --> API
    Hooks --> Stores
    Hooks --> Types
```

Dependencies flow inward toward stable contracts. Feature packages may consume
shared packages, but shared packages may not import application features.

