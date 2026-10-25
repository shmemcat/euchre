import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMultiplayer, type Lobby } from "@/context/MultiplayerContext";
import { useAuth } from "@/context/AuthContext";
import LobbyPage from "./LobbyPage";

vi.mock("@/context/MultiplayerContext", () => ({ useMultiplayer: vi.fn() }));
vi.mock("@/context/AuthContext", () => ({
   useAuth: vi.fn(),
}));
vi.mock("@/context/PreferencesContext", () => ({
   usePreferences: () => ({ preferences: { hardLevel: "hardest" } }),
}));
vi.mock("@/components/Navbar", () => ({ Navbar: () => null }));
const command = vi.fn();
let lobby: Lobby;
function mobileViewport() {
   vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
         matches: true,
         addEventListener: vi.fn(),
         removeEventListener: vi.fn(),
      }))
   );
}
afterEach(() => vi.unstubAllGlobals());
function page() {
   return (
      <HelmetProvider>
         <MemoryRouter initialEntries={["/game/lobby/ABC234"]}>
            <Routes>
               <Route path="/game/lobby/:code" element={<LobbyPage />} />
               <Route path="/play" element={<p>Choose a game</p>} />
               <Route
                  path="/game/multi-play/:code"
                  element={<p>Playing with your group</p>}
               />
            </Routes>
         </MemoryRouter>
      </HelmetProvider>
   );
}
beforeEach(() => {
   vi.mocked(useAuth).mockReturnValue({
      user: { id: "alice", name: "Alice" },
   } as ReturnType<typeof useAuth>);
   command.mockReset().mockResolvedValue({ ok: true });
   lobby = {
      code: "ABC234",
      status: "waiting",
      seat: 0,
      isMember: true,
      memberName: "Alice",
      needsName: false,
      unseated: [],
      isHost: true,
      gameId: null,
      difficulty: "easy",
      revision: 1,
      seats: [0, 1, 2, 3].map((index) => ({
         index,
         status: index === 0 ? "human" : "empty",
         name: index === 0 ? "Alice" : "Waiting…",
         icon: "user",
         mine: index === 0,
         host: index === 0,
         connected: true,
      })),
      teams: [
         { name: "Team 1", named: false, canName: true },
         { name: "Star Foxes", named: true, canName: false },
      ],
   };
   vi.mocked(useMultiplayer).mockImplementation(() => ({
      lobby,
      game: null,
      connected: true,
      error: "",
      resumeCode: "ABC234",
      command,
   }));
});

it("lets the first teammate save a name and shows saved names to everyone", async () => {
   const user = userEvent.setup();
   const view = render(page());
   await user.type(screen.getByLabelText("Team 1 name"), "Moon Cats");
   await user.click(screen.getByRole("button", { name: "Save" }));
   expect(command).toHaveBeenCalledWith({
      type: "name",
      code: "ABC234",
      name: "Moon Cats",
   });
   lobby = {
      ...lobby,
      teams: [
         { name: "Moon Cats", named: true, canName: false },
         lobby.teams[1],
      ],
   };
   view.rerender(page());
   expect(
      within(
         screen.getByRole("region", { name: "Team 1", exact: true })
      ).getByText("Moon Cats")
   ).toBeVisible();
   expect(screen.queryByLabelText("Team 1 name")).not.toBeInTheDocument();
   expect(
      screen.queryByRole("button", { name: "Edit team name" })
   ).not.toBeInTheDocument();
});

