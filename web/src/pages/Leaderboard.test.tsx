import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/context/AuthContext";
import { fetchLeaderboard, syncLeaderboardResults } from "@/lib/leaderboard";
import Leaderboard from "./Leaderboard";

vi.mock("@/context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/components/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/lib/leaderboard", () => ({
   fetchLeaderboard: vi.fn(),
   syncLeaderboardResults: vi.fn(),
}));
const empty = { monthly: [], all_time: [] };
beforeEach(() => {
   vi.mocked(useAuth).mockReturnValue({
      user: { id: "alice", name: "Alice" },
   } as ReturnType<typeof useAuth>);
   vi.mocked(syncLeaderboardResults).mockReset().mockResolvedValue(undefined);
   vi.mocked(fetchLeaderboard).mockReset().mockResolvedValue(empty);
});
function page() {
   return render(
      <HelmetProvider>
         <MemoryRouter initialEntries={["/leaderboard"]}>
            <Leaderboard />
         </MemoryRouter>
      </HelmetProvider>
   );
}
describe("Populated leaderboards", () => {
   it("shows all-time achievement totals in their own tab", async () => {
      const user = userEvent.setup();
      page();
      await screen.findAllByRole("table");
      vi.mocked(fetchLeaderboard).mockResolvedValue({
         monthly: [],
         all_time: [
            {
               rank: 1,
               username: "Collector",
               profile_icon: "cat",
               achievement_count: 23,
            },
            { rank: 2, username: "Newcomer", achievement_count: 1 },
         ],
      });
      await user.click(screen.getByRole("button", { name: "achievements" }));
      await screen.findByRole("table", {
         name: "All-Time achievements leaderboard",
      });
      expect(screen.getAllByRole("table")).toHaveLength(1);
      expect(screen.getByText("23 achievements")).toBeInTheDocument();
      expect(screen.getByText("1 achievement")).toBeInTheDocument();
      expect(screen.queryByText("Monthly")).not.toBeInTheDocument();
      expect(fetchLeaderboard).toHaveBeenLastCalledWith(
         "achievements",
         expect.any(AbortSignal)
      );
      await user.click(
         screen.getByRole("button", { name: "medium", exact: true })
      );
      await waitFor(() =>
         expect(fetchLeaderboard).toHaveBeenLastCalledWith(
            "medium",
            expect.any(AbortSignal)
         )
      );
   });
   it("synchronizes only the signed-in account before displaying shared results", async () => {
      vi.mocked(fetchLeaderboard).mockResolvedValue({
         monthly: [
            { rank: 1, username: "Bob", profile_icon: "cat", games_won: 3 },
         ],
         all_time: [{ rank: 1, username: "Alice", games_won: 12 }],
      });
      page();
      const monthly = await screen.findByRole("table", {
         name: "Monthly easy winners",
      });
      expect(syncLeaderboardResults).toHaveBeenCalledWith("alice");
      expect(
         within(monthly).getByRole("cell", { name: "Bob" })
      ).toBeInTheDocument();
      expect(
         within(
            screen.getByRole("table", { name: "All-Time easy winners" })
         ).getByRole("cell", { name: "12 wins" })
      ).toBeInTheDocument();
   });
   it("lets guests read rankings without synchronizing any browser data", async () => {
      vi.mocked(useAuth).mockReturnValue({ user: null } as ReturnType<
         typeof useAuth
      >);
      page();
      await screen.findAllByRole("table");
      expect(syncLeaderboardResults).not.toHaveBeenCalled();
   });
   it("loads each bot difficulty independently", async () => {
      const user = userEvent.setup();
      page();
      await screen.findAllByRole("table");
      await user.click(
         screen.getByRole("button", { name: "medium", exact: true })
      );
      await screen.findByRole("table", { name: "Monthly medium winners" });
      await user.click(
         screen.getByRole("button", { name: "hard", exact: true })
      );
      await user.click(
         screen.getByRole("button", { name: "hardest", exact: true })
      );
      await screen.findByRole("table", { name: "Monthly hardest winners" });
      expect(fetchLeaderboard).toHaveBeenLastCalledWith(
         "hardest",
         expect.any(AbortSignal)
      );
   });
   it("shows failures instead of an empty winners table and allows retry", async () => {
      vi.mocked(fetchLeaderboard).mockRejectedValueOnce(
         new Error("Unable to load the leaderboard.")
      );
      const user = userEvent.setup();
      page();
      expect(await screen.findByRole("alert")).toHaveTextContent(
         "Unable to load"
      );
      expect(screen.queryByText("No winners yet")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Try Again" }));
      await waitFor(() => expect(screen.getAllByRole("table")).toHaveLength(2));
   });
   it("does not replace the active difficulty with a slower previous response", async () => {
      let resolveEasy!: (data: typeof empty) => void;
      vi.mocked(fetchLeaderboard).mockImplementation((category) =>
         category === "easy"
            ? new Promise((resolve) => {
                 resolveEasy = resolve;
              })
            : Promise.resolve({
                 monthly: [
                    { rank: 1, username: "Medium Winner", games_won: 1 },
                 ],
                 all_time: [],
              })
      );
      const user = userEvent.setup();
      page();
      await waitFor(() =>
         expect(fetchLeaderboard).toHaveBeenCalledWith(
            "easy",
            expect.any(AbortSignal)
         )
      );
      await user.click(
         screen.getByRole("button", { name: "medium", exact: true })
      );
      await screen.findByRole("cell", { name: "Medium Winner" });
      await act(async () => resolveEasy(empty));
      expect(
         screen.getByRole("table", { name: "Monthly medium winners" })
      ).toHaveTextContent("Medium Winner");
   });
});
