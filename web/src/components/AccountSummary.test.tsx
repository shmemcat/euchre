import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AccountSummary } from "./AccountSummary";

afterEach(() => {
   vi.unstubAllGlobals();
   vi.unstubAllEnvs();
});
it("loads server multiplayer results and keeps them in the multiplayer category", async () => {
   vi.stubEnv("VITE_ACCOUNT_API_URL", "/api/account");
   const fetcher = vi
      .fn()
      .mockResolvedValue({
         ok: true,
         json: async () => ({
            results: [
               {
                  id: "online-1",
                  difficulty: "multiplayer",
                  won: true,
                  conceded: false,
                  scores: [10, 4],
                  finishedAt: "2026-10-21T12:00:00Z",
                  loners: 1,
                  marches: 0,
                  euchres: 0,
               },
            ],
         }),
      });
   vi.stubGlobal("fetch", fetcher);
   const user = userEvent.setup();
   render(<AccountSummary userId="alice" />);
   await screen.findByText("100%");
   await user.click(
      screen.getByRole("button", { name: "Separate", exact: true })
   );
   const stats = screen.getByLabelText("Your statistics");
   expect(within(stats).queryByText("100%")).not.toBeInTheDocument();
   await user.click(
      screen.getByRole("button", { name: "multiplayer", exact: true })
   );
   expect(within(stats).getByText("100%")).toBeInTheDocument();
   expect(fetcher).toHaveBeenCalledWith(
      "/api/account/euchre/multiplayer-results",
      expect.objectContaining({ credentials: "include", cache: "no-store" })
   );
});