it("reports a simultaneous seat claim and clears the warning when the lobby updates", async () => {
   command.mockRejectedValueOnce(
      new Error("That seat has already been taken.")
   );
   const user = userEvent.setup();
   const view = render(page());
   await user.click(screen.getAllByRole("button", { name: "Select Seat" })[1]);
   expect(command).toHaveBeenCalledWith({
      type: "join",
      code: "ABC234",
      seat: 2,
      name: "Alice",
   });
   expect(await screen.findByRole("alert")).toHaveTextContent(
      "already been taken"
   );
   lobby = {
      ...lobby,
      revision: lobby.revision + 1,
      seats: lobby.seats.map((seat) =>
         seat.index === 2 ? { ...seat, status: "human", name: "Bob" } : seat
      ),
   };
   view.rerender(page());
   expect(screen.getByText("Bob")).toBeVisible();
   expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("closes the team name editor when saving the existing name", async () => {
   lobby = {
      ...lobby,
      teams: [
         { name: "Moon Cats", named: true, canName: true },
         lobby.teams[1],
      ],
   };
   const user = userEvent.setup();
   render(page());
   await user.click(screen.getByRole("button", { name: "Edit team name" }));
   await user.click(screen.getByRole("button", { name: "Save", exact: true }));
   await waitFor(() =>
      expect(screen.queryByLabelText("Team 1 name")).not.toBeInTheDocument()
   );
   expect(command).toHaveBeenCalledWith({
      type: "name",
      code: "ABC234",
      name: "Moon Cats",
   });
   expect(screen.getByRole("button", { name: "Edit team name" })).toBeVisible();
});

it("keeps the edited name after a failed save and closes after retrying", async () => {
   lobby = {
      ...lobby,
      teams: [
         { name: "Moon Cats", named: true, canName: true },
         lobby.teams[1],
      ],
   };
   command.mockRejectedValueOnce(
      new Error("The table could not save that change.")
   );
   const user = userEvent.setup();
   render(page());
   await user.click(screen.getByRole("button", { name: "Edit team name" }));
   await user.clear(screen.getByLabelText("Team 1 name"));
   await user.type(screen.getByLabelText("Team 1 name"), "Sun Cats");
   await user.click(screen.getByRole("button", { name: "Save", exact: true }));
   expect(await screen.findByRole("alert")).toHaveTextContent("could not save");
   expect(screen.getByLabelText("Team 1 name")).toHaveValue("Sun Cats");
   await user.click(screen.getByRole("button", { name: "Save", exact: true }));
   await waitFor(() =>
      expect(screen.queryByLabelText("Team 1 name")).not.toBeInTheDocument()
   );
   expect(command).toHaveBeenCalledTimes(2);
});

it("opens the mobile name popup only when requested and saves with Enter", async () => {
   mobileViewport();
   const user = userEvent.setup();
   render(page());
   const trigger = screen.getByRole("button", { name: "Edit Team 1 name" });
   expect(screen.queryByLabelText("Team 1 name")).not.toBeInTheDocument();
   expect(
      within(screen.getByRole("region", { name: "Team 2" })).getByRole("button")
   ).toBeDisabled();

   await user.click(trigger);
   const dialog = screen.getByRole("dialog", { name: "Team 1 Name" });
   const input = within(dialog).getByLabelText("Team 1 name");
   expect(dialog).toContainElement(document.activeElement as HTMLElement);
   expect(
      within(dialog).getByRole("button", { name: "Save Team Name" })
   ).toBeDisabled();
   await user.type(input, "Moon Cats{Enter}");
   await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
   );
   expect(command).toHaveBeenCalledExactlyOnceWith({
      type: "name",
      code: "ABC234",
      name: "Moon Cats",
   });
   expect(trigger).toHaveFocus();
});

it("discards a mobile name draft on Cancel or Escape without saving", async () => {
   mobileViewport();
   lobby.teams[0] = { name: "Moon Cats", named: true, canName: true };
   const user = userEvent.setup();
   render(page());
   const trigger = screen.getByRole("button", { name: "Edit Team 1 name" });
   await user.click(trigger);
   await user.clear(screen.getByLabelText("Team 1 name"));
   await user.type(screen.getByLabelText("Team 1 name"), "Sun Cats");
   await user.click(screen.getByRole("button", { name: "Cancel" }));
   expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
   expect(trigger).toHaveFocus();
   await user.click(trigger);
   expect(screen.getByLabelText("Team 1 name")).toHaveValue("Moon Cats");
   await user.keyboard("{Escape}");
   expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
   expect(trigger).toHaveFocus();
   expect(command).not.toHaveBeenCalled();
});

it("keeps a failed mobile name draft and shows the error inside the popup", async () => {
   mobileViewport();
   command.mockRejectedValueOnce(
      new Error("The team name could not be saved.")
   );
   const user = userEvent.setup();
   render(page());
   await user.click(screen.getByRole("button", { name: "Edit Team 1 name" }));
   const dialog = screen.getByRole("dialog");
   await user.type(within(dialog).getByLabelText("Team 1 name"), "Moon Cats");
   await user.click(
      within(dialog).getByRole("button", { name: "Save Team Name" })
   );
   expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "could not be saved"
   );
   expect(within(dialog).getByLabelText("Team 1 name")).toHaveValue(
      "Moon Cats"
   );
   await user.click(
      within(dialog).getByRole("button", { name: "Save Team Name" })
   );
   await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
   );
   expect(command).toHaveBeenCalledTimes(2);
});

