import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "@/context/PreferencesContext";
import { useGame } from "@/context/GameContext";
import { applyAction, legalActions, newGame, type Game } from "@/game/engine";
import GamePage from "./GamePage";

vi.mock("@/context/GameContext", () => ({ useGame: vi.fn() }));
vi.mock("@/components/Navbar", () => ({
   Navbar: () => <nav aria-label="Main navigation" />,
}));
const sound = vi.hoisted(() => ({ play: vi.fn() }));
vi.mock("@/context/SoundContext", () => ({ useSound: () => sound }));

const takeAction = vi.fn();
const workers: TestWorker[] = [];
class TestWorker {
   onmessage: ((event: { data: { action: { type: "pass" } } }) => void) | null =
      null;
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
      ...overrides,
   };
}

function board(game: Game) {
   vi.mocked(useGame).mockReturnValue({
      game,
      act: takeAction,
      saved: true,
      error: "",
      start: vi.fn(),
      concedeGame: vi.fn(),
   });
   return render(
      <HelmetProvider>
         <MemoryRouter>
            <PreferencesProvider>
               <GamePage />
            </PreferencesProvider>
         </MemoryRouter>
      </HelmetProvider>
   );
}

beforeEach(() => {
   takeAction.mockReset();
   workers.length = 0;
   vi.stubGlobal("Worker", TestWorker);
});
afterEach(() => {
   vi.useRealTimers();
   vi.unstubAllGlobals();
});

describe("Quiet Table game controls", () => {
   it("preserves trick slots and an empty hand slot after the last card is played", () => {
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
      expect(hand.querySelector(".hand-placeholder")).toBeInTheDocument();
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
      board(fixture());
      const hand = screen.getByRole("region", { name: "Your hand" });
      expect(within(hand).queryAllByRole("button")).toHaveLength(0);
      expect(within(hand).getAllByRole("img")).toHaveLength(5);
      fireEvent.click(screen.getByRole("checkbox", { name: "Go alone" }));
      fireEvent.click(screen.getByRole("button", { name: /Order up/i }));
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
      expect(leftBower).toHaveAccessibleDescription("Left bower · spades trump");
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
      expect(takeAction).toHaveBeenCalledWith({ type: "pass" });
   });
});
