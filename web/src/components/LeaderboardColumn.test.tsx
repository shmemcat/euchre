import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LeaderboardColumn } from "./LeaderboardColumn";

describe("Leaderboard entries", () => {
   it("shows ranked players, profile icons, and singular or plural wins", () => {
      render(
         <LeaderboardColumn
            title="Monthly"
            category="easy"
            entries={[
               {
                  rank: 1,
                  username: "Alice",
                  profile_icon: "cat",
                  games_won: 12,
               },
               {
                  rank: 2,
                  username: "Bob",
                  profile_icon: "sparkles",
                  games_won: 1,
               },
            ]}
         />
      );
      const table = screen.getByRole("table", { name: "Monthly easy winners" });
      expect(
         within(table).getByRole("cell", { name: "Alice" })
      ).toBeInTheDocument();
      expect(
         within(table).getByRole("cell", { name: "12 wins" })
      ).toBeInTheDocument();
      expect(
         within(table).getByRole("cell", { name: "1 win" })
      ).toBeInTheDocument();
      expect(table.querySelector('[data-icon="cat"]')).toBeInTheDocument();
      expect(screen.queryByText("No winners yet")).not.toBeInTheDocument();
   });
   it("keeps the empty state for categories without winners", () => {
      render(
         <LeaderboardColumn
            title="All-Time"
            category="multiplayer"
            entries={[]}
         />
      );
      expect(
         screen.getByRole("table", { name: "All-Time multiplayer winners" })
      ).toHaveTextContent("No winners yet");
   });
});
