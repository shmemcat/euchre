import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "@/context/PreferencesContext";
import { useGame } from "@/context/GameContext";
import {
   applyAction,
   legalActions,
   newGame,
   seatName,
   suitOf,
   type Action,
   type Game,
} from "@/game/engine";
import GamePage, { type OnlineGame } from "./GamePage";
import cardStyles from "@/styles/card.module.css";
import { OPENING_DEAL_MS } from "@/hooks/useOpeningSequence";

vi.mock("@/context/GameContext", () => ({ useGame: vi.fn() }));
vi.mock("@/components/Navbar", () => ({
   Navbar: () => <nav aria-label="Main navigation" />,
}));
const sound = vi.hoisted(() => ({ play: vi.fn() }));
vi.mock("@/context/SoundContext", () => ({ useSound: () => sound }));

const takeAction = vi.fn();
const workers: TestWorker[] = [];
class TestWorker {
   onmessage: ((event: { data: { action: Action } }) => void) | null = null;
   postMessage = vi.fn();
   terminate = vi.fn();
   constructor() {
      workers.push(this);
   }
}

function fixture(overrides: Partial<Game> = {}): Game {
   return {
      ...newGame("easy", "You"),
      dealer: 3,
      turn: 0,
      upCard: "As",
      passes: 1,
      ...overrides,
   };
}

function board(game: Game, online?: Omit<OnlineGame, "game">) {
   const setGame = (next: Game) =>
      vi.mocked(useGame).mockReturnValue({
         game: next,
         act: takeAction,
         saved: true,
         error: "",
         start: vi.fn(),
         concedeGame: vi.fn(),
      });
   const content = () => (
      <HelmetProvider>
         <MemoryRouter>
            <PreferencesProvider>
               <GamePage online={online ? { ...online, game } : undefined} />
            </PreferencesProvider>
         </MemoryRouter>
      </HelmetProvider>
   );
   setGame(game);
   const view = render(content());
   return {
      ...view,
      update(next: Game) {
         game = next;
         setGame(next);
         view.rerender(content());
      },
   };
}

describe.each(["single", "host", "guest"])(
   "No-calls summary for %s",
   (mode) => {
      it.each([0, 1] as const)(
         "shows unchanged totals after pass-out %i",
         (consecutivePassOuts) => {
            const send = vi.fn();
            let game = fixture({
               passes: 0,
               consecutivePassOuts,
               scores: [3, 5],
               teamNames: ["Our team", "Their team"],
               results: [
                  {
                     hand: 1,
                     maker: 2,
                     trump: "h",
                     alone: false,
                     tricks: [3, 2],
                     points: [1, 0],
                     scores: [3, 5],
                  },
               ],
            });
            for (let i = 0; i < 8; i++)
               game = applyAction(game, { type: "pass" });
            board(
               game,
               mode === "single"
                  ? undefined
                  : {
                       act: send,
                       saved: true,
                       error: "",
                       isHost: mode === "host",
                       disabled: false,
                       onRematch: vi.fn(),
                       onLobby: vi.fn(),
                       onLeave: vi.fn(),
                    }
            );
            const dialog = within(screen.getByRole("dialog"));
            expect(
               dialog.getByRole("heading", {
                  name: consecutivePassOuts
                     ? "No calls — Pass"
                     : "No calls — Re-deal",
               })
            ).toBeVisible();
            const table = within(
               dialog.getByRole("table", { name: "Current scores" })
            );
            expect(
               table
                  .getAllByRole("columnheader")
                  .map((cell) => cell.textContent)
            ).toEqual(["Team", "Total"]);
            expect(
               table.getAllByRole("cell").map((cell) => cell.textContent)
            ).toEqual(["5", "3"]);
            expect(
               table.getByRole("rowheader", { name: "Our team" })
            ).toBeVisible();
            expect(
               table.getByRole("rowheader", { name: "Their team" })
            ).toBeVisible();
            expect(dialog.queryByText(/called/)).not.toBeInTheDocument();
            expect(takeAction).not.toHaveBeenCalled();
            expect(send).not.toHaveBeenCalled();
            fireEvent.click(
               dialog.getByRole("button", { name: "Next Hand" })
            );
            expect(
               mode === "single" ? takeAction : send
            ).toHaveBeenCalledExactlyOnceWith({ type: "advance" });
         }
      );
   }
);

