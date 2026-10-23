import {
   act,
   fireEvent,
   render,
   screen,
   within,
   waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { useMultiplayer, type Lobby } from "@/context/MultiplayerContext";
import { newGame } from "@/game/engine";
import MultiplayerGame from "./MultiplayerGame";
import type { OnlineGame } from "./GamePage";
import type { ReactNode } from "react";

vi.mock("@/context/MultiplayerContext", () => ({ useMultiplayer: vi.fn() }));
vi.mock("@/components/ui/PageLayout", () => ({
   PageLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./GamePage", () => ({
   default: ({ online }: { online: OnlineGame }) => (
      <>
         <button onClick={online.onLeave}>Leave Game</button>
         <button onClick={online.onRematch}>Play Again</button>
         <button onClick={online.onLobby}>Back to Lobby</button>
      </>
   ),
}));

it("goes back to Play after leaving even when the server removes the seat before acknowledging", async () => {
   let lobby = {
      code: "ABC234",
      status: "playing",
      seat: 0,
      revision: 1,
      isHost: true,
   } as Lobby;
   let acknowledge!: (value: { ok: boolean }) => void;
   const command = vi.fn().mockImplementation(
      () =>
         new Promise((resolve) => {
            acknowledge = resolve;
         })
   );
   vi.mocked(useMultiplayer).mockImplementation(() => ({
      lobby,
      game: newGame("easy", "You"),
      connected: true,
      error: "",
      resumeCode: "ABC234",
      command,
   }));
   const page = () => (
      <MemoryRouter initialEntries={["/game/multi-play/ABC234"]}>
         <Routes>
            <Route
               path="/game/multi-play/:code"
               element={<MultiplayerGame />}
            />
            <Route path="/game/lobby/:code" element={<p>Lobby</p>} />
            <Route path="/play" element={<p>Play menu</p>} />
         </Routes>
      </MemoryRouter>
   );
   const view = render(page());
   fireEvent.click(screen.getByRole("button", { name: "Leave Game" }));
   fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
         name: "Leave Game",
      })
   );
   lobby = { ...lobby, seat: null };
   view.rerender(page());
   expect(screen.queryByText("Lobby")).not.toBeInTheDocument();
   await act(async () => {
      acknowledge({ ok: true });
   });
   await waitFor(() =>
      expect(screen.getByText("Play menu")).toBeInTheDocument()
   );
});

it("sends distinct commands for immediate rematches and returning to the lobby", async () => {
   const lobby = {
      code: "ABC234",
      status: "finished",
      seat: 0,
      revision: 7,
      isHost: true,
   } as Lobby;
   const command = vi.fn().mockResolvedValue({ ok: true });
   vi.mocked(useMultiplayer).mockReturnValue({
      lobby,
      game: newGame("easy", "You"),
      connected: true,
      error: "",
      resumeCode: "ABC234",
      command,
   });
   render(
      <MemoryRouter initialEntries={["/game/multi-play/ABC234"]}>
         <Routes>
            <Route
               path="/game/multi-play/:code"
               element={<MultiplayerGame />}
            />
         </Routes>
      </MemoryRouter>
   );
   await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Play Again" }));
   });
   expect(command).toHaveBeenLastCalledWith({
      type: "play_again",
      code: "ABC234",
      revision: 7,
   });
   await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back to Lobby" }));
   });
   expect(command).toHaveBeenLastCalledWith({
      type: "rematch",
      code: "ABC234",
      revision: 7,
   });
});

it.each([0, 1, 2, 3])(
   "returns the player in seat %i to the same lobby when the host returns the group",
   async (seat) => {
      const lobby = {
         code: "ABC234",
         status: "finished",
         seat,
         revision: 7,
         isHost: seat === 3,
      } as Lobby;
      const value = {
         lobby,
         game: { ...newGame("easy", "You"), phase: "game_over" as const },
         connected: true,
         error: "",
         resumeCode: "ABC234",
         command: vi.fn().mockResolvedValue({ ok: true }),
      };
      vi.mocked(useMultiplayer).mockReturnValue(value);
      const page = () => (
         <MemoryRouter initialEntries={["/game/multi-play/ABC234"]}>
            <Routes>
               <Route
                  path="/game/multi-play/:code"
                  element={<MultiplayerGame />}
               />
               <Route
                  path="/game/lobby/ABC234"
                  element={<p>Original group lobby</p>}
               />
            </Routes>
         </MemoryRouter>
      );
      const view = render(page());
      expect(
         screen.getByRole("button", { name: "Back to Lobby" })
      ).toBeInTheDocument();
      vi.mocked(useMultiplayer).mockReturnValue({
         ...value,
         lobby: { ...lobby, status: "waiting", revision: 8 },
         game: null,
      });
      view.rerender(page());
      await waitFor(() =>
         expect(screen.getByText("Original group lobby")).toBeInTheDocument()
      );
      expect(value.command).not.toHaveBeenCalled();
   }
);