it("closes the mobile popup if another teammate takes naming rights", async () => {
   mobileViewport();
   const user = userEvent.setup();
   const view = render(page());
   await user.click(screen.getByRole("button", { name: "Edit Team 1 name" }));
   await user.type(screen.getByLabelText("Team 1 name"), "Moon Cats");
   lobby = {
      ...lobby,
      revision: lobby.revision + 1,
      teams: [
         { name: "Star Cats", named: true, canName: false },
         lobby.teams[1],
      ],
   };
   view.rerender(page());
   expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
   expect(
      within(screen.getByRole("region", { name: "Team 1" })).getByRole("button")
   ).toBeDisabled();
   expect(command).not.toHaveBeenCalled();
});

it.each([false, true])(
   "asks the host for bot difficulty before starting (mobile=%s)",
   async (mobile) => {
      if (mobile) mobileViewport();
      const user = userEvent.setup();
      render(page());
      await user.click(screen.getByRole("button", { name: "Start Game" }));
      expect(command).not.toHaveBeenCalled();
      const dialog = screen.getByRole("dialog");
      expect(
         within(dialog).getByRole("radio", { name: "easy", exact: true })
      ).toBeChecked();
      if (mobile) {
         expect(dialog).not.toHaveTextContent("filled with bots");
         expect(within(dialog).getByText("Bot difficulty")).toBeVisible();
      } else
         expect(dialog).toHaveTextContent("3 seats will be filled with bots");
      await user.click(
         within(dialog).getByRole("radio", { name: "hardest", exact: true })
      );
      await user.click(within(dialog).getByRole("button", { name: "Start!" }));
      expect(command).toHaveBeenCalledWith({
         type: "start",
         code: "ABC234",
         difficulty: "hardest",
      });
   }
);

it("offers regular Hard to guests rather than a previous account's Hard preference", async () => {
   vi.mocked(useAuth).mockReturnValue({ user: null } as ReturnType<
      typeof useAuth
   >);
   const user = userEvent.setup();
   render(page());
   await user.click(screen.getByRole("button", { name: "Start Game" }));
   await user.click(screen.getByRole("radio", { name: "hard", exact: true }));
   await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
         name: "Start!",
      })
   );
   expect(command).toHaveBeenCalledWith({
      type: "start",
      code: "ABC234",
      difficulty: "hard",
   });
});

it.each(["hard", "harder", "hardest"] as const)(
   "offers the creator's %s choice when another player becomes host",
   async (defaultDifficulty) => {
      vi.mocked(useAuth).mockReturnValue({ user: null } as ReturnType<
         typeof useAuth
      >);
      lobby = { ...lobby, defaultDifficulty };
      const user = userEvent.setup();
      render(page());
      await user.click(screen.getByRole("button", { name: "Start Game" }));
      await user.click(
         screen.getByRole("radio", { name: defaultDifficulty, exact: true })
      );
      await user.click(
         within(screen.getByRole("dialog")).getByRole("button", {
            name: "Start!",
         })
      );
      expect(command).toHaveBeenCalledWith({
         type: "start",
         code: "ABC234",
         difficulty: defaultDifficulty,
      });
   }
);