describe("Multiplayer game end", () => {
   it("lets guests ready up and shows the waiting message inside the button", () => {
      const connection = {
         act: takeAction, saved: true, error: "", isHost: false, disabled: false,
         onRematch: vi.fn(), onLobby: vi.fn(), onLeave: vi.fn(),
      };
      const game = fixture({
         phase: "round_complete", humanSeats: [true, false, true, false],
         nextHandReady: [false, true, true, true],
      });
      const view = board(game, connection);
      const dialog = within(screen.getByRole("dialog"));
      expect(dialog.queryByRole("list")).not.toBeInTheDocument();
      expect(dialog.queryByText(/Next hand ·/)).not.toBeInTheDocument();
      expect(dialog.queryByText("Waiting for players")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Next Hand" }));
      expect(takeAction).toHaveBeenCalledExactlyOnceWith({ type: "advance" });
      view.update({ ...game, nextHandReady: [true, true, true, true] });
      const waiting = screen.getByRole("button", { name: "Waiting for players" });
      expect(waiting).toBeDisabled();
      fireEvent.click(waiting);
      expect(takeAction).toHaveBeenCalledTimes(1);
      expect(dialog.getByRole("status")).toHaveTextContent("Waiting for players...");
      expect(waiting).toContainElement(dialog.getByRole("status"));
      expect(dialog.queryByRole("list")).not.toBeInTheDocument();
      expect(dialog.queryByText(/Next hand ·/)).not.toBeInTheDocument();
   });
   it("offers separate rematch and lobby actions to the host", () => {
      const onRematch = vi.fn(),
         onLobby = vi.fn(),
         onLeave = vi.fn();
      board(
         fixture({
            phase: "game_over",
            scores: [10, 4],
            teamNames: ["Shmut", "Team 2"],
         }),
         {
            act: vi.fn(),
            saved: true,
            error: "",
            isHost: true,
            disabled: false,
            onRematch,
            onLobby,
            onLeave,
         }
      );
      const dialog = within(screen.getByRole("dialog"));
      expect(
         dialog.getByRole("heading", { name: "Game Complete" })
      ).toBeInTheDocument();
      expect(dialog.getByRole("heading", { name: "Shmut wins!" })).toBeVisible();
      const scores = within(dialog.getByRole("group", { name: "Final scores" }));
      expect(scores.getByText("10")).toBeVisible();
      expect(scores.getByText("4")).toBeVisible();
      fireEvent.click(
         dialog.getByRole("button", { name: "Play Again", exact: true })
      );
      expect(onRematch).toHaveBeenCalledOnce();
      expect(onLobby).not.toHaveBeenCalled();
      fireEvent.click(dialog.getByRole("button", { name: "Back to Lobby" }));
      expect(onLobby).toHaveBeenCalledOnce();
      fireEvent.click(dialog.getByRole("button", { name: "Leave Lobby" }));
      expect(onLeave).toHaveBeenCalledOnce();
      expect(dialog.getByRole("link", { name: "Home" })).toBeInTheDocument();
      expect(
         dialog.queryByRole("link", { name: "Leaderboard" })
      ).not.toBeInTheDocument();
   });

   it("shows disabled host actions with tooltips when you are a guest", async () => {
      const user = userEvent.setup();
      const onRematch = vi.fn(),
         onLobby = vi.fn(),
         onLeave = vi.fn();
      board(
         fixture({
            phase: "game_over",
            scores: [9, 11],
            teamNames: ["Shmut", "Team 2"],
         }),
         {
            act: vi.fn(),
            saved: true,
            error: "",
            isHost: false,
            disabled: false,
            onRematch,
            onLobby,
            onLeave,
         }
      );
      expect(
         screen.getByRole("heading", { name: "Team 2 wins!" })
      ).toBeInTheDocument();
      const playAgain = screen.getByRole("button", { name: "Play Again" });
      const backToLobby = screen.getByRole("button", { name: "Back to Lobby" });
      expect(playAgain).toBeVisible();
      expect(playAgain).toBeDisabled();
      expect(backToLobby).toBeVisible();
      expect(backToLobby).toBeDisabled();
      fireEvent.click(playAgain);
      fireEvent.click(backToLobby);
      expect(onRematch).not.toHaveBeenCalled();
      expect(onLobby).not.toHaveBeenCalled();
      const leaveLobby = screen.getByRole("button", { name: "Leave Lobby" });
      expect(leaveLobby).toBeEnabled();
      fireEvent.click(leaveLobby);
      expect(onLeave).toHaveBeenCalledOnce();
      expect(
         screen.getByText(
            "Stay here. Your host can start another game or take everyone back to the lobby."
         )
      ).toBeVisible();
      await user.hover(playAgain.parentElement!);
      expect(await screen.findByRole("tooltip")).toHaveTextContent(
         "Only the host can start another game."
      );
      await user.unhover(playAgain.parentElement!);
      act(() => playAgain.parentElement!.focus());
      await user.tab();
      expect(backToLobby.parentElement).toHaveFocus();
      expect(await screen.findByRole("tooltip")).toHaveTextContent(
         "Only the host can return the group to the lobby."
      );
   });

   it.each([true, false])(
      "disables leaving while disconnected or busy (host=%s)",
      (isHost) => {
         const onLeave = vi.fn();
         board(fixture({ phase: "game_over", scores: [10, 4] }), {
            act: vi.fn(),
            saved: true,
            error: "",
            isHost,
            disabled: true,
            onRematch: vi.fn(),
            onLobby: vi.fn(),
            onLeave,
         });
         const button = screen.getByRole("button", { name: "Leave Lobby" });
         expect(button).toBeDisabled();
         fireEvent.click(button);
         expect(onLeave).not.toHaveBeenCalled();
      }
   );
});

describe("Multiplayer opening animations", () => {
   const online = (): Omit<OnlineGame, "game"> => ({
      act: vi.fn(),
      saved: true,
      error: "",
      isHost: false,
      disabled: false,
      onRematch: vi.fn(),
      onLobby: vi.fn(),
      onLeave: vi.fn(),
   });

   it("shows a remote order, flies the upcard into your hand, and animates your discard", () => {
      vi.useFakeTimers();
      const game = {
         ...newGame("easy", "You", () => 0.84),
         dealer: 0 as const,
         turn: 1 as const,
         passes: 1,
      };
      const connection = online();
      const view = board(game, connection);
      const ordered = applyAction(game, {
         type: "call",
         suit: suitOf(game.upCard),
         alone: false,
      });
      view.update(ordered);
      expect(screen.getByText("Ordered Up")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1250));
      expect(document.querySelector(".opening-flight")).toBeInTheDocument();
      expect(
         document.querySelector(".hand-card-in-flight")
      ).toBeInTheDocument();
      expect(document.querySelectorAll(".hand-card")).toHaveLength(6);
      act(() => vi.advanceTimersByTime(550));
      expect(document.querySelector(".hand-card-received")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(100));
      const card = within(
         screen.getByRole("region", { name: "Your hand" })
      ).getAllByRole("button")[0];
      fireEvent.click(card);
      expect(connection.act).toHaveBeenCalledOnce();
      const action = vi.mocked(connection.act).mock.calls[0][0];
      view.update(applyAction(ordered, action));
      expect(document.querySelector(".hand-card-discarding .euchre-card")).toBe(
         card
      );
      expect(card).toBeDisabled();
      act(() => vi.advanceTimersByTime(400));
      expect(document.querySelectorAll(".hand-card")).toHaveLength(5);
      expect(
         screen.getByRole("group", { name: "Current trick" })
      ).toBeInTheDocument();
      expect(workers).toHaveLength(0);
      expect(takeAction).not.toHaveBeenCalled();
   });

   it("renders an unknown opponent discard as a card back after the pickup", () => {
      vi.useFakeTimers();
      const game = fixture();
      const connection = online();
      const view = board(game, connection);
      const ordered = applyAction(game, {
         type: "call",
         suit: "s",
         alone: false,
      });
      const discarded = applyAction(ordered, {
         type: "discard",
         card: ordered.hands[3][0],
      });
      const redact = (next: Game) => ({
         ...next,
         hands: next.hands.map((hand, seat) =>
            seat === 0 ? hand : Array(hand.length).fill(null)
         ),
      });
      view.update(redact(ordered));
      view.update(redact(discarded));
      expect(document.querySelector(".kitty-picking-up")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(550));
      expect(document.querySelector(".opening-flight img")).toHaveAttribute(
         "src",
         "/cards/back.svg"
      );
      expect(
         document.querySelector(".opening-flight .euchre-card")
      ).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(400));
      expect(document.querySelector(".opening-flight")).not.toBeInTheDocument();
      expect(connection.act).not.toHaveBeenCalled();
   });
});

