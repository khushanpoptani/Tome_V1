import { inputClassName, Modal } from "@/components/common/page";
import {
  ChoiceButton,
  SettingRow,
  SettingsPanel,
} from "@/features/settings/settings-controls";
import { backend, isTauriRuntime, pullModel, streamChat } from "@/lib/backend";
import { errorMessage, formatBytes, formatDate } from "@/lib/format";
import {
  readLocalSetting,
  removeLocalSetting,
  writeLocalSetting,
} from "@/lib/local-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { application, permissionModeLabels } from "@tome/config";
import { useShellStore } from "@tome/stores";
import type {
  OllamaModel,
  OllamaModelInformation,
  PermissionMode,
  ServerInput,
  ServerRecord,
  StreamEvent,
  ThemeMode,
} from "@tome/types";
import { Badge, Button } from "@tome/ui";
import {
  Check,
  CircleAlert,
  Database,
  Download,
  Eye,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const selectClassName =
  "h-8 min-w-36 rounded-md border border-border bg-secondary px-2 text-xs text-secondary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

function persistSetting(key: string, value: string): void {
  if (isTauriRuntime()) {
    void backend.setSetting(key, value).catch((error: unknown) => {
      toast.error(errorMessage(error));
    });
  }
}

export function GeneralSettings(): React.JSX.Element {
  const [language, setLanguage] = useState("en");
  const [restorePage, setRestorePage] = useState(
    () => readLocalSetting("tome:restore-last-page") !== "false",
  );
  const settings = useQuery({
    enabled: isTauriRuntime(),
    queryFn: backend.getSettings,
    queryKey: ["settings"],
  });

  useEffect(() => {
    const values = new Map(settings.data ?? []);
    const savedLanguage = values.get("language");
    if (savedLanguage !== undefined) setLanguage(savedLanguage);
    const savedRestore = values.get("restoreLastPage");
    if (savedRestore !== undefined) setRestorePage(savedRestore === "true");
  }, [settings.data]);

  return (
    <SettingsPanel
      description="Control how Tome behaves on this Mac."
      title="Application"
    >
      <SettingRow
        control={
          <select
            className={selectClassName}
            onChange={(event) => {
              setLanguage(event.target.value);
              persistSetting("language", event.target.value);
            }}
            value={language}
          >
            <option value="en">English</option>
          </select>
        }
        description="Language used throughout the desktop application."
        title="Language"
      />
      <SettingRow
        control={
          <button
            aria-label="Restore last opened page"
            aria-pressed={restorePage}
            className={`relative h-5 w-9 rounded-full transition ${
              restorePage ? "bg-primary" : "bg-secondary"
            }`}
            onClick={() => {
              const next = !restorePage;
              setRestorePage(next);
              writeLocalSetting("tome:restore-last-page", String(next));
              persistSetting("restoreLastPage", String(next));
              if (!next) {
                removeLocalSetting("tome:last-page");
              }
            }}
            type="button"
          >
            <span
              className={`absolute top-0.5 size-4 rounded-full bg-white transition ${
                restorePage ? "left-[18px]" : "left-0.5"
              }`}
            />
          </button>
        }
        description="Return to your most recently opened page when Tome starts."
        title="Restore last page"
      />
    </SettingsPanel>
  );
}

const themeDescriptions: Readonly<Record<ThemeMode, string>> = {
  dark: "Use Tome's focused dark workspace.",
  light: "Use a bright workspace with strong contrast.",
  system: "Follow the current macOS appearance.",
};

export function AppearanceSettings(): React.JSX.Element {
  const theme = useShellStore((state) => state.theme);
  const setTheme = useShellStore((state) => state.setTheme);

  return (
    <SettingsPanel
      description="Theme changes apply immediately and persist locally."
      title="Theme"
    >
      <div className="grid gap-3 p-5 sm:grid-cols-3">
        {(["dark", "light", "system"] as const).map((mode) => (
          <ChoiceButton
            active={theme === mode}
            description={themeDescriptions[mode]}
            key={mode}
            onClick={() => {
              setTheme(mode);
              persistSetting("theme", mode);
            }}
            title={mode.charAt(0).toUpperCase() + mode.slice(1)}
          />
        ))}
      </div>
    </SettingsPanel>
  );
}

interface ServerFormState {
  readonly id?: string;
  readonly name: string;
  readonly url: string;
}

export function ServerSettings(): React.JSX.Element {
  const activeServer = useShellStore((state) => state.activeServer);
  const diagnostics = useShellStore((state) => state.diagnostics);
  const setActiveServer = useShellStore((state) => state.setActiveServer);
  const setDiagnostics = useShellStore((state) => state.setDiagnostics);
  const [form, setForm] = useState<ServerFormState | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const servers = useQuery({
    enabled: isTauriRuntime(),
    queryFn: backend.listServers,
    queryKey: ["servers"],
  });
  const history = useQuery({
    enabled: isTauriRuntime() && activeServer !== null,
    queryFn: () => backend.listConnectionHistory(activeServer?.id ?? ""),
    queryKey: ["connection-history", activeServer?.id],
  });
  const save = useMutation({
    mutationFn: (input: ServerInput) => backend.saveServer(input),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (server) => {
      setForm(null);
      void queryClient.invalidateQueries({ queryKey: ["servers"] });
      if (server.isActive) setActiveServer(server);
      toast.success("Server saved.");
    },
  });
  const remove = useMutation({
    mutationFn: backend.deleteServer,
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: (_, id) => {
      if (activeServer?.id === id) {
        setActiveServer(null);
        setDiagnostics(null);
      }
      void queryClient.invalidateQueries({ queryKey: ["servers"] });
      toast.success("Server removed.");
    },
  });

  const activate = async (server: ServerRecord): Promise<void> => {
    try {
      await backend.setActiveServer(server.id);
      setActiveServer({ ...server, isActive: true });
      await queryClient.invalidateQueries({ queryKey: ["servers"] });
      toast.success(`${server.name} is active.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const test = async (server: ServerRecord): Promise<void> => {
    setTesting(server.id);
    try {
      const result = await backend.testServer({
        serverId: server.id,
        url: server.url,
        verifyStreaming: true,
      });
      if (activeServer?.id === server.id) setDiagnostics(result);
      await queryClient.invalidateQueries({ queryKey: ["servers"] });
      await queryClient.invalidateQueries({
        queryKey: ["connection-history", server.id],
      });
      toast[result.apiAvailable ? "success" : "error"](
        result.apiAvailable ? `Connected in ${result.pingMs ?? 0} ms.` : result.error,
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="space-y-4">
      <SettingsPanel
        description="Manage Ollama endpoints. Exactly one server is active at a time."
        title="Ollama servers"
      >
        <div className="flex justify-end p-4">
          <Button
            onClick={() =>
              setForm({ name: "Ollama Server", url: "http://127.0.0.1:11434" })
            }
            size="sm"
          >
            <Plus className="size-3.5" />
            Add server
          </Button>
        </div>
        {(servers.data ?? []).map((server) => (
          <div className="flex items-center gap-3 px-5 py-4" key={server.id}>
            <span
              className={`size-2 rounded-full ${
                server.lastStatus === "connected"
                  ? "bg-emerald-400"
                  : "bg-muted-foreground"
              }`}
            />
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => void activate(server)}
              type="button"
            >
              <span className="flex items-center gap-2 text-xs font-medium">
                {server.name}
                {server.isActive ? <Badge>Active</Badge> : null}
              </span>
              <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                {server.url}
              </span>
              <span className="mt-1 block text-[9px] text-muted-foreground">
                {server.lastVersion === null
                  ? "Not tested"
                  : `Ollama ${server.lastVersion}`}
                {server.lastPingMs === null ? "" : ` · ${server.lastPingMs} ms`}
              </span>
            </button>
            <Button
              disabled={testing !== null}
              onClick={() => void test(server)}
              size="sm"
              variant="outline"
            >
              {testing === server.id ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <Play className="size-3" />
              )}
              Test
            </Button>
            <Button
              aria-label={`Edit ${server.name}`}
              onClick={() =>
                setForm({ id: server.id, name: server.name, url: server.url })
              }
              size="icon"
              variant="ghost"
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              aria-label={`Remove ${server.name}`}
              onClick={() => {
                if (window.confirm(`Remove "${server.name}"?`)) remove.mutate(server.id);
              }}
              size="icon"
              variant="ghost"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
      </SettingsPanel>

      <SettingsPanel
        description="Latest end-to-end health check for the active endpoint."
        title="Connection status"
      >
        {diagnostics === null ? (
          <p className="p-5 text-xs text-muted-foreground">
            Test the active server to begin.
          </p>
        ) : (
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            {[
              ["Server reachable", diagnostics.reachable],
              ["Ollama responding", diagnostics.ollamaResponding],
              ["REST API available", diagnostics.apiAvailable],
              ["Streaming API available", diagnostics.streamingAvailable],
              ["Streaming verified", diagnostics.streamingVerified],
            ].map(([label, passed]) => (
              <div className="flex items-center gap-2 text-xs" key={String(label)}>
                {passed ? (
                  <Check className="size-4 text-emerald-400" />
                ) : (
                  <CircleAlert className="size-4 text-amber-400" />
                )}
                {label}
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">
              Ping: {diagnostics.pingMs ?? "—"} ms
            </p>
            <p className="text-[10px] text-muted-foreground">
              Version: {diagnostics.version ?? "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Installed: {diagnostics.installedModels.length}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Running: {diagnostics.runningModels.length}
            </p>
            {diagnostics.error === null ? null : (
              <p className="col-span-full rounded-lg bg-amber-500/10 p-3 text-[10px] leading-relaxed text-amber-500">
                {diagnostics.error}
              </p>
            )}
          </div>
        )}
      </SettingsPanel>

      <SettingsPanel
        description="The last 50 persisted connection attempts."
        title="Connection history"
      >
        {(history.data ?? []).length === 0 ? (
          <p className="p-5 text-xs text-muted-foreground">
            No connection attempts stored.
          </p>
        ) : (
          <div className="max-h-52 overflow-auto">
            {history.data?.map((item) => (
              <div className="flex items-center justify-between px-5 py-3" key={item.id}>
                <span>
                  <span className="block text-xs capitalize">{item.status}</span>
                  <span className="text-[9px] text-muted-foreground">
                    {formatDate(item.testedAt)}
                  </span>
                </span>
                <span className="text-right text-[10px] text-muted-foreground">
                  {item.version === null ? item.error : `v${item.version}`}
                  {item.pingMs === null ? "" : ` · ${item.pingMs} ms`}
                </span>
              </div>
            ))}
          </div>
        )}
      </SettingsPanel>

      {form === null ? null : (
        <Modal
          onClose={() => setForm(null)}
          title={form.id === undefined ? "Add server" : "Edit server"}
        >
          <form
            className="space-y-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate({
                ...(form.id === undefined ? {} : { id: form.id }),
                isActive:
                  form.id === undefined
                    ? (servers.data?.length ?? 0) === 0
                    : activeServer?.id === form.id,
                name: form.name,
                url: form.url,
              });
            }}
          >
            <label className="block space-y-1.5 text-xs">
              <span>Name</span>
              <input
                className={inputClassName}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
                value={form.name}
              />
            </label>
            <label className="block space-y-1.5 text-xs">
              <span>URL</span>
              <input
                className={inputClassName}
                onChange={(event) => setForm({ ...form, url: event.target.value })}
                required
                type="url"
                value={form.url}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setForm(null)} type="button" variant="outline">
                Cancel
              </Button>
              <Button disabled={save.isPending} type="submit">
                Save server
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

const curatedModels = [
  {
    description: "Qwen multilingual coding and structured output model.",
    name: "qwen2.5:3b",
    parameters: "3.09B",
  },
  {
    description: "Meta multilingual instruction and tool-use model.",
    name: "llama3.2:3b",
    parameters: "3.21B",
  },
  {
    description: "Google's compact Gemma 2 model.",
    name: "gemma2:2b",
    parameters: "2.61B",
  },
  {
    description: "Microsoft Phi-2 reasoning model.",
    name: "phi:2.7b",
    parameters: "2.7B",
  },
  {
    description: "Hugging Face compact on-device model.",
    name: "smollm2:1.7b",
    parameters: "1.71B",
  },
] as const;

export function ModelSettings(): React.JSX.Element {
  const activeServer = useShellStore((state) => state.activeServer);
  const setSelectedModel = useShellStore((state) => state.setSelectedModel);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<{
    info: OllamaModelInformation;
    model: OllamaModel;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<Readonly<Record<string, number>>>({});
  const queryClient = useQueryClient();
  const models = useQuery({
    enabled: isTauriRuntime() && activeServer !== null,
    queryFn: () => backend.listModels(activeServer?.url ?? ""),
    queryKey: ["models", activeServer?.url],
    refetchInterval: 30_000,
  });
  const modelTests = useQuery({
    enabled: isTauriRuntime() && activeServer !== null,
    queryFn: () => backend.listModelTests(activeServer?.id ?? ""),
    queryKey: ["model-tests", activeServer?.id],
  });
  const filteredInstalled = useMemo(
    () =>
      (models.data ?? []).filter((model) =>
        model.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [models.data, search],
  );
  const filteredAvailable = useMemo(
    () =>
      curatedModels.filter((model) =>
        `${model.name} ${model.description}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [search],
  );
  const installedNames = new Set((models.data ?? []).map((model) => model.name));
  const testByModel = new Map(
    (modelTests.data ?? []).map((result) => [result.model, result] as const),
  );
  const totalStorage = (models.data ?? []).reduce((sum, model) => sum + model.size, 0);

  const download = async (model: string): Promise<void> => {
    if (activeServer === null) return;
    const taskId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    setBusy(model);
    let log = `Started download for ${model}\n`;
    let lastUpdate = 0;
    await backend.saveTask({
      id: taskId,
      kind: "model-download",
      logs: log,
      progress: 0,
      startedAt,
      status: "running",
      title: `Download ${model}`,
    });
    try {
      await pullModel(taskId, activeServer.url, model, (event) => {
        if (event.type !== "progress" && event.type !== "status") return;
        const percent = event.type === "progress" ? (event.percent ?? 0) : 0;
        setProgress((current) => ({ ...current, [model]: percent }));
        const message = event.message;
        log += `${message}${percent > 0 ? ` ${percent.toFixed(1)}%` : ""}\n`;
        const now = Date.now();
        if (now - lastUpdate > 600) {
          lastUpdate = now;
          void backend.saveTask({
            id: taskId,
            kind: "model-download",
            logs: log,
            progress: percent,
            startedAt,
            status: "running",
            title: `Download ${model}`,
          });
        }
      });
      await backend.saveTask({
        id: taskId,
        endedAt: new Date().toISOString(),
        kind: "model-download",
        logs: `${log}Download completed.\n`,
        progress: 100,
        startedAt,
        status: "completed",
        title: `Download ${model}`,
      });
      await queryClient.invalidateQueries({ queryKey: ["models", activeServer.url] });
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(`${model} installed.`);
    } catch (error) {
      const message = errorMessage(error);
      const cancelled = message.toLowerCase().includes("cancelled");
      await backend.saveTask({
        id: taskId,
        endedAt: new Date().toISOString(),
        kind: "model-download",
        logs: `${log}${message}\n`,
        progress: progress[model] ?? 0,
        startedAt,
        status: cancelled ? "cancelled" : "failed",
        title: `Download ${model}`,
      });
      toast[cancelled ? "info" : "error"](message);
    } finally {
      setBusy(null);
    }
  };

  const testModel = async (model: string): Promise<boolean> => {
    if (activeServer === null) return false;
    const taskId = crypto.randomUUID();
    setBusy(`test:${model}`);
    const startedAt = new Date().toISOString();
    await backend.saveTask({
      id: taskId,
      kind: "model-test",
      logs: `Sending "Hello" to ${model} with streaming enabled.\n`,
      progress: 10,
      startedAt,
      status: "running",
      title: `Test ${model}`,
    });
    let response = "";
    let completed = false;
    try {
      await streamChat(
        {
          messages: [{ content: "Hello", role: "user" }],
          model,
          requestId: taskId,
          url: activeServer.url,
        },
        (event: StreamEvent) => {
          if (event.type === "token") response += event.content;
          if (event.type === "complete") completed = true;
        },
      );
      if (response.trim().length === 0 || !completed) {
        throw new Error(
          "The model did not produce a valid completed streaming response.",
        );
      }
      await backend.saveModelTest(activeServer.id, model, "completed");
      await backend.saveTask({
        endedAt: new Date().toISOString(),
        id: taskId,
        kind: "model-test",
        logs: `Streaming: passed\nTokens: received\nResponse: ${response.slice(0, 500)}\n`,
        progress: 100,
        startedAt,
        status: "completed",
        title: `Test ${model}`,
      });
      toast.success(`${model} passed inference and streaming.`);
      void queryClient.invalidateQueries({ queryKey: ["model-tests", activeServer.id] });
      return true;
    } catch (error) {
      const message = errorMessage(error);
      await backend.saveModelTest(activeServer.id, model, "failed", message);
      await backend.saveTask({
        endedAt: new Date().toISOString(),
        id: taskId,
        kind: "model-test",
        logs: `${message}\nPartial response: ${response}\n`,
        progress: 100,
        startedAt,
        status: "failed",
        title: `Test ${model}`,
      });
      toast.error(`${model}: ${message}`);
      void queryClient.invalidateQueries({ queryKey: ["model-tests", activeServer.id] });
      return false;
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    }
  };

  if (activeServer === null) {
    return (
      <SettingsPanel description="Connect an Ollama server first." title="Models">
        <p className="p-5 text-xs text-muted-foreground">No active server.</p>
      </SettingsPanel>
    );
  }

  return (
    <div className="space-y-4">
      <SettingsPanel
        description={`${filteredInstalled.length} installed · ${formatBytes(totalStorage)} total storage`}
        title="Installed models"
      >
        <div className="flex gap-2 p-4">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
            <input
              className={`${inputClassName} pl-8`}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search models…"
              value={search}
            />
          </label>
          <Button onClick={() => void models.refetch()} size="sm" variant="outline">
            <RefreshCw
              className={`size-3.5 ${models.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <Button
            disabled={busy !== null || filteredInstalled.length === 0}
            onClick={() => {
              void (async () => {
                for (const model of filteredInstalled) await testModel(model.name);
              })();
            }}
            size="sm"
            variant="outline"
          >
            Test all
          </Button>
        </div>
        {filteredInstalled.length === 0 ? (
          <div className="grid min-h-40 place-items-center text-center">
            <div>
              <Database className="mx-auto size-6 text-muted-foreground" />
              <p className="mt-2 text-xs">No installed models</p>
            </div>
          </div>
        ) : (
          filteredInstalled.map((model) => (
            <div className="flex items-center gap-3 px-5 py-4" key={model.name}>
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => setSelectedModel(model.name)}
                type="button"
              >
                <span className="flex items-center gap-2 text-xs font-medium">
                  {model.name}
                  {testByModel.get(model.name)?.status === "completed" ? (
                    <Badge className="text-emerald-500">Test passed</Badge>
                  ) : testByModel.get(model.name)?.status === "failed" ? (
                    <Badge className="text-red-400">Test failed</Badge>
                  ) : (
                    <Badge>Untested</Badge>
                  )}
                </span>
                <span className="mt-1 block text-[9px] text-muted-foreground">
                  {formatBytes(model.size)} ·{" "}
                  {model.details?.parameter_size ?? "Unknown parameters"} ·{" "}
                  {model.details?.quantization_level ?? "Unknown quantization"}
                </span>
              </button>
              <Button
                aria-label={`Details for ${model.name}`}
                onClick={() => {
                  void backend
                    .showModel(activeServer.url, model.name)
                    .then((info) => setDetail({ info, model }))
                    .catch((error: unknown) => toast.error(errorMessage(error)));
                }}
                size="icon"
                variant="ghost"
              >
                <Eye className="size-3.5" />
              </Button>
              <Button
                disabled={busy !== null}
                onClick={() => void testModel(model.name)}
                size="sm"
                variant="outline"
              >
                {busy === `test:${model.name}` ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : (
                  <Play className="size-3" />
                )}
                Test
              </Button>
              <Button
                aria-label={`Delete ${model.name}`}
                disabled={busy !== null}
                onClick={() => {
                  if (!window.confirm(`Delete ${model.name} from ${activeServer.name}?`))
                    return;
                  void backend
                    .deleteModel(activeServer.url, model.name)
                    .then(() => models.refetch())
                    .catch((error: unknown) => toast.error(errorMessage(error)));
                }}
                size="icon"
                variant="ghost"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))
        )}
      </SettingsPanel>

      <SettingsPanel
        description="Verified entries from the official Ollama model library, each approximately 3B parameters or smaller."
        title="Available models"
      >
        <div className="flex justify-end p-4">
          <Button
            disabled={
              busy !== null ||
              curatedModels.every((model) => installedNames.has(model.name))
            }
            onClick={() => {
              void (async () => {
                for (const model of curatedModels) {
                  if (!installedNames.has(model.name)) await download(model.name);
                }
              })();
            }}
            size="sm"
          >
            <Download className="size-3.5" />
            Download all required
          </Button>
        </div>
        {filteredAvailable.map((model) => {
          const installed = installedNames.has(model.name);
          return (
            <div className="flex items-center gap-3 px-5 py-4" key={model.name}>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-xs font-medium">
                  {model.name}
                  <Badge>{model.parameters}</Badge>
                  {installed ? (
                    <Badge className="text-emerald-500">Installed</Badge>
                  ) : null}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {model.description}
                </p>
                {(progress[model.name] ?? 0) > 0 && !installed ? (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${progress[model.name] ?? 0}%` }}
                    />
                  </div>
                ) : null}
              </div>
              <Button
                disabled={busy !== null || installed}
                onClick={() => void download(model.name)}
                size="sm"
                variant={installed ? "outline" : "default"}
              >
                {busy === model.name ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : installed ? (
                  <Check className="size-3" />
                ) : (
                  <Download className="size-3" />
                )}
                {installed ? "Installed" : "Download"}
              </Button>
            </div>
          );
        })}
      </SettingsPanel>

      {detail === null ? null : (
        <Modal
          onClose={() => setDetail(null)}
          title={detail.model.name}
          width="max-w-2xl"
        >
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            <p className="text-xs">
              Storage{" "}
              <span className="block text-muted-foreground">
                {formatBytes(detail.model.size)}
              </span>
            </p>
            <p className="text-xs">
              Parameters{" "}
              <span className="block text-muted-foreground">
                {detail.info.details?.parameter_size ??
                  detail.model.details?.parameter_size ??
                  "Unknown"}
              </span>
            </p>
            <p className="text-xs">
              Quantization{" "}
              <span className="block text-muted-foreground">
                {detail.info.details?.quantization_level ?? "Unknown"}
              </span>
            </p>
            <p className="text-xs">
              Context length{" "}
              <span className="block text-muted-foreground">
                {Object.entries(detail.info.model_info ?? {})
                  .find(([key]) => key.endsWith(".context_length"))?.[1]
                  ?.toString() ?? "Unknown"}
              </span>
            </p>
            <p className="col-span-full text-xs">
              Capabilities{" "}
              <span className="block text-muted-foreground">
                {detail.info.capabilities?.join(", ") ?? "chat"}
              </span>
            </p>
            <pre className="col-span-full max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-3 text-[9px] text-muted-foreground">
              {detail.info.parameters ?? "No parameter metadata."}
            </pre>
          </div>
        </Modal>
      )}
    </div>
  );
}

