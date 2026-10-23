import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import CreateGame from "./CreateGame";
import Play from "./Play";
import { newGame, type Game } from "@/game/engine";
import type { Lobby } from "@/context/MultiplayerContext";

const mocks = vi.hoisted(() => ({
   auth: { user: null as null | { id: string; name: string } },
   hardLevel: "hard" as "hard" | "harder" | "hardest",
   command: vi.fn(),
   start: vi.fn(),
   concedeGame: vi.fn(),
   game: null as Game | null,
   lobby: null as Lobby | null,
   resumeCode: null as string | null,
   connected: true,
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/context/PreferencesContext", () => ({
   usePreferences: () => ({ preferences: { hardLevel: mocks.hardLevel } }),
}));
vi.mock("@/context/MultiplayerContext", () => ({
   useMultiplayer: () => ({
      connected: mocks.connected,
      resumeCode: mocks.resumeCode,
      lobby: mocks.lobby,
      command: mocks.command,
   }),
}));
vi.mock("@/context/GameContext", () => ({
   useGame: () => ({
      game: mocks.game,
      start: mocks.start,
      concedeGame: mocks.concedeGame,
   }),
}));
vi.mock("@/components/Navbar", () => ({ Navbar: () => null }));

beforeEach(() => {
   mocks.auth.user = null;
   mocks.hardLevel = "hard";
   mocks.command.mockReset().mockResolvedValue({ ok: true, code: "ABC234" });
   mocks.start.mockReset();
   mocks.concedeGame.mockReset();
   mocks.game = null;
   mocks.lobby = null;
   mocks.resumeCode = null;
   mocks.connected = true;
});

function page(entry = "/play") {
   return (
      <HelmetProvider>
         <MemoryRouter initialEntries={[entry]}>
            <Routes>
               <Route path="/play" element={<Play />} />
               <Route path="/game/create" element={<CreateGame />} />
               <Route path="/game/lobby/:code" element={<p>New lobby</p>} />
               <Route
                  path="/game/single-play"
                  element={<p>Saved solo game</p>}
               />
               <Route
                  path="/game/multi-play/:code"
                  element={<p>Multiplayer table</p>}
               />
            </Routes>
         </MemoryRouter>
      </HelmetProvider>
   );
}

async function createOnline() {
   const user = userEvent.setup();
   render(page("/game/create"));
   await user.click(screen.getByRole("radio", { name: "Online", exact: true }));
   await user.click(screen.getByRole("button", { name: "Create Game" }));
   expect(await screen.findByText("New lobby")).toBeInTheDocument();
}

it.each(["hard", "harder", "hardest"] as const)(
   "saves a signed-in creator's %s preference with the lobby",
   async (hardLevel) => {
      mocks.auth.user = { id: "alice", name: "Alice" };
      mocks.hardLevel = hardLevel;
      await createOnline();
      expect(mocks.command).toHaveBeenCalledWith({
         type: "create",
         name: "Alice",
         difficulty: hardLevel,
      });
   }
);

it("uses ordinary Hard for guests even if this browser has a saved Hardest preference", async () => {
   mocks.hardLevel = "hardest";
   await createOnline();
   expect(mocks.command).toHaveBeenCalledWith({
      type: "create",
      name: "Host",
      difficulty: "hard",
   });
});

it("does not interrupt creation with a prompt for the lobby being created", async () => {
   let finishCreating!: (value: { ok: boolean; code: string }) => void;
   mocks.command.mockImplementationOnce(
      () =>
         new Promise((resolve) => {
            finishCreating = resolve;
         })
   );
   const user = userEvent.setup();
   const view = render(page("/game/create"));
   await user.click(screen.getByRole("radio", { name: "Online", exact: true }));
   await user.click(
      screen.getByRole("button", { name: "Create Game", exact: true })
   );
   setOnlineSession();
   view.rerender(page("/game/create"));
   expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
   expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
   await act(async () => finishCreating({ ok: true, code: "ABC234" }));
   expect(screen.getByText("New lobby")).toBeInTheDocument();
});

function setOnlineSession(
   status: "waiting" | "playing" | "finished" = "waiting"
) {
   mocks.resumeCode = "ABC234";
   mocks.lobby = {
      code: "ABC234",
      status,
      seat: 0,
      isMember: true,
      memberName: "Host",
      needsName: false,
      unseated: [],
      isHost: true,
      gameId: status === "playing" ? "online-game" : null,
      difficulty: "hard",
      revision: 1,
      seats: [],
      teams: [],
   };
}