beforeEach(() => {
   takeAction.mockReset();
   sound.play.mockReset();
   workers.length = 0;
   vi.stubGlobal("Worker", TestWorker);
});

function completeTrick(alone = false, count = 1): Game {
   let game = newGame("easy", "You", () => 0.84);
   while (
      game.phase !== "trick_complete" ||
      game.completedTricks.length !== count
   ) {
      const actions = legalActions(game);
      game = applyAction(
         game,
         actions.find(
            (action) => action.type === "call" && action.alone === alone
         ) ?? actions[0]
      );
   }
   return game;
}

describe("Trick collection", () => {
   it.each([false, true])(
      "holds every card, then sweeps before advancing (alone=%s)",
      (alone) => {
         vi.useFakeTimers();
         const game = completeTrick(alone);
         const view = board(game);
         const trick = screen.getByRole("group", { name: "Current trick" });
         expect(trick.querySelectorAll(".trick-card")).toHaveLength(
            alone ? 3 : 4
         );
         expect(sound.play).toHaveBeenCalledWith("play");
         act(() => vi.advanceTimersByTime(999));
         expect(trick).not.toHaveClass("is-collecting");
         expect(takeAction).not.toHaveBeenCalled();
         expect(sound.play).not.toHaveBeenCalledWith("trick");
         act(() => vi.advanceTimersByTime(1));
         expect(trick).toHaveClass("is-collecting");
         expect(sound.play).toHaveBeenLastCalledWith("trick");
         act(() => vi.advanceTimersByTime(449));
         expect(takeAction).not.toHaveBeenCalled();
         act(() => vi.advanceTimersByTime(1));
         expect(takeAction).toHaveBeenCalledExactlyOnceWith({
            type: "advance",
         });
         view.update(applyAction(game, { type: "advance" }));
         expect(trick.querySelectorAll(".trick-card")).toHaveLength(0);
         expect(trick.querySelectorAll(".card-placeholder")).toHaveLength(
            alone ? 3 : 4
         );
         expect(trick).not.toHaveClass("is-collecting");
      }
   );

   it("pauses the hold and collection while match details are open", () => {
      vi.useFakeTimers();
      board(completeTrick());
      act(() => vi.advanceTimersByTime(600));
      fireEvent.click(screen.getByRole("button", { name: "Match details" }));
      act(() => vi.advanceTimersByTime(5000));
      expect(sound.play).not.toHaveBeenCalledWith("trick");
      fireEvent.keyDown(document, { key: "Escape" });
      act(() => vi.advanceTimersByTime(399));
      expect(sound.play).not.toHaveBeenCalledWith("trick");
      act(() => vi.advanceTimersByTime(1));
      expect(sound.play).toHaveBeenCalledWith("trick");
      act(() => vi.advanceTimersByTime(200));
      fireEvent.click(screen.getByRole("button", { name: "Match details" }));
      act(() => vi.advanceTimersByTime(5000));
      expect(takeAction).not.toHaveBeenCalled();
      fireEvent.keyDown(document, { key: "Escape" });
      act(() => vi.advanceTimersByTime(249));
      expect(takeAction).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(takeAction).toHaveBeenCalledExactlyOnceWith({ type: "advance" });
      expect(
         sound.play.mock.calls.filter(([name]) => name === "trick")
      ).toHaveLength(1);
   });

   it("collects consecutive tricks and clears the final trick before the summary", () => {
      vi.useFakeTimers();
      const first = completeTrick();
      const view = board(first);
      const trick = screen.getByRole("group", { name: "Current trick" });
      act(() => vi.advanceTimersByTime(1000));
      act(() => vi.advanceTimersByTime(450));
      view.update(applyAction(first, { type: "advance" }));
      const final = completeTrick(false, 5);
      view.update(final);
      expect(trick.querySelectorAll(".trick-card")).toHaveLength(4);
      expect(trick).not.toHaveClass("is-collecting");
      act(() => vi.advanceTimersByTime(1000));
      expect(trick).toHaveClass("is-collecting");
      act(() => vi.advanceTimersByTime(450));
      expect(takeAction).toHaveBeenCalledTimes(2);
      view.update(applyAction(final, { type: "advance" }));
      expect(trick.querySelectorAll(".trick-card")).toHaveLength(0);
      expect(sound.play).toHaveBeenLastCalledWith("round");
   });

   it("cancels a pending collection when leaving the board", () => {
      vi.useFakeTimers();
      const view = board(completeTrick());
      act(() => vi.advanceTimersByTime(1000));
      view.unmount();
      act(() => vi.advanceTimersByTime(5000));
      expect(takeAction).not.toHaveBeenCalled();
   });
});
afterEach(() => {
   vi.useRealTimers();
   vi.unstubAllGlobals();
});

