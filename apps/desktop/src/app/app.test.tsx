import { AppProviders } from "@/app/providers";
import { AppRoutes } from "@/app/routes";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

describe("Tome application shell", () => {
  it("renders the dashboard and primary navigation", () => {
    render(
      <AppProviders>
        <MemoryRouter>
          <AppRoutes />
        </MemoryRouter>
      </AppProviders>,
    );

    expect(screen.getByRole("heading", { name: "Welcome to Tome" })).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Ask Tome")).not.toBeInTheDocument();
    const collapseSidebar = screen.getByRole("button", { name: "Collapse sidebar" });
    fireEvent.click(collapseSidebar);
    const expandSidebar = screen.getByRole("button", { name: "Expand sidebar" });
    expect(expandSidebar).toBeInTheDocument();
    fireEvent.click(expandSidebar);
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
  });

  it("renders the prompt composer only on the chat route", async () => {
    render(
      <AppProviders>
        <MemoryRouter initialEntries={["/chat"]}>
          <AppRoutes />
        </MemoryRouter>
      </AppProviders>,
    );

    expect(await screen.findByLabelText("Ask Tome")).toBeInTheDocument();
    const permissionSelector = screen.getByRole("combobox", {
      name: "Permission mode",
    });
    const statusBar = screen.getByRole("contentinfo");
    fireEvent.change(permissionSelector, { target: { value: "smart" } });
    expect(within(statusBar).getByText("Smart Approval")).toBeInTheDocument();
    fireEvent.change(permissionSelector, { target: { value: "ask" } });
  });

  it("renders the functional settings route", () => {
    render(
      <AppProviders>
        <MemoryRouter initialEntries={["/settings"]}>
          <AppRoutes />
        </MemoryRouter>
      </AppProviders>,
    );

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Settings sections" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Ask Tome")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    fireEvent.click(screen.getByRole("button", { name: /Light/ }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    fireEvent.click(screen.getByRole("button", { name: /System/ }));

    fireEvent.click(screen.getByRole("button", { name: "Security" }));
    expect(screen.getByRole("heading", { name: "Execution mode" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Database reset" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset local" }));
    const resetDialog = screen.getByRole("dialog");
    const resetButton = within(resetDialog).getByRole("button", {
      name: "Permanently reset",
    });
    expect(resetButton).toBeDisabled();
    fireEvent.change(
      within(resetDialog).getByLabelText(/Type RESET LOCAL DATABASE to continue/),
      { target: { value: "RESET LOCAL DATABASE" } },
    );
    expect(resetButton).toBeEnabled();
    fireEvent.click(within(resetDialog).getByRole("button", { name: "Cancel" }));
  });

  it("renders the separated training management workspace", async () => {
    render(
      <AppProviders>
        <MemoryRouter initialEntries={["/training"]}>
          <AppRoutes />
        </MemoryRouter>
      </AppProviders>,
    );

    expect(await screen.findByRole("heading", { name: "Training" })).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Training sections" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Training Manager servers")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Datasets" }));
    expect(screen.getByRole("heading", { name: "Datasets" })).toBeInTheDocument();
    expect(screen.getByText("Drag datasets here")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Organize related data into groups, validate locally, then upload a complete group in resumable chunks.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Ask Tome")).not.toBeInTheDocument();
  });
});
