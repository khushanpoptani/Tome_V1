import { AppProviders } from "@/app/providers";
import { AppRoutes } from "@/app/routes";
import { BrowserRouter } from "react-router-dom";

export function App(): React.JSX.Element {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
