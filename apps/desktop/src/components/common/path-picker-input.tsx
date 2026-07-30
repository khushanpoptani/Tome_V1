import { inputClassName } from "@/components/common/page";
import { isTauriRuntime } from "@/lib/backend";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@tome/ui";
import { FileUp, FolderOpen } from "lucide-react";
import { toast } from "sonner";

type PathPickerKind = "directory" | "file" | "file-or-directory";

interface PathPickerInputProps {
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly kind: PathPickerKind;
  readonly onChange: (path: string) => void;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly value: string;
}

async function choosePath(directory: boolean): Promise<string | null> {
  if (!isTauriRuntime()) {
    toast.error("The native file browser is available in the Tome desktop app.");
    return null;
  }
  const selection = await open({
    directory,
    multiple: false,
    title: directory ? "Choose a folder" : "Choose a file",
  });
  return typeof selection === "string" ? selection : null;
}

export function PathPickerInput({
  ariaLabel,
  disabled = false,
  kind,
  onChange,
  placeholder,
  required = false,
  value,
}: PathPickerInputProps): React.JSX.Element {
  const browse = (directory: boolean): void => {
    void choosePath(directory)
      .then((selection) => {
        if (selection !== null) onChange(selection);
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "Could not open the file browser.",
        );
      });
  };

  return (
    <div className="flex min-w-0 gap-2">
      <input
        aria-label={ariaLabel}
        className={`${inputClassName} min-w-0 flex-1 font-mono`}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        value={value}
      />
      {kind === "directory" || kind === "file-or-directory" ? (
        <Button
          aria-label="Browse folders"
          disabled={disabled}
          onClick={() => browse(true)}
          size={kind === "file-or-directory" ? "sm" : "icon"}
          title="Browse folders"
          type="button"
          variant="outline"
        >
          <FolderOpen className="size-3.5" />
          {kind === "file-or-directory" ? "Folder" : null}
        </Button>
      ) : null}
      {kind === "file" || kind === "file-or-directory" ? (
        <Button
          aria-label="Browse files"
          disabled={disabled}
          onClick={() => browse(false)}
          size={kind === "file-or-directory" ? "sm" : "icon"}
          title="Browse files"
          type="button"
          variant="outline"
        >
          <FileUp className="size-3.5" />
          {kind === "file-or-directory" ? "File" : null}
        </Button>
      ) : null}
    </div>
  );
}
