import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { AchievementNotifications } from "./AchievementNotifications";
import { ACHIEVEMENT_EVENT, type AchievementResult } from "@/lib/achievements";

const state = vi.hoisted(() => ({
   user: { id: "alice" },
   results: [] as AchievementResult[],
}));
vi.mock("@/context/AuthContext", () => ({
   useAuth: () => ({ user: state.user }),
}));
vi.mock("@/context/GameContext", () => ({ useGame: () => ({ game: null }) }));
vi.mock("@/context/MultiplayerContext", () => ({
   useMultiplayer: () => ({ game: null }),
}));
vi.mock("@/lib/achievements", async (original) => ({
   ...(await original<typeof import("@/lib/achievements")>()),
   loadAchievements: async () => ({ results: state.results, unlocks: [] }),
   syncMusicAchievement: async () => {},
}));
const won: AchievementResult = {
   id: "new-win",
   difficulty: "easy",
   won: true,
   conceded: false,
   scores: [10, 5],
   finishedAt: "2026-10-25T12:00:00Z",
   marches: 0,
   loners: 0,
   euchres: 0,
};
beforeEach(() => {
   state.user = { id: "alice" };
   state.results = [];
});

it("announces new unlocks once and batches simultaneous achievements", async () => {
   const user = userEvent.setup();
   render(<AchievementNotifications />);
   await waitFor(() =>
      expect(localStorage.getItem("euchre.achievements-seen.v1:alice")).toBe(
         "[]"
      )
   );
   state.results = [won];
   act(() => window.dispatchEvent(new Event(ACHIEVEMENT_EVENT)));
   expect(await screen.findByRole("status")).toHaveTextContent(
      "Newcomer · First Light"
   );
   await user.click(
      screen.getByRole("button", { name: "Dismiss achievement notification" })
   );
   act(() => window.dispatchEvent(new Event(ACHIEVEMENT_EVENT)));
   await act(async () => {});
   expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("seeds historical unlocks quietly and hides notices after an account switch", async () => {
   state.results = [won];
   const view = render(<AchievementNotifications />);
   await waitFor(() =>
      expect(
         localStorage.getItem("euchre.achievements-seen.v1:alice")
      ).toContain("first_light")
   );
   expect(screen.queryByRole("status")).not.toBeInTheDocument();
   state.results = [
      ...state.results,
      { ...won, id: "shutout", scores: [10, 0] },
   ];
   act(() => window.dispatchEvent(new Event(ACHIEVEMENT_EVENT)));
   expect(await screen.findByRole("status")).toHaveTextContent("Skunk Works");
   state.user = { id: "bob" };
   state.results = [];
   view.rerender(<AchievementNotifications />);
   expect(screen.queryByRole("status")).not.toBeInTheDocument();
   await waitFor(() =>
      expect(localStorage.getItem("euchre.achievements-seen.v1:bob")).toBe("[]")
   );
});
