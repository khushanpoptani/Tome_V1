import { backend, isTauriRuntime } from "@/lib/backend";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useShellStore } from "@tome/stores";
import type { PropsWithChildren } from "react";
import { useEffect, useRef, useState } from "react";
import { toast, Toaster } from "sonner";

function DesktopBootstrap(): null {
  const initialized = useRef(false);
  const setActiveServer = useShellStore((state) => state.setActiveServer);
  const setPermissionMode = useShellStore((state) => state.setPermissionMode);
  const setTheme = useShellStore((state) => state.setTheme);

  useEffect(() => {
    if (!isTauriRuntime() || initialized.current) {
      return;
    }
    initialized.current = true;
    const bootstrap = async (): Promise<void> => {
      const settings = new Map(await backend.getSettings());
      const savedTheme = settings.get("theme");
      if (savedTheme === "dark" || savedTheme === "light" || savedTheme === "system") {
        setTheme(savedTheme);
      }
      const savedPermission = settings.get("permissionMode");
      if (
        savedPermission === "ask" ||
        savedPermission === "smart" ||
        savedPermission === "full"
      ) {
        setPermissionMode(savedPermission);
      }

      let servers = await backend.listServers();
      if (servers.length === 0) {
        await backend.saveServer({
          isActive: true,
          name: "Home Ollama",
          url: "http://192.168.1.12:11434",
        });
        servers = await backend.listServers();
      }
      const active = servers.find((server) => server.isActive) ?? servers[0] ?? null;
      if (active !== null) {
        if (!active.isActive) {
          await backend.setActiveServer(active.id);
        }
        setActiveServer({ ...active, isActive: true });
      }
    };
    void bootstrap().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Tome startup failed.";
      toast.error(message);
    });
  }, [setActiveServer, setPermissionMode, setTheme]);
  return null;
}

function ConnectionMonitor(): null {
  const activeServer = useShellStore((state) => state.activeServer);
  const setDiagnostics = useShellStore((state) => state.setDiagnostics);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isTauriRuntime() || activeServer === null) {
      return;
    }
    let active = true;
    const test = async (): Promise<void> => {
      try {
        const diagnostics = await backend.testServer({
          serverId: activeServer.id,
          url: activeServer.url,
        });
        if (active) {
          setDiagnostics(diagnostics);
          if (diagnostics.apiAvailable) {
            void queryClient.invalidateQueries({
              queryKey: ["models", activeServer.url],
            });
          }
        }
      } catch {
        // The Rust command records detailed diagnostics and the last good UI state remains visible.
      }
    };
    void test();
    const interval = window.setInterval(() => {
      void test();
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [activeServer, queryClient, setDiagnostics]);

  return null;
}

function ThemeController({ children }: PropsWithChildren): React.JSX.Element {
  const theme = useShellStore((state) => state.theme);
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent): void => {
      setSystemDark(event.matches);
    };
    media.addEventListener("change", handleChange);
    return () => {
      media.removeEventListener("change", handleChange);
    };
  }, []);

  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  return (
    <>
      {children}
      <Toaster closeButton position="bottom-right" richColors theme={resolvedTheme} />
    </>
  );
}

export function AppProviders({ children }: PropsWithChildren): React.JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 30_000,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <DesktopBootstrap />
      <ConnectionMonitor />
      <ThemeController>{children}</ThemeController>
    </QueryClientProvider>
  );
}
