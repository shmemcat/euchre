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
