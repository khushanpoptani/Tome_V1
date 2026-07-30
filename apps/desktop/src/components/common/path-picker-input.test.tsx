import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PathPickerInput } from "./path-picker-input";

const { openDialog } = vi.hoisted(() => ({ openDialog: vi.fn() }));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openDialog,
}));

describe("PathPickerInput", () => {
  beforeEach(() => {
    openDialog.mockReset();
    window.__TAURI_INTERNALS__ = {};
  });

  it("selects a folder through the native directory dialog", async () => {
    openDialog.mockResolvedValue("/Users/kp/Projects/Tome");
    const onChange = vi.fn();
    render(
      <PathPickerInput
        ariaLabel="Project directory path"
        kind="directory"
        onChange={onChange}
        value=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Browse folders" }));

    await waitFor(() => {
      expect(openDialog).toHaveBeenCalledWith(
        expect.objectContaining({ directory: true, multiple: false }),
      );
      expect(onChange).toHaveBeenCalledWith("/Users/kp/Projects/Tome");
    });
  });

  it("offers independent file and folder choices for datasets", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.jsonl");
    const onChange = vi.fn();
    render(
      <PathPickerInput
        ariaLabel="Dataset path"
        kind="file-or-directory"
        onChange={onChange}
        value=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Browse files" }));

    await waitFor(() => {
      expect(openDialog).toHaveBeenCalledWith(
        expect.objectContaining({ directory: false }),
      );
      expect(onChange).toHaveBeenCalledWith("/tmp/data.jsonl");
    });
    expect(screen.getByRole("button", { name: "Browse folders" })).toBeEnabled();
  });
});