it("opens the unfinished-game prompt immediately on Play, without resume or group links", () => {
   mocks.game = newGame("easy", "You");
   render(page());
   expect(
      screen.queryByRole("link", { name: /resume/i })
   ).not.toBeInTheDocument();
   expect(
      screen.getByRole("dialog", { name: "Game In Progress" })
   ).toBeInTheDocument();
   expect(
      screen.getByRole("button", { name: "Continue", exact: true })
   ).toBeEnabled();
   expect(
      screen.getByRole("button", { name: "Concede", exact: true })
   ).toBeEnabled();
   expect(
      screen.queryByRole("link", { name: /resume/i })
   ).not.toBeInTheDocument();
   expect(mocks.start).not.toHaveBeenCalled();
   expect(mocks.concedeGame).not.toHaveBeenCalled();
   expect(
      screen.queryByRole("link", { name: "Return to Group" })
   ).not.toBeInTheDocument();
   expect(
      screen.getByRole("heading", { name: "PLAY", level: 1 })
   ).toBeInTheDocument();
});

it("continues the saved solo game without replacing or conceding it", async () => {
   mocks.game = newGame("easy", "You");
   const user = userEvent.setup();
   render(page());
   await user.click(
      screen.getByRole("button", { name: "Continue", exact: true })
   );
   expect(screen.getByText("Saved solo game")).toBeInTheDocument();
   expect(mocks.start).not.toHaveBeenCalled();
   expect(mocks.concedeGame).not.toHaveBeenCalled();
});

it("requires confirmation before conceding, then lets the player choose a new game", async () => {
   mocks.game = newGame("easy", "You");
   const user = userEvent.setup();
   const view = render(page());
   await user.click(
      screen.getByRole("button", { name: "Concede", exact: true })
   );
   expect(
      screen.getByRole("dialog", { name: "Are you sure?" })
   ).toHaveTextContent("count as a loss");
   expect(mocks.concedeGame).not.toHaveBeenCalled();
   await user.click(screen.getByRole("button", { name: "No", exact: true }));
   expect(
      screen.getByRole("dialog", { name: "Game In Progress" })
   ).toBeInTheDocument();
   await user.click(
      screen.getByRole("button", { name: "Concede", exact: true })
   );
   await user.click(screen.getByRole("button", { name: "Yes", exact: true }));
   expect(mocks.concedeGame).toHaveBeenCalledOnce();
   expect(mocks.start).not.toHaveBeenCalled();
   mocks.game = { ...mocks.game!, phase: "game_over" };
   view.rerender(page());
   expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
   expect(
      screen.getByRole("heading", { name: "PLAY", level: 1 })
   ).toBeInTheDocument();
   await user.click(screen.getByRole("link", { name: /^create game/i }));
   expect(
      screen.getByRole("radio", { name: "Versus Bots" })
   ).toBeInTheDocument();
   await user.click(
      screen.getByRole("button", { name: "Create Game", exact: true })
   );
   expect(mocks.start).toHaveBeenCalledWith("easy", "You");
   expect(screen.getByText("Saved solo game")).toBeInTheDocument();
});

it("does not prompt for a finished solo game", () => {
   mocks.game = { ...newGame("easy", "You"), phase: "game_over" };
   render(page());
   expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
   expect(
      screen.getByRole("link", { name: /^create game/i })
   ).not.toHaveAttribute("aria-disabled", "true");
});

it.each([
   ["waiting", "Lobby In Progress", "New lobby"],
   ["playing", "Multiplayer Game In Progress", "Multiplayer table"],
] as const)(
   "prompts on entry and rejoins an online session that is %s",
   async (status, title, destination) => {
      setOnlineSession(status);
      const user = userEvent.setup();
      render(page());
      expect(screen.getByRole("dialog", { name: title })).toBeInTheDocument();
      await user.click(
         screen.getByRole("button", { name: "Rejoin", exact: true })
      );
      expect(screen.getByText(destination)).toBeInTheDocument();
      expect(mocks.command).not.toHaveBeenCalled();
   }
);

it("waits for the saved online session to be checked before enabling creation", () => {
   mocks.resumeCode = "ABC234";
   const view = render(page());
   expect(screen.getByRole("status")).toHaveTextContent(
      "Checking for an active game"
   );
   expect(screen.getByRole("link", { name: /^create game/i })).toHaveAttribute(
      "aria-disabled",
      "true"
   );
   setOnlineSession();
   view.rerender(page());
   expect(
      screen.getByRole("dialog", { name: "Lobby In Progress" })
   ).toBeInTheDocument();
   expect(mocks.command).not.toHaveBeenCalled();
});

it("keeps the confirmation open until leaving the online game is acknowledged", async () => {
   setOnlineSession("playing");
   let finishLeaving!: (value: { ok: boolean }) => void;
   mocks.command.mockImplementationOnce(
      () =>
         new Promise((resolve) => {
            finishLeaving = resolve;
         })
   );
   const user = userEvent.setup();
   const view = render(page());
   await user.click(screen.getByRole("button", { name: "Leave", exact: true }));
   expect(screen.getByRole("dialog")).toHaveTextContent(
      "A bot will take your seat"
   );
   await user.click(screen.getByRole("button", { name: "Yes", exact: true }));
   expect(mocks.command).toHaveBeenCalledWith({
      type: "leave",
      code: "ABC234",
   });
   mocks.lobby = { ...mocks.lobby!, isMember: false, seat: null };
   view.rerender(page());
   expect(screen.getByRole("button", { name: "Leaving…" })).toBeDisabled();
   expect(mocks.start).not.toHaveBeenCalled();
   mocks.resumeCode = null;
   await act(async () => finishLeaving({ ok: true }));
   expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
   expect(
      screen.getByRole("link", { name: /^create game/i })
   ).not.toHaveAttribute("aria-disabled", "true");
});