it("uses the creator's Hard version for replacement bots when all starting seats are human", async () => {
   lobby = {
      ...lobby,
      defaultDifficulty: "harder",
      seats: lobby.seats.map((seat, i) => ({
         ...seat,
         status: "human",
         name: `Player ${i}`,
      })),
   };
   const user = userEvent.setup();
   render(page());
   await user.click(screen.getByRole("button", { name: "Start Game" }));
   expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
   expect(command).toHaveBeenCalledWith({
      type: "start",
      code: "ABC234",
      difficulty: "harder",
   });
});

it("still lets the host explicitly choose a lower difficulty", async () => {
   lobby = { ...lobby, defaultDifficulty: "hardest" };
   const user = userEvent.setup();
   render(page());
   await user.click(screen.getByRole("button", { name: "Start Game" }));
   const dialog = screen.getByRole("dialog");
   await user.click(
      within(dialog).getByRole("radio", { name: "medium", exact: true })
   );
   await user.click(within(dialog).getByRole("button", { name: "Start!" }));
   expect(command).toHaveBeenCalledWith({
      type: "start",
      code: "ABC234",
      difficulty: "medium",
   });
});

it("uses Easy when the popup is accepted without changing the selected option", async () => {
   lobby = { ...lobby, defaultDifficulty: "hardest" };
   const user = userEvent.setup();
   render(page());
   await user.click(screen.getByRole("button", { name: "Start Game" }));
   const dialog = screen.getByRole("dialog");
   expect(
      within(dialog).getByRole("radio", { name: "easy", exact: true })
   ).toBeChecked();
   await user.click(within(dialog).getByRole("button", { name: "Start!" }));
   expect(command).toHaveBeenCalledWith({
      type: "start",
      code: "ABC234",
      difficulty: "easy",
   });
});

it("cancels without starting and resets the popup selection when reopened", async () => {
   const user = userEvent.setup();
   render(page());
   await user.click(screen.getByRole("button", { name: "Start Game" }));
   await user.click(
      screen.getByRole("radio", { name: "hardest", exact: true })
   );
   await user.click(
      screen.getByRole("button", { name: "Cancel", exact: true })
   );
   expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
   expect(command).not.toHaveBeenCalled();
   await user.click(screen.getByRole("button", { name: "Start Game" }));
   expect(
      screen.getByRole("radio", { name: "easy", exact: true })
   ).toBeChecked();
});

it("automatically follows the group when the host starts", async () => {
   lobby = { ...lobby, status: "playing", gameId: "game-1" };
   render(page());
   await waitFor(() =>
      expect(screen.getByText("Playing with your group")).toBeInTheDocument()
   );
});

it("shows Leave Seat on your own seat even when every seat is occupied", async () => {
   lobby = {
      ...lobby,
      seats: lobby.seats.map((seat, i) => ({
         ...seat,
         status: "human",
         name: i ? `Player ${i}` : "Alice",
      })),
   };
   const user = userEvent.setup();
   render(page());
   expect(
      screen.queryByRole("button", { name: "Select Seat" })
   ).not.toBeInTheDocument();
   await user.click(screen.getByRole("button", { name: "Leave Seat" }));
   expect(command).toHaveBeenCalledWith({ type: "unseat", code: "ABC234" });
});

it("keeps the host in the group while unseated and waits for everyone to choose seats", () => {
   lobby = {
      ...lobby,
      seat: null,
      unseated: [{ name: "Alice", mine: true, host: true, connected: true }],
      seats: lobby.seats.map((seat) => ({
         ...seat,
         status: "empty",
         mine: false,
         host: false,
         name: "Waiting…",
      })),
   };
   const view = render(page());
   expect(
      screen.getByRole("status", { name: "Players choosing seats" })
   ).toHaveTextContent("Alice (you)");
   expect(screen.getByRole("button", { name: "Start Game" })).toBeDisabled();
   expect(
      screen.getByRole("button", { name: "Close Lobby" })
   ).toBeInTheDocument();
   expect(screen.getAllByRole("button", { name: "Select Seat" })).toHaveLength(
      4
   );
   lobby = {
      ...lobby,
      seat: 0,
      unseated: [
         { name: "Partner", mine: false, host: false, connected: true },
      ],
   };
   view.rerender(page());
   expect(screen.getByRole("button", { name: "Start Game" })).toBeDisabled();
});

