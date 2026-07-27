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
    expect(screen.getByLabelText("Ask Tome")).toBeInTheDocument();

    const permissionSelector = screen.getByRole("combobox", {
      name: "Permission mode",
    });
    const statusBar = screen.getByRole("contentinfo");
    fireEvent.change(permissionSelector, { target: { value: "smart" } });
    expect(within(statusBar).getByText("Smart Approval")).toBeInTheDocument();
    fireEvent.change(permissionSelector, { target: { value: "ask" } });
  });

  it("renders a routed foundation placeholder", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Security" }));
    expect(screen.getByRole("heading", { name: "Execution mode" })).toBeInTheDocument();
  });
});