it("keeps the online session and shows the error if leaving fails", async () => {
   setOnlineSession();
   mocks.command.mockRejectedValueOnce(
      new Error("Connection lost. Try again.")
   );
   const user = userEvent.setup();
   render(page());
   await user.click(screen.getByRole("button", { name: "Leave", exact: true }));
   await user.click(screen.getByRole("button", { name: "Yes", exact: true }));
   expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connection lost"
   );
   expect(screen.getByRole("dialog")).toBeInTheDocument();
   expect(
      screen.getByRole("button", { name: "Yes", exact: true })
   ).toBeEnabled();
   expect(mocks.start).not.toHaveBeenCalled();
});

it("handles the solo game before the online lobby when both are saved", async () => {
   mocks.game = newGame("easy", "You");
   setOnlineSession();
   const user = userEvent.setup();
   const view = render(page());
   expect(screen.getAllByRole("dialog")).toHaveLength(1);
   await user.click(
      screen.getByRole("button", { name: "Concede", exact: true })
   );
   await user.click(screen.getByRole("button", { name: "Yes", exact: true }));
   mocks.game = { ...mocks.game!, phase: "game_over" };
   view.rerender(page());
   expect(screen.getAllByRole("dialog")).toHaveLength(1);
   expect(
      screen.getByRole("dialog", { name: "Lobby In Progress" })
   ).toBeInTheDocument();
   expect(mocks.command).not.toHaveBeenCalled();
});

it("disables leaving an online group while disconnected but still offers Rejoin", () => {
   setOnlineSession();
   mocks.connected = false;
   render(page());
   expect(
      screen.getByRole("button", { name: "Leave", exact: true })
   ).toBeDisabled();
   expect(
      screen.getByRole("button", { name: "Rejoin", exact: true })
   ).toBeEnabled();
});

it("only shows Home beneath the Play choices even when a lobby is saved", () => {
   setOnlineSession();
   render(page());
   const home = screen.getByRole("link", { name: "Home", exact: true });
   expect(home.parentElement?.children).toHaveLength(1);
   expect(
      screen.queryByRole("link", { name: /resume|return to group/i })
   ).not.toBeInTheDocument();
});

it.each(["waiting", "finished"] as const)(
   "keeps a %s lobby distinct from a game in progress and shows no loss warning",
   async (status) => {
      setOnlineSession(status);
      const user = userEvent.setup();
      render(page());
      const dialog = screen.getByRole("dialog", { name: "Lobby In Progress" });
      expect(dialog).toHaveTextContent(
         status === "finished" ? "between games" : "active lobby"
      );
      expect(
         screen.queryByRole("button", { name: "Concede", exact: true })
      ).not.toBeInTheDocument();
      await user.click(
         screen.getByRole("button", { name: "Leave", exact: true })
      );
      expect(screen.getByRole("dialog")).toHaveTextContent("leave the lobby");
      expect(screen.getByRole("dialog")).not.toHaveTextContent(
         /loss|bot will take/i
      );
      expect(mocks.command).not.toHaveBeenCalled();
   }
);

it("treats an unseated waiting-room visitor as a lobby member while others are playing", async () => {
   setOnlineSession("playing");
   mocks.lobby = { ...mocks.lobby!, seat: null };
   const user = userEvent.setup();
   render(page());
   expect(
      screen.getByRole("dialog", { name: "Lobby In Progress" })
   ).toHaveTextContent("waiting in an online lobby");
   await user.click(screen.getByRole("button", { name: "Leave", exact: true }));
   expect(screen.getByRole("dialog")).not.toHaveTextContent(
      /loss|bot will take/i
   );
});

it.each(["solo", "online"] as const)(
   "sends direct Create Game visits to the Play prompt for an existing %s session",
   (kind) => {
      if (kind === "solo") mocks.game = newGame("easy", "You");
      else setOnlineSession();
      render(page("/game/create"));
      expect(
         screen.getByRole("heading", { name: "PLAY", level: 1 })
      ).toBeInTheDocument();
      expect(
         screen.getByRole("dialog", {
            name: kind === "solo" ? "Game In Progress" : "Lobby In Progress",
         })
      ).toBeInTheDocument();
      expect(mocks.start).not.toHaveBeenCalled();
      expect(mocks.command).not.toHaveBeenCalled();
   }
);
