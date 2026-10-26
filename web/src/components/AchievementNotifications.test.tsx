import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { AchievementNotifications } from "./AchievementNotifications";
import { ACHIEVEMENT_EVENT, type AchievementResult } from "@/lib/achievements";

const state = vi.hoisted(() => ({
   user: { id: "alice" },
   results: [] as AchievementResult[],
   unlocks: [] as string[],
   game: null as { id: string; phase: string } | null,
   multiplayer: null as { id: string; phase: string } | null,
}));
vi.mock("@/context/AuthContext", () => ({
   useAuth: () => ({ user: state.user }),
}));
vi.mock("@/context/GameContext", () => ({
   useGame: () => ({ game: state.game }),
}));
vi.mock("@/context/MultiplayerContext", () => ({
   useMultiplayer: () => ({ game: state.multiplayer }),
}));
vi.mock("@/lib/achievements", async (original) => ({
   ...(await original<typeof import("@/lib/achievements")>()),
   loadAchievements: async () => ({
      results: state.results,
      unlocks: state.unlocks,
   }),
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
   state.unlocks = [];
   state.game = null;
   state.multiplayer = null;
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
   const notice = await screen.findByRole("status");
   expect(within(notice).getByText("Newcomer")).toBeVisible();
   expect(within(notice).getByText("First Light")).toBeVisible();
   expect(within(notice).getAllByText("Achievement Unlocked!")).toHaveLength(2);
   expect(notice.querySelectorAll("svg")).toHaveLength(2);
   await user.click(
      screen.getByRole("button", {
         name: "Dismiss Newcomer achievement notification",
      })
   );
   expect(screen.getByText("First Light")).toBeVisible();
   await user.click(
      screen.getByRole("button", {
         name: "Dismiss First Light achievement notification",
      })
   );
   act(() => window.dispatchEvent(new Event(ACHIEVEMENT_EVENT)));
   await act(async () => {});
   expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("limits the stack to three toasts and reveals queued achievements as others are dismissed", async () => {
   const user = userEvent.setup();
   render(<AchievementNotifications />);
   await waitFor(() =>
      expect(localStorage.getItem("euchre.achievements-seen.v1:alice")).toBe(
         "[]"
      )
   );
   state.unlocks = ["geezer", "night_owl", "early_bird", "spooky", "new_year"];
   act(() => window.dispatchEvent(new Event(ACHIEVEMENT_EVENT)));
   const notice = await screen.findByRole("status");
   expect(within(notice).getAllByText("Achievement Unlocked!")).toHaveLength(3);
   expect(notice).toHaveTextContent("+2 more");
   await user.click(within(notice).getAllByRole("button")[0]);
   expect(within(notice).getAllByText("Achievement Unlocked!")).toHaveLength(3);
   expect(notice).toHaveTextContent("+1 more");
   expect(
      JSON.parse(localStorage.getItem("euchre.achievements-seen.v1:alice")!)
   ).toEqual(expect.arrayContaining(state.unlocks));
});

it("keeps an active toast when another achievement arrives", async () => {
   render(<AchievementNotifications />);
   await waitFor(() =>
      expect(localStorage.getItem("euchre.achievements-seen.v1:alice")).toBe(
         "[]"
      )
   );
   state.unlocks = ["geezer"];
   act(() => window.dispatchEvent(new Event(ACHIEVEMENT_EVENT)));
   expect(await screen.findByRole("status")).toHaveTextContent("Geezer");
   state.results = [won];
   act(() => window.dispatchEvent(new Event(ACHIEVEMENT_EVENT)));
   await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("First Light")
   );
   expect(screen.getByRole("status")).toHaveTextContent("Geezer");
   expect(screen.getAllByText("Achievement Unlocked!")).toHaveLength(3);
});

it("shows a tier upgrade with its badge icon and tier color once", async () => {
   const results = (count: number): AchievementResult[] =>
      Array.from({ length: count }, (_, index) => ({
         ...won,
         id: `loss-${index}`,
         won: false,
         scores: [5, 10],
      }));
   state.results = results(25);
   const view = render(<AchievementNotifications />);
   await waitFor(() =>
      expect(
         localStorage.getItem("euchre.achievements-seen.v1:alice")
      ).toContain("regular_bronze")
   );
   state.results = results(100);
   act(() => window.dispatchEvent(new Event(ACHIEVEMENT_EVENT)));
   const notice = await screen.findByRole("status");
   expect(notice).toHaveTextContent("Devoted");
   expect(notice.querySelector('svg[data-tier="silver"]')).toBeInTheDocument();
   view.unmount();
   render(<AchievementNotifications />);
   await act(async () => {});
   expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it.each(["game", "multiplayer"] as const)(
   "announces achievements when the %s finishes",
   async (mode) => {
      state[mode] = { id: "finished-game", phase: "playing" };
      const view = render(<AchievementNotifications />);
      await waitFor(() =>
         expect(localStorage.getItem("euchre.achievements-seen.v1:alice")).toBe(
            "[]"
         )
      );
      state.results = [won];
      state[mode] = { id: "finished-game", phase: "game_over" };
      view.rerender(<AchievementNotifications />);
      expect(await screen.findByRole("status")).toHaveTextContent("Newcomer");
   }
);

it("automatically dismisses the stack after three seconds", async () => {
   render(<AchievementNotifications />);
   await waitFor(() =>
      expect(localStorage.getItem("euchre.achievements-seen.v1:alice")).toBe(
         "[]"
      )
   );
   vi.useFakeTimers();
   try {
      state.unlocks = ["geezer"];
      await act(async () => window.dispatchEvent(new Event(ACHIEVEMENT_EVENT)));
      expect(screen.getByRole("status")).toHaveTextContent("Geezer");
      act(() => vi.advanceTimersByTime(2999));
      expect(screen.getByRole("status")).toHaveTextContent("Geezer");
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
   } finally {
      vi.useRealTimers();
   }
});

it("automatically shows every queued achievement before its own timeout", async () => {
   render(<AchievementNotifications />);
   await waitFor(() =>
      expect(localStorage.getItem("euchre.achievements-seen.v1:alice")).toBe(
         "[]"
      )
   );
   vi.useFakeTimers();
   try {
      state.unlocks = [
         "geezer",
         "night_owl",
         "early_bird",
         "spooky",
         "new_year",
      ];
      await act(async () => window.dispatchEvent(new Event(ACHIEVEMENT_EVENT)));
      const firstBatch = screen
         .getAllByRole("button")
         .map((button) => button.getAttribute("aria-label"));
      expect(firstBatch).toHaveLength(3);
      act(() => vi.advanceTimersByTime(3000));
      const secondBatch = screen
         .getAllByRole("button")
         .map((button) => button.getAttribute("aria-label"));
      expect(secondBatch).toHaveLength(2);
      expect(secondBatch.every((label) => !firstBatch.includes(label))).toBe(
         true
      );
      act(() => vi.advanceTimersByTime(2999));
      expect(screen.getAllByText("Achievement Unlocked!")).toHaveLength(2);
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
   } finally {
      vi.useRealTimers();
   }
});

it("announces new achievements once even when browser storage is blocked", async () => {
   vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
   });
   vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
   });
   render(<AchievementNotifications />);
   await act(async () => {});
   state.unlocks = ["geezer"];
   await act(async () => window.dispatchEvent(new Event(ACHIEVEMENT_EVENT)));
   expect(screen.getByRole("status")).toHaveTextContent("Geezer");
   const user = userEvent.setup();
   await user.click(
      screen.getByRole("button", {
         name: "Dismiss Geezer achievement notification",
      })
   );
   await act(async () => window.dispatchEvent(new Event(ACHIEVEMENT_EVENT)));
   expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("does not resurrect a dismissed account's stack when switching back", async () => {
   const view = render(<AchievementNotifications />);
   await waitFor(() =>
      expect(localStorage.getItem("euchre.achievements-seen.v1:alice")).toBe(
         "[]"
      )
   );
   state.unlocks = ["geezer"];
   await act(async () => window.dispatchEvent(new Event(ACHIEVEMENT_EVENT)));
   expect(screen.getByRole("status")).toHaveTextContent("Geezer");
   state.user = { id: "bob" };
   state.unlocks = [];
   view.rerender(<AchievementNotifications />);
   await act(async () => {});
   state.user = { id: "alice" };
   state.unlocks = ["geezer"];
   view.rerender(<AchievementNotifications />);
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