describe.each(["single", "multiplayer"])(
   "Advance card selection in %s",
   (mode) => {
      function waitingGame(): Game {
         return fixture({
            phase: "playing",
            turn: 3,
            trump: "s",
            maker: 1,
            hands: [
               ["9c", "Ac", "Jc", "Ah", "Kd"],
               ["10c", "Qc", "Kc", "10d", "Jd"],
               ["9d", "Qd", "Ad", "10s", "Ks"],
               ["9s", "Qs", "9h", "10h", "Qh"],
            ],
            kitty: ["Js", "Kh", "Jh", "As"],
         });
      }

      function setup(game = waitingGame()) {
         const connection: Omit<OnlineGame, "game"> = {
            act: takeAction,
            saved: true,
            error: "",
            isHost: false,
            disabled: false,
            onRematch: vi.fn(),
            onLobby: vi.fn(),
            onLeave: vi.fn(),
         };
         const view = board(
            game,
            mode === "multiplayer" ? connection : undefined
         );
         const hand = within(screen.getByRole("region", { name: "Your hand" }));
         return { ...view, hand, connection };
      }

      it("lets you replace or cancel the selected card without playing early", () => {
         const game = waitingGame();
         const view = setup(game);
         const club = view.hand.getByRole("button", { name: "9 of clubs" });
         const bower = view.hand.getByRole("button", { name: "Jack of clubs" });
         expect(
            view.hand
               .getAllByRole("button")
               .every((card) => !card.hasAttribute("disabled"))
         ).toBe(true);
         fireEvent.click(club);
         expect(club).toHaveAttribute("aria-pressed", "true");
         expect(club).toHaveClass(cardStyles.cardSelected);
         fireEvent.click(bower);
         expect(club).not.toHaveAttribute("aria-pressed", "true");
         expect(bower).toHaveAttribute("aria-pressed", "true");
         fireEvent.click(bower);
         expect(bower).not.toHaveAttribute("aria-pressed", "true");
         expect(takeAction).not.toHaveBeenCalled();
         view.update(applyAction(game, { type: "play", card: "9s" }));
         expect(takeAction).not.toHaveBeenCalled();
         expect(bower).toBeEnabled();
      });

      it("plays a legal selection exactly once when your turn arrives, including the left bower", () => {
         const game = waitingGame();
         const view = setup(game);
         fireEvent.click(
            view.hand.getByRole("button", { name: "Jack of clubs" })
         );
         expect(takeAction).not.toHaveBeenCalled();
         const next = applyAction(game, { type: "play", card: "9s" });
         view.update(next);
         expect(takeAction).toHaveBeenCalledExactlyOnceWith({
            type: "play",
            card: "Jc",
         });
         expect(
            view.hand.queryByRole("button", { pressed: true })
         ).not.toBeInTheDocument();
         view.update({ ...next });
         expect(takeAction).toHaveBeenCalledTimes(1);
      });

      it("clears an illegal selection and leaves legal cards available for normal play", () => {
         const game = waitingGame();
         const view = setup(game);
         fireEvent.click(view.hand.getByRole("button", { name: "9 of clubs" }));
         view.update(applyAction(game, { type: "play", card: "9s" }));
         expect(takeAction).not.toHaveBeenCalled();
         expect(
            view.hand.queryByRole("button", { pressed: true })
         ).not.toBeInTheDocument();
         expect(
            view.hand.getByRole("button", { name: "9 of clubs" })
         ).toBeDisabled();
         const bower = view.hand.getByRole("button", { name: "Jack of clubs" });
         expect(bower).toBeEnabled();
         fireEvent.click(bower);
         expect(takeAction).toHaveBeenCalledExactlyOnceWith({
            type: "play",
            card: "Jc",
         });
      });

      it("keeps the selection through other players' turns before checking legality", () => {
         let game: Game = { ...waitingGame(), turn: 1 };
         const view = setup(game);
         const club = view.hand.getByRole("button", { name: "9 of clubs" });
         fireEvent.click(club);
         for (const card of ["10c", "9d"] as const) {
            game = applyAction(game, { type: "play", card });
            view.update(game);
            expect(club).toHaveAttribute("aria-pressed", "true");
            expect(takeAction).not.toHaveBeenCalled();
         }
         view.update(applyAction(game, { type: "play", card: "9s" }));
         expect(takeAction).toHaveBeenCalledExactlyOnceWith({
            type: "play",
            card: "9c",
         });
      });

      it("allows selecting the next lead while a completed trick is being collected", () => {
         let game = waitingGame();
         for (const card of ["9s", "Jc", "10c", "Ks"] as const)
            game = applyAction(game, { type: "play", card });
         expect(game.phase).toBe("trick_complete");
         expect(game.turn).toBe(0);
         const view = setup(game);
         const club = view.hand.getByRole("button", { name: "9 of clubs" });
         fireEvent.click(club);
         expect(club).toHaveAttribute("aria-pressed", "true");
         expect(takeAction).not.toHaveBeenCalled();
         view.update(applyAction(game, { type: "advance" }));
         expect(takeAction).toHaveBeenCalledExactlyOnceWith({
            type: "play",
            card: "9c",
         });
      });

      it("waits until match details close before playing a selected card", () => {
         const game = waitingGame();
         const view = setup(game);
         fireEvent.click(
            view.hand.getByRole("button", { name: "Jack of clubs" })
         );
         fireEvent.click(screen.getByRole("button", { name: "Match details" }));
         view.update(applyAction(game, { type: "play", card: "9s" }));
         expect(takeAction).not.toHaveBeenCalled();
         expect(
            view.hand.getByRole("button", { name: "Jack of clubs" })
         ).toHaveAttribute("aria-pressed", "true");
         fireEvent.keyDown(document, { key: "Escape" });
         expect(takeAction).toHaveBeenCalledExactlyOnceWith({
            type: "play",
            card: "Jc",
         });
      });

      it.each([
         "new game",
         "new hand",
         "round end",
         "sitting out",
         "missing card",
      ])(
         "clears the selection on %s without submitting a stale card",
         (change) => {
            const game = waitingGame();
            const view = setup(game);
            fireEvent.click(
               view.hand.getByRole("button", { name: "Jack of clubs" })
            );
            const changes: Partial<Game> =
               change === "new game"
                  ? { id: "another-game" }
                  : change === "new hand"
                  ? { handNumber: game.handNumber + 1 }
                  : change === "round end"
                  ? { phase: "round_complete" }
                  : change === "sitting out"
                  ? { sittingOut: 0 }
                  : {
                       hands: game.hands.map((hand, seat) =>
                          seat === 0
                             ? hand.filter((card) => card !== "Jc")
                             : hand
                       ),
                    };
            view.update({ ...game, turn: 0, ...changes });
            expect(takeAction).not.toHaveBeenCalled();
            expect(
               view.hand.queryByRole("button", { pressed: true })
            ).not.toBeInTheDocument();
            view.update({ ...game, turn: 0 });
            expect(takeAction).not.toHaveBeenCalled();
         }
      );

      it("keeps cards inactive during bidding and while your partner goes alone", () => {
         const game = waitingGame();
         const view = setup({ ...game, phase: "bidding2" });
         expect(view.hand.queryAllByRole("button")).toHaveLength(0);
         view.update({ ...game, alone: true, maker: 2, sittingOut: 0 });
         expect(view.hand.queryAllByRole("button")).toHaveLength(0);
      });

      if (mode === "multiplayer")
         it("holds a selection while disconnected or submitting another action", () => {
            const game = waitingGame();
            const view = setup(game);
            fireEvent.click(
               view.hand.getByRole("button", { name: "Jack of clubs" })
            );
            view.connection.disabled = true;
            const next = applyAction(game, { type: "play", card: "9s" });
            view.update(next);
            expect(takeAction).not.toHaveBeenCalled();
            expect(
               view.hand.getByRole("button", { name: "Jack of clubs" })
            ).toBeDisabled();
            view.connection.disabled = false;
            view.update(next);
            expect(takeAction).toHaveBeenCalledExactlyOnceWith({
               type: "play",
               card: "Jc",
            });
         });
   }
);

