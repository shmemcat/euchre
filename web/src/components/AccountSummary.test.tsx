import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AccountSummary } from "./AccountSummary";
import type { AchievementResult } from "@/lib/achievements";

afterEach(() => {
   vi.unstubAllGlobals();
   vi.unstubAllEnvs();
});

it.each([
   "easy",
   "medium",
   "hard",
   "harder",
   "hardest",
   "multiplayer",
] as const)(
   "counts only finished %s games, including older local and server results",
   async (difficulty) => {
      vi.stubEnv("VITE_ACCOUNT_API_URL", "/api/account");
      const completed: AchievementResult = {
         id: "win",
         difficulty,
         won: true,
         conceded: false,
         scores: [10, 4],
         finishedAt: "2026-10-21T12:00:00Z",
         loners: 1,
         marches: 0,
         euchres: 0,
      };
      const abandoned = {
         ...completed,
         id: "abandoned",
         won: false,
         conceded: true,
         scores: [0, 1],
         loners: 20,
      };
      localStorage.setItem(
         "euchre.results.v2:alice",
         JSON.stringify([
            { ...abandoned, id: "local-concession", difficulty: "easy" },
         ])
      );
      vi.stubGlobal(
         "fetch",
         vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
               unlocks: [],
               results: [
                  completed,
                  {
                     ...completed,
                     id: "loss",
                     won: false,
                     scores: [4, 10],
                     loners: 0,
                  },
                  abandoned,
               ],
            }),
         })
      );
      const user = userEvent.setup();
      render(<AccountSummary userId="alice" />);
      await screen.findByText("50%");
      const value = (label: string) =>
         within(screen.getByLabelText("Your statistics"))
            .getByText(label)
            .parentElement!.querySelector("dd")!.textContent;
      const check = () => {
         expect(value("Games Played")).toBe("2");
         expect(value("Games Won")).toBe("1");
         expect(value("Win Rate")).toBe("50%");
         expect(value("Lone Sweeps")).toBe("1");
         expect(value("Best Score")).toBe("10");
         expect(value("Worst Score")).toBe("4");
         expect(value("Avg Score")).toBe("7.0");
      };
      check();
      await user.click(
         screen.getByRole("button", { name: "Separate", exact: true })
      );
      const hard = ["hard", "harder", "hardest"].includes(difficulty);
      await user.click(
         screen.getByRole("button", {
            name: hard ? "hard" : difficulty,
            exact: true,
         })
      );
      if (hard)
         await user.click(
            within(
               screen.getByRole("group", { name: "Hard difficulty" })
            ).getByRole("button", { name: difficulty, exact: true })
         );
      check();
   }
);

it("shows no games or scores when every saved result was conceded", async () => {
   vi.stubEnv("VITE_ACCOUNT_API_URL", "/api/account");
   vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
         ok: true,
         json: async () => ({
            unlocks: [],
            results: [
               {
                  id: "old-concession",
                  difficulty: "multiplayer",
                  won: false,
                  conceded: true,
                  scores: [3, 8],
                  finishedAt: "2026-10-21T12:00:00Z",
                  loners: 0,
                  marches: 0,
                  euchres: 0,
               },
            ],
         }),
      })
   );
   render(<AccountSummary userId="alice" />);
   await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
   );
   const stats = within(screen.getByLabelText("Your statistics"));
   expect(stats.getByText("Games Played").parentElement).toHaveTextContent(
      "Games Played0"
   );
   expect(stats.getByText("Win Rate").parentElement).toHaveTextContent(
      "Win Rate—"
   );
   expect(stats.getByText("Best Score").parentElement).toHaveTextContent(
      "Best Score—"
   );
});
it("loads server multiplayer results and keeps them in the multiplayer category", async () => {
   vi.stubEnv("VITE_ACCOUNT_API_URL", "/api/account");
   const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
         unlocks: [],
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
      "/api/euchre/achievements",
      expect.objectContaining({ credentials: "include", cache: "no-store" })
   );
});
