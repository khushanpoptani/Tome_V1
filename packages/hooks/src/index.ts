export const queryKeys = {
  server: {
    all: ["server"] as const,
    health: () => [...queryKeys.server.all, "health"] as const,
    models: () => [...queryKeys.server.all, "models"] as const,
  },
  workspaces: {
    all: ["workspaces"] as const,
    detail: (id: string) => [...queryKeys.workspaces.all, id] as const,
  },
} as const;