const permissionDescriptions: Record<PermissionMode, string> = {
  ask: "Require confirmation before every potentially destructive action.",
  smart: "Apply reviewed policy rules and ask when risk or intent is uncertain.",
  full: "Permit scoped actions without prompts. Intended for trusted environments only.",
};

type DatabaseResetTarget = "both" | "local" | "server";

const databaseResetPhrases: Readonly<Record<DatabaseResetTarget, string>> = {
  both: "RESET BOTH DATABASES",
  local: "RESET LOCAL DATABASE",
  server: "RESET SERVER DATABASE",
};

function trainingServerSupportsDatabaseReset(capabilitiesJson: string): boolean {
  try {
    const value: unknown = JSON.parse(capabilitiesJson);
    if (typeof value !== "object" || value === null) return false;
    return (value as Record<string, unknown>).databaseReset === true;
  } catch {
    return false;
  }
}

function trainingManagerUrlForOllama(ollamaUrl: string): string | null {
  try {
    const url = new URL(ollamaUrl);
    url.port = "11435";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function SecuritySettings(): React.JSX.Element {
  const permissionMode = useShellStore((state) => state.permissionMode);
  const activeOllamaServer = useShellStore((state) => state.activeServer);
  const setPermissionMode = useShellStore((state) => state.setPermissionMode);
  const setActiveConversation = useShellStore((state) => state.setActiveConversation);
  const setActiveProject = useShellStore((state) => state.setActiveProject);
  const setActiveServer = useShellStore((state) => state.setActiveServer);
  const setActiveWorkspace = useShellStore((state) => state.setActiveWorkspace);
  const setDiagnostics = useShellStore((state) => state.setDiagnostics);
  const setSelectedModel = useShellStore((state) => state.setSelectedModel);
  const queryClient = useQueryClient();
  const trainingServers = useQuery({
    enabled: isTauriRuntime(),
    queryFn: backend.listTrainingServers,
    queryKey: ["training-servers"],
  });
  const [resetTarget, setResetTarget] = useState<DatabaseResetTarget | null>(null);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);
  const [connectingTrainingServer, setConnectingTrainingServer] = useState(false);
  const activeTrainingServer =
    trainingServers.data?.find((server) => server.isActive) ??
    trainingServers.data?.[0] ??
    null;
  const suggestedTrainingManagerUrl =
    activeOllamaServer === null
      ? null
      : trainingManagerUrlForOllama(activeOllamaServer.url);
  const remoteResetAvailable =
    activeTrainingServer !== null &&
    trainingServerSupportsDatabaseReset(activeTrainingServer.capabilitiesJson);

  const connectTrainingManager = async (): Promise<void> => {
    if (activeOllamaServer === null || suggestedTrainingManagerUrl === null) {
      toast.error(
        "Configure the Windows Ollama server before reconnecting its Training Manager.",
      );
      return;
    }
    setConnectingTrainingServer(true);
    let savedServerId: string | null = null;
    try {
      const saved = await backend.saveTrainingServer({
        adapter: "tome-training-v1",
        isActive: true,
        name: `${activeOllamaServer.name} Training Manager`,
        url: suggestedTrainingManagerUrl,
      });
      savedServerId = saved.id;
      const tested = await backend.testTrainingServer(saved.id);
      if (tested.status !== "connected") {
        throw new Error(
          tested.lastError ??
            `The Training Manager at ${suggestedTrainingManagerUrl} did not pass its connection test.`,
        );
      }
      await backend.setActiveTrainingServer(saved.id);
      await queryClient.invalidateQueries({ queryKey: ["training-servers"] });
      toast.success(
        `Training Manager ${tested.version ?? ""} connected. Server database reset is now available.`,
      );
    } catch (error) {
      if (savedServerId !== null) {
        await backend.deleteTrainingServer(savedServerId).catch(() => undefined);
        await queryClient.invalidateQueries({ queryKey: ["training-servers"] });
      }
      toast.error(errorMessage(error));
    } finally {
      setConnectingTrainingServer(false);
    }
  };

  const testTrainingManager = async (): Promise<void> => {
    if (activeTrainingServer === null) return;
    setConnectingTrainingServer(true);
    try {
      const tested = await backend.testTrainingServer(activeTrainingServer.id);
      if (tested.status !== "connected") {
        throw new Error(
          tested.lastError ??
            `The Training Manager at ${activeTrainingServer.url} did not pass its connection test.`,
        );
      }
      await backend.setActiveTrainingServer(tested.id);
      await queryClient.invalidateQueries({ queryKey: ["training-servers"] });
      toast.success(
        `Training Manager ${tested.version ?? ""} connected. Server database reset is now available.`,
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setConnectingTrainingServer(false);
    }
  };

  const closeReset = (): void => {
    if (resetting) return;
    setResetTarget(null);
    setResetConfirmation("");
  };

  const performReset = async (): Promise<void> => {
    if (resetTarget === null || resetConfirmation !== databaseResetPhrases[resetTarget]) {
      return;
    }
    if (resetTarget !== "local" && !remoteResetAvailable) {
      toast.error(
        "Install Training Manager 0.1.12 or later and test the connection before resetting its database.",
      );
      return;
    }
    setResetting(true);
    let serverWasReset = false;
    try {
      if (resetTarget === "server" || resetTarget === "both") {
        const result = await backend.resetTrainingManagerDatabase(
          activeTrainingServer?.id ?? "",
          resetConfirmation,
        );
        serverWasReset = true;
        if (result.warnings.length > 0) {
          toast.warning(
            `Training Manager database reset with cleanup warnings: ${result.warnings.join("; ")}`,
          );
        }
      }
      if (resetTarget === "local" || resetTarget === "both") {
        const result = await backend.resetLocalDatabase(resetConfirmation);
        if (result.warnings.length > 0) {
          toast.warning(
            `Local database reset with cleanup warnings: ${result.warnings.join("; ")}`,
          );
        }
        setActiveConversation(null);
        setActiveProject(null);
        setActiveServer(null);
        setActiveWorkspace(null);
        setDiagnostics(null);
        setSelectedModel(null);
        setPermissionMode("ask");
        queryClient.clear();
        toast.success(
          resetTarget === "both"
            ? "Both databases were reset. Tome will restart with a clean local workspace."
            : "The local Tome database was reset. Tome will restart with a clean workspace.",
        );
        window.setTimeout(() => window.location.reload(), 700);
        return;
      }
      await queryClient.invalidateQueries();
      toast.success(
        "The Training Manager database and managed training data were reset.",
      );
      setResetTarget(null);
      setResetConfirmation("");
    } catch (error) {
      const message = errorMessage(error);
      toast.error(
        resetTarget === "both" && serverWasReset
          ? `The server reset succeeded, but the local reset failed: ${message}`
          : message,
      );
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-4">
      <SettingsPanel
        description="Choose how Tome authorizes potentially destructive desktop actions."
        title="Execution mode"
      >
        <div className="grid gap-3 p-5">
          {(["ask", "smart", "full"] as const).map((mode) => (
            <button
              aria-pressed={permissionMode === mode}
              className="flex items-start gap-3 rounded-lg border border-border bg-background/30 p-3 text-left transition hover:border-border-strong aria-pressed:border-violet-400/50 aria-pressed:bg-violet-400/10"
              key={mode}
              onClick={() => {
                setPermissionMode(mode);
                persistSetting("permissionMode", mode);
              }}
              type="button"
            >
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-border">
                {permissionMode === mode ? (
                  <Check className="size-3 text-violet-400" />
                ) : null}
              </span>
              <span>
                <span className="block text-xs font-medium">
                  {permissionModeLabels[mode]}
                </span>
                <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">
                  {permissionDescriptions[mode]}
                </span>
              </span>
            </button>
          ))}
        </div>
      </SettingsPanel>
      {permissionMode === "full" ? (
        <div className="flex gap-3 rounded-lg border border-amber-400/20 bg-amber-400/8 p-4">
          <CircleAlert className="size-4 shrink-0 text-amber-400" />
          <p className="text-[11px] leading-relaxed text-amber-500">
            Full Access permits future scoped execution without per-action prompts. Model
            and database operations remain restricted to their explicit controls.
          </p>
        </div>
      ) : null}
      <SettingsPanel
        description="Permanently clear persisted Tome or Training Manager data. Every reset requires typed confirmation, even in Full Access mode."
        title="Database reset"
      >
        <SettingRow
          control={
            <Button
              onClick={() => {
                setResetConfirmation("");
                setResetTarget("local");
              }}
              size="sm"
              variant="outline"
            >
              <Database className="size-3.5" />
              Reset local
            </Button>
          }
          description="Clears chats, projects, workspaces, settings, tasks, local training metadata, logs, and Tome-managed training artifacts. Source folders are preserved."
          title="Local Tome database"
        />
        <SettingRow
          control={
            activeTrainingServer === null ? (
              <Button
                disabled={
                  suggestedTrainingManagerUrl === null || connectingTrainingServer
                }
                onClick={() => void connectTrainingManager()}
                size="sm"
                variant="outline"
              >
                <RefreshCw
                  className={`size-3.5 ${connectingTrainingServer ? "animate-spin" : ""}`}
                />
                {connectingTrainingServer ? "Connecting..." : "Connect server"}
              </Button>
            ) : !remoteResetAvailable ? (
              <Button
                disabled={connectingTrainingServer}
                onClick={() => void testTrainingManager()}
                size="sm"
                variant="outline"
              >
                <RefreshCw
                  className={`size-3.5 ${connectingTrainingServer ? "animate-spin" : ""}`}
                />
                {connectingTrainingServer ? "Testing..." : "Test server"}
              </Button>
            ) : (
              <Button
                disabled={!remoteResetAvailable}
                onClick={() => {
                  setResetConfirmation("");
                  setResetTarget("server");
                }}
                size="sm"
                variant="outline"
              >
                <Server className="size-3.5" />
                Reset server
              </Button>
            )
          }
          description={
            activeTrainingServer === null
              ? suggestedTrainingManagerUrl === null
                ? "Configure the Windows Ollama server to reconnect its Training Manager."
                : `Reconnect the installed Training Manager at ${suggestedTrainingManagerUrl}.`
              : !remoteResetAvailable
                ? "Upgrade this server to Training Manager 0.1.12 or later, then run Test to enable remote reset."
                : `Clears datasets, uploads, jobs, job logs, and managed training outputs on ${activeTrainingServer.name}. Ollama models are preserved.`
          }
          title="Windows Training Manager database"
        />
        <SettingRow
          control={
            <Button
              disabled={!remoteResetAvailable}
              onClick={() => {
                setResetConfirmation("");
                setResetTarget("both");
              }}
              size="sm"
              variant="outline"
            >
              <Trash2 className="size-3.5" />
              Reset both
            </Button>
          }
          description="Resets the Windows server first, then the local Tome database. If the server cannot be reached, local data is not removed."
          title="Both databases"
        />
      </SettingsPanel>

      {resetTarget === null ? null : (
        <Modal
          onClose={closeReset}
          title={
            resetTarget === "local"
              ? "Reset local Tome database?"
              : resetTarget === "server"
                ? "Reset Training Manager database?"
                : "Reset both databases?"
          }
          width="max-w-xl"
        >
          <div className="space-y-4 p-5">
            <div className="flex gap-3 rounded-lg border border-red-500/25 bg-red-500/8 p-4">
              <CircleAlert className="size-4 shrink-0 text-red-400" />
              <div>
                <p className="text-xs font-medium text-red-300">
                  This action cannot be undone.
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  Active uploads or training jobs will block the reset. Original source
                  datasets, project folders, and Ollama models are not deleted.
                </p>
              </div>
            </div>
            <label className="block text-[11px] font-medium">
              Type{" "}
              <span className="font-mono text-red-300">
                {databaseResetPhrases[resetTarget]}
              </span>{" "}
              to continue
              <input
                autoComplete="off"
                autoFocus
                className={`${inputClassName} mt-2 font-mono`}
                disabled={resetting}
                onChange={(event) => setResetConfirmation(event.target.value)}
                placeholder={databaseResetPhrases[resetTarget]}
                value={resetConfirmation}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button disabled={resetting} onClick={closeReset} variant="outline">
                Cancel
              </Button>
              <Button
                className="bg-red-600 text-white hover:bg-red-500"
                disabled={
                  resetting || resetConfirmation !== databaseResetPhrases[resetTarget]
                }
                onClick={() => void performReset()}
              >
                {resetting ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                {resetting ? "Resetting…" : "Permanently reset"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function LoggingSettings(): React.JSX.Element {
  const [level, setLevel] = useState("info");
  const settings = useQuery({
    enabled: isTauriRuntime(),
    queryFn: backend.getSettings,
    queryKey: ["settings"],
  });
  const logs = useQuery({
    enabled: isTauriRuntime(),
    queryFn: () => backend.listLogs(200),
    queryKey: ["logs"],
    refetchInterval: 2_000,
  });
  const queryClient = useQueryClient();

  useEffect(() => {
    const savedLevel = new Map(settings.data ?? []).get("logLevel");
    if (savedLevel !== undefined) setLevel(savedLevel);
  }, [settings.data]);

  return (
    <div className="space-y-4">
      <SettingsPanel
        description="Control persisted diagnostic verbosity."
        title="Logging"
      >
        <SettingRow
          control={
            <select
              className={selectClassName}
              onChange={(event) => {
                setLevel(event.target.value);
                persistSetting("logLevel", event.target.value);
              }}
              value={level}
            >
              <option value="error">Errors</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
          }
          description="Server requests, failures, streaming operations, and model downloads are recorded."
          title="Log level"
        />
      </SettingsPanel>
      <SettingsPanel description="Latest 200 local records." title="Recent logs">
        <div className="flex justify-end gap-2 p-4">
          <Button onClick={() => void logs.refetch()} size="sm" variant="outline">
            <RefreshCw className="size-3" />
            Refresh
          </Button>
          <Button
            onClick={() => {
              void backend
                .clearLogs()
                .then(() => queryClient.invalidateQueries({ queryKey: ["logs"] }))
                .catch((error: unknown) => toast.error(errorMessage(error)));
            }}
            size="sm"
            variant="outline"
          >
            <Trash2 className="size-3" />
            Clear
          </Button>
        </div>
        <div className="max-h-80 overflow-auto font-mono">
          {(logs.data ?? []).map((log) => (
            <div className="px-5 py-2 text-[9px]" key={log.id}>
              <span className="text-muted-foreground">{formatDate(log.createdAt)}</span>{" "}
              <span
                className={log.level === "error" ? "text-red-400" : "text-violet-400"}
              >
                [{log.category}]
              </span>{" "}
              {log.message}
              {log.details === null ? null : (
                <span className="block truncate text-muted-foreground">
                  {log.details}
                </span>
              )}
            </div>
          ))}
          {(logs.data?.length ?? 0) === 0 ? (
            <p className="p-5 text-xs text-muted-foreground">No logs recorded.</p>
          ) : null}
        </div>
      </SettingsPanel>
    </div>
  );
}

export function AboutSettings(): React.JSX.Element {
  return (
    <SettingsPanel description="Application and local data identity." title="About Tome">
      <div className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">{application.name}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              AI software engineering workspace
            </p>
          </div>
          <Badge>Version {application.version}</Badge>
        </div>
        <div className="rounded-lg border border-border bg-background/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
          <p className="flex items-center gap-2 text-foreground">
            <ShieldCheck className="size-3.5 text-emerald-400" />
            Local-first functional foundation
          </p>
          <p className="mt-1.5">
            Settings and application records are stored in SQLite. Ollama reasoning
            remains on the selected remote or local server.
          </p>
        </div>
        <p className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <Server className="size-3" /> Identifier: {application.identifier}
        </p>
      </div>
    </SettingsPanel>
  );
}