describe("Quiet Table game controls", () => {
   it("shows single-player bot initials in compact seat badges", () => {
      const game = fixture({ seatNames: ["You", "Mary", "Duffy", "Tim"] });
      board(game);
      expect(
         Array.from(document.querySelectorAll(".seat-badge"), (badge) => badge.textContent).sort()
      ).toEqual(["D", "M", "T", "Y"]);
      for (const name of ["Mary", "Duffy", "Tim"])
         expect(screen.getByText(name, { selector: ".seat-full-name" })).toBeInTheDocument();
   });

   it("keeps multiplayer bot numbers when the table is rotated", () => {
      board(fixture({
         playerName: "Alice",
         seatNames: ["Alice", "Bot 2", "Bob", "Bot 1"],
         humanSeats: [true, false, true, false],
      }));
      expect(document.querySelector(".seat-1 .seat-badge")).toHaveTextContent("B2");
      expect(document.querySelector(".seat-2 .seat-badge")).toHaveTextContent("B");
      expect(document.querySelector(".seat-3 .seat-badge")).toHaveTextContent("B1");
   });

   it("keeps the regular bot play delay at 500ms", () => {
      vi.useFakeTimers();
      board(fixture({ phase: "playing", turn: 1, trump: "s", maker: 0 }));
      act(() =>
         workers[0].onmessage?.({
            data: { action: { type: "play", card: "9c" } },
         })
      );
      act(() => vi.advanceTimersByTime(499));
      expect(takeAction).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(takeAction).toHaveBeenCalledExactlyOnceWith({
         type: "play",
         card: "9c",
      });
   });

   it("shows only a card back when a bot discards after the longer opening pause", () => {
      vi.useFakeTimers();
      board(
         fixture({ phase: "discard", turn: 3, dealer: 3, maker: 0, trump: "s" })
      );
      act(() =>
         workers[0].onmessage?.({
            data: { action: { type: "discard", card: "As" } },
         })
      );
      act(() => vi.advanceTimersByTime(999));
      expect(document.querySelector(".opening-flight")).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      expect(document.querySelector(".opening-flight img")).toHaveAttribute(
         "src",
         "/cards/back.svg"
      );
      expect(
         document.querySelector(".opening-flight .euchre-card")
      ).not.toBeInTheDocument();
      expect(takeAction).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(400));
      expect(takeAction).toHaveBeenCalledExactlyOnceWith({
         type: "discard",
         card: "As",
      });
   });

   it("waits for the full deal and reveal before starting a bot", () => {
      vi.useFakeTimers();
      board(fixture({ turn: 1, passes: 0 }));
      expect(document.querySelector(".hand-dealing")).toBeInTheDocument();
      expect(workers).toHaveLength(0);
      act(() => vi.advanceTimersByTime(OPENING_DEAL_MS - 1));
      expect(workers).toHaveLength(0);
      act(() => vi.advanceTimersByTime(1));
      expect(workers).toHaveLength(1);
   });

   it.each(["single player", "multiplayer"])("deals four mini hands and reveals yours on every new hand in %s", (mode) => {
      vi.useFakeTimers();
      const game = fixture({ turn: 0, passes: 0 });
      const view = board(game, mode === "multiplayer" ? {
         act: takeAction, saved: true, error: "", isHost: false, disabled: false,
         onRematch: vi.fn(), onLobby: vi.fn(), onLeave: vi.fn(),
      } : undefined);
      expect(document.querySelectorAll(".deal-mini-hand")).toHaveLength(4);
      expect(document.querySelectorAll(".deal-hidden-card")).toHaveLength(20);
      expect(document.querySelectorAll(".deal-flight")).toHaveLength(24);
      expect(screen.queryByRole("region", { name: "Your hand" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Pass" })).not.toBeInTheDocument();
      expect(document.querySelector(".kitty-dealing")).toHaveAttribute("aria-hidden", "true");
      act(() => vi.advanceTimersByTime(OPENING_DEAL_MS));
      expect(document.querySelector(".seat-0 .hidden-hand")).not.toBeInTheDocument();
      expect(document.querySelector(".deal-overlay")).not.toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Your hand" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Pass" })).toBeEnabled();

      const summary = { ...game, phase: "round_complete" as const };
      view.update(summary);
      view.update(applyAction(summary, { type: "advance" }));
      expect(document.querySelectorAll(".deal-overlay")).toHaveLength(1);
      expect(document.querySelectorAll(".deal-mini-hand")).toHaveLength(4);
      expect(document.querySelector(".kitty-dealing")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Pass" })).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(OPENING_DEAL_MS - 1));
      expect(screen.queryByRole("region", { name: "Your hand" })).not.toBeInTheDocument();
      expect(takeAction).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(document.querySelector(".deal-overlay")).not.toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Your hand" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Pass" })).toBeEnabled();
   });

   it("folds and turns down the kitty before enabling second-round bidding", () => {
      vi.useFakeTimers();
      let game = fixture({ dealer: 0, passes: 3 });
      const view = board(game);
      takeAction.mockImplementation((action) => {
         game = applyAction(game, action);
         view.update(game);
      });
      fireEvent.click(screen.getByRole("button", { name: "Pass" }));
      expect(document.querySelector(".kitty-turning")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Pass" })).toBeDisabled();
      act(() => vi.advanceTimersByTime(800));
      expect(document.querySelector(".kitty-facedown")).toBeInTheDocument();
      expect(
         screen.getByRole("img", { name: "Turned-down upcard" })
      ).toBeInTheDocument();
      expect(
         screen.queryByRole("img", {
            name: "Face-down cards beneath the upcard",
         })
      ).not.toBeInTheDocument();
      expect(
         screen.queryByRole("button", { name: /Spades/i })
      ).not.toBeInTheDocument();
      expect(
         screen.getByRole("group", { name: `${seatName(game, game.turn)} · Current turn` })
      ).toBeInTheDocument();
      expect(workers).toHaveLength(1);
   });

   it("receives the upcard into your hand and animates the chosen discard out", () => {
      vi.useFakeTimers();
      let game: Game = {
         ...newGame("easy", "You", () => 0.84),
         dealer: 0,
         turn: 0,
         passes: 3,
      };
      const view = board(game);
      takeAction.mockImplementation((action) => {
         game = applyAction(game, action);
         view.update(game);
      });
      fireEvent.click(screen.getByRole("button", { name: /Pick up/i }));
      expect(document.querySelectorAll(".hand-card")).toHaveLength(6);
      expect(
         document.querySelector(".hand-card-in-flight")
      ).toBeInTheDocument();
      expect(document.querySelector(".opening-flight")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(550));
      const hand = within(screen.getByRole("region", { name: "Your hand" }));
      expect(document.querySelector(".hand-card-received")).toBeInTheDocument();
      expect(
         hand
            .getAllByRole("button")
            .every((button) => button.hasAttribute("disabled"))
      ).toBe(true);
      for (const card of hand.getAllByRole("button")) {
         expect(card).not.toHaveClass(cardStyles.cardDisabled);
      }
      fireEvent.click(hand.getAllByRole("button")[0]);
      expect(takeAction).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(100));
      expect(
         document.querySelector(".hand-card-received")
      ).not.toBeInTheDocument();
      const cards = hand.getAllByRole("button");
      expect(cards.every((button) => !button.hasAttribute("disabled"))).toBe(
         true
      );
      fireEvent.click(cards[0]);
      expect(document.querySelector(".hand-card-discarding .euchre-card")).toBe(
         cards[0]
      );
      expect(cards[0]).toBeDisabled();
      expect(
         document.querySelector(
            '.hand-card-discarding img[src$="/cards/back.svg"]'
         )
      ).not.toBeInTheDocument();
      expect(
         document.querySelector(".hand-card-discarding")
      ).toBeInTheDocument();
      expect(document.querySelector(".opening-flight")).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(400));
      expect(game.phase).toBe("playing");
      expect(game.hands[0]).toHaveLength(5);
      expect(takeAction).toHaveBeenCalledTimes(2);
   });

   it("preserves trick slots and hides the empty hand placeholder after the last card", () => {
      let game = newGame("easy", "You", () => 0.84);
      while (game.hands[0].length > 0) {
         const actions = legalActions(game);
         game = applyAction(
            game,
            actions.find((action) => action.type === "call" && !action.alone) ??
               actions[0]
         );
      }
      board(game);
      const trick = within(
         screen.getByRole("group", { name: "Current trick" })
      );
      expect(trick.getAllByRole("group")).toHaveLength(4);
      expect(
         trick.getByRole("group", { name: "You played" })
      ).toBeInTheDocument();
      const hand = screen.getByRole("region", { name: "Your hand" });
      expect(within(hand).queryAllByRole("button")).toHaveLength(0);
      expect(hand.querySelector(".hand-placeholder")).not.toBeInTheDocument();
   });

   it("omits the sitting-out partner's trick slot during a lone hand", () => {
      let game = newGame("easy", "You", () => 0.84);
      const call = legalActions(game).find(
         (action) => action.type === "call" && action.alone
      )!;
      game = applyAction(game, call);
      while (game.phase !== "playing")
         game = applyAction(game, legalActions(game)[0]);
      board(game);
      const trick = within(
         screen.getByRole("group", { name: "Current trick" })
      );
      expect(trick.getAllByRole("group")).toHaveLength(3);
      expect(
         trick.queryByRole("group", { name: "Partner card slot" })
      ).not.toBeInTheDocument();
   });

   it("shows scores in circles while trump is being decided", () => {
      board(fixture({ scores: [3, 5] }));
      const ours = within(
         screen.getByRole("group", { name: "Your team scoreboard" })
      );
      const theirs = within(
         screen.getByRole("group", { name: "Opponents scoreboard" })
      );
      expect(
         ours.getByRole("img", { name: "Your team: Choosing trump, 3 points" })
      ).toBeInTheDocument();
      expect(
         theirs.getByRole("img", {
            name: "Opponents: Choosing trump, 5 points",
         })
      ).toBeInTheDocument();
      expect(
         ours.getByRole("img", { name: "0 of 5 tricks won" })
      ).toBeInTheDocument();
      expect(
         theirs.getByRole("img", { name: "0 of 5 tricks won" })
      ).toBeInTheDocument();
      expect(
         screen.getByRole("button", { name: "Match details" })
      ).toHaveTextContent("");
   });

   it.each([2, 3] as const)(
      "assigns partnership roles when seat %i calls trump",
      (maker) => {
         board(
            fixture({
               phase: "playing",
               trump: "h",
               maker,
               scores: [3, 5],
               tricks: [1, 2],
            })
         );
         const ours = within(
            screen.getByRole("group", { name: "Your team scoreboard" })
         );
         const theirs = within(
            screen.getByRole("group", { name: "Opponents scoreboard" })
         );
         expect(
            ours.getByRole("img", {
               name: `Your team: ${
                  maker === 2 ? "Makers" : "Defenders"
               }, 3 points`,
            })
         ).toBeInTheDocument();
         expect(
            theirs.getByRole("img", {
               name: `Opponents: ${
                  maker === 2 ? "Defenders" : "Makers"
               }, 5 points`,
            })
         ).toBeInTheDocument();
         expect(
            ours.getByRole("img", { name: "1 of 5 tricks won" })
         ).toBeInTheDocument();
         expect(
            theirs.getByRole("img", { name: "2 of 5 tricks won" })
         ).toBeInTheDocument();
         expect(
            screen.getByRole("img", { name: "hearts trump" })
         ).toBeInTheDocument();
      }
   );

   it("resets trick markers and roles while preserving scores for the next hand", () => {
      let game = newGame("easy", "You", () => 0.84);
      while (game.phase !== "round_complete") {
         const actions = legalActions(game);
         game = applyAction(
            game,
            actions.find((action) => action.type === "call" && !action.alone) ??
               actions[0]
         );
      }
      const scores = game.scores;
      game = applyAction(game, { type: "advance" }, () => 0.5);
      board(game);
      for (const [side, name] of ["Your team", "Opponents"].entries()) {
         const score = within(
            screen.getByRole("group", { name: `${name} scoreboard` })
         );
         expect(
            score.getByRole("img", {
               name: `${name}: Choosing trump, ${scores[side]} points`,
            })
         ).toBeInTheDocument();
         expect(
            score.getByRole("img", { name: "0 of 5 tricks won" })
         ).toBeInTheDocument();
      }
   });

   it("highlights the current player and keeps your player card above the hint", () => {
      board(fixture());
      const you = screen.getByRole("group", { name: "You · Current turn" });
      expect(you).toHaveAttribute("aria-current", "true");
      expect(
         document.querySelectorAll('.player-seat-card[aria-current="true"]')
      ).toHaveLength(1);
      expect(
         you.compareDocumentPosition(
            screen.getByRole("group", { name: "Game status and actions" })
         ) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
         screen.getByRole("img", { name: "Face-down cards beneath the upcard" })
      ).toBeInTheDocument();
   });
   it("keeps the bidding hand readable and sends the selected alone bid", () => {
      vi.useFakeTimers();
      board(fixture());
      const hand = screen.getByRole("region", { name: "Your hand" });
      expect(within(hand).queryAllByRole("button")).toHaveLength(0);
      expect(within(hand).getAllByRole("img")).toHaveLength(5);
      fireEvent.click(screen.getByRole("checkbox", { name: "Go alone" }));
      fireEvent.click(screen.getByRole("button", { name: /Order up/i }));
      expect(takeAction).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(550));
      expect(takeAction).toHaveBeenCalledWith({
         type: "call",
         suit: "s",
         alone: true,
      });
   });

   it("lets the player pass and excludes the turned-down suit in round two", () => {
      board(fixture({ phase: "bidding2" }));
      expect(
         screen.queryByRole("button", { name: /Spades/i })
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Hearts/i }));
      expect(takeAction).toHaveBeenCalledWith({
         type: "call",
         suit: "h",
         alone: false,
      });
      fireEvent.click(screen.getByRole("button", { name: "Pass" }));
      expect(takeAction).toHaveBeenLastCalledWith({ type: "pass" });
   });

   it("allows only cards that follow suit, accounting for the left bower", () => {
      localStorage.setItem(
         "euchre.preferences.v1",
         JSON.stringify({ cardStyle: "classic" })
      );
      board(
         fixture({
            phase: "playing",
            trump: "s",
            maker: 0,
            hands: [["Js", "Jc", "Kc", "Ah"], [], [], []],
            trick: [
               { seat: 1, card: "Qc" },
               { seat: 2, card: "10c" },
               { seat: 3, card: "9c" },
            ],
         })
      );
      expect(screen.getByRole("status")).toHaveTextContent(
         "Your turn · Follow clubs."
      );
      const hand = within(screen.getByRole("region", { name: "Your hand" }));
      expect(
         hand.getByRole("button", { name: "Jack of clubs" })
      ).toBeDisabled();
      expect(
         hand.getByRole("button", { name: "Ace of hearts" })
      ).toBeDisabled();
      const leftBower = hand.getByRole("button", { name: "Jack of clubs" });
      expect(leftBower).toHaveAccessibleDescription(
         "Left bower · spades trump"
      );
      expect(
         leftBower.querySelector('[data-trump-suit="s"]')
      ).toBeInTheDocument();
      expect(
         hand
            .getByRole("button", { name: "Jack of spades" })
            .querySelector('[data-trump-suit="s"]')
      ).toBeInTheDocument();
      expect(
         hand
            .getByRole("button", { name: "King of clubs" })
            .querySelector("[data-trump-suit]")
      ).not.toBeInTheDocument();
      expect(hand.queryByText("Left bower")).not.toBeInTheDocument();
      fireEvent.click(hand.getByRole("button", { name: "King of clubs" }));
      expect(takeAction).toHaveBeenCalledWith({ type: "play", card: "Kc" });
   });

   it("makes all six cards available when the dealer must discard", () => {
      vi.useFakeTimers();
      board(
         fixture({
            phase: "discard",
            dealer: 0,
            trump: "s",
            maker: 1,
            hands: [["9c", "10c", "Jc", "Qd", "Kh", "As"], [], [], []],
         })
      );
      expect(screen.getByRole("status")).toHaveTextContent(
         "Choose a card to discard."
      );
      const hand = within(screen.getByRole("region", { name: "Your hand" }));
      expect(hand.getAllByRole("button")).toHaveLength(6);
      expect(
         hand
            .getAllByRole("button")
            .every((button) => !button.hasAttribute("disabled"))
      ).toBe(true);
      fireEvent.click(hand.getByRole("button", { name: "Ace of spades" }));
      expect(takeAction).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(400));
      expect(takeAction).toHaveBeenCalledWith({ type: "discard", card: "As" });
   });

   it("shows current match details and closes with Escape or a click outside", () => {
      board(
         fixture({
            handNumber: 2,
            scores: [2, 0],
            results: [
               {
                  hand: 1,
                  maker: 0,
                  trump: "h",
                  alone: false,
                  tricks: [5, 0],
                  points: [2, 0],
                  scores: [2, 0],
               },
            ],
         })
      );
      const trigger = screen.getByRole("button", { name: "Match details" });
      fireEvent.click(trigger);
      const panel = screen.getByRole("region", { name: "Match details" });
      expect(within(panel).getByText("Us 2 · Them 0")).toBeInTheDocument();
      expect(within(panel).getByText("2")).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(trigger).toHaveFocus();
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(trigger);
      fireEvent.pointerDown(document.body);
      expect(
         screen.queryByRole("region", { name: "Match details" })
      ).not.toBeInTheDocument();
   });

   it("pauses a pending bot action while match details are expanded", () => {
      vi.useFakeTimers();
      board(fixture({ turn: 1 }));
      act(() => workers[0].onmessage?.({ data: { action: { type: "pass" } } }));
      fireEvent.click(screen.getByRole("button", { name: "Match details" }));
      act(() => vi.advanceTimersByTime(1500));
      expect(takeAction).not.toHaveBeenCalled();
      expect(workers[0].terminate).toHaveBeenCalled();
      fireEvent.pointerDown(document.body);
      act(() =>
         workers.at(-1)!.onmessage?.({ data: { action: { type: "pass" } } })
      );
      act(() => vi.advanceTimersByTime(1500));
      expect(screen.getByText("Passed")).toBeInTheDocument();
      expect(takeAction).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1250));
      expect(takeAction).toHaveBeenCalledWith({ type: "pass" });
   });
});