it("still offers Leave Lobby to an unseated member", () => {
   lobby = {
      ...lobby,
      seat: null,
      isHost: false,
      unseated: [{ name: "Alice", mine: true, host: false, connected: true }],
   };
   render(page());
   expect(
      screen.getByRole("button", { name: "Leave Lobby" })
   ).toBeInTheDocument();
});

it("hides the waiting room completely when nobody is unseated", () => {
   render(page());
   expect(
      screen.queryByRole("status", { name: "Players choosing seats" })
   ).not.toBeInTheDocument();
});

it("rejoins the waiting room when returning to a lobby after leaving", () => {
   lobby = {
      ...lobby,
      seat: null,
      isMember: false,
      memberName: "",
      isHost: false,
   };
   render(page());
   expect(command).toHaveBeenCalledOnce();
   expect(command).toHaveBeenCalledWith({ type: "watch", code: "ABC234" });
});

it.each([false, true])(
   "does not rejoin the waiting room while leaving the lobby (host: %s)",
   async (isHost) => {
      lobby = { ...lobby, isHost };
      let finishLeaving: (value: { ok: boolean }) => void;
      command.mockImplementation(
         () =>
            new Promise((resolve) => {
               finishLeaving = resolve;
            })
      );
      const user = userEvent.setup();
      const view = render(page());
      await user.click(screen.getByRole("button", { name: "Leave Lobby" }));
      lobby = { ...lobby, seat: null, isMember: false, memberName: "" };
      view.rerender(page());
      expect(command).toHaveBeenCalledOnce();
      expect(command).toHaveBeenCalledWith({ type: "leave", code: "ABC234" });
      finishLeaving!({ ok: true });
      expect(await screen.findByText("Choose a game")).toBeInTheDocument();
   }
);

it("shows new arrivals without blocking the seated host from starting", () => {
   lobby = {
      ...lobby,
      unseated: [
         {
            name: "New arrival",
            mine: false,
            host: false,
            connected: true,
            reserved: false,
         },
      ],
   };
   render(page());
   expect(
      screen.getByRole("status", { name: "Players choosing seats" })
   ).toHaveTextContent("New arrival");
   expect(screen.getByRole("button", { name: "Start Game" })).toBeEnabled();
});

it.each([false, true])(
   "lets a new guest enter a name and take a seat with one click (mobile=%s)",
   async (mobile) => {
      if (mobile) mobileViewport();
      vi.mocked(useAuth).mockReturnValue({ user: null } as ReturnType<
         typeof useAuth
      >);
      lobby = {
         ...lobby,
         seat: null,
         isHost: false,
         memberName: "Guest",
         needsName: true,
         unseated: [
            {
               name: "Guest",
               mine: true,
               host: false,
               connected: true,
               reserved: false,
            },
         ],
      };
      const user = userEvent.setup();
      render(page());
      await user.type(
         screen.getByRole("textbox", { name: "Your name" }),
         "Sam"
      );
      await user.click(
         screen.getAllByRole("button", { name: "Select Seat" })[0]
      );
      expect(command).toHaveBeenCalledOnce();
      expect(command).toHaveBeenCalledWith({
         type: "join",
         code: "ABC234",
         seat: 1,
         name: "Sam",
      });
   }
);

it("saves an unseated guest's name in the waiting room on blur", async () => {
   vi.mocked(useAuth).mockReturnValue({ user: null } as ReturnType<
      typeof useAuth
   >);
   lobby = {
      ...lobby,
      seat: null,
      isHost: false,
      memberName: "Guest",
      needsName: true,
      unseated: [
         {
            name: "Guest",
            mine: true,
            host: false,
            connected: true,
            reserved: false,
         },
      ],
   };
   const user = userEvent.setup();
   render(page());
   await user.type(screen.getByRole("textbox", { name: "Your name" }), "Sam");
   await user.tab();
   expect(command).toHaveBeenCalledWith({
      type: "rename",
      code: "ABC234",
      name: "Sam",
   });
});
