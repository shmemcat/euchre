import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
   applyAction,
   newGame,
   suitOf,
   type Action,
   type Game,
} from "@/game/engine";
import { OPENING_DEAL_MS, useOpeningSequence } from "./useOpeningSequence";

const sound = vi.hoisted(() => ({ play: vi.fn() }));
vi.mock("@/context/SoundContext", () => ({ useSound: () => sound }));

const fresh = () => newGame("easy", "You", () => 0.84);
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
function opening(initial: Game) {
   const actions = vi.fn();
   const view = renderHook(() => {
      const [game, setGame] = useState(initial);
      const [paused, setPaused] = useState(false);
      const sequence = useOpeningSequence(
         game,
         (action) => {
            actions(action);
            setGame((current) => applyAction(current, action));
         },
         paused
      );
      return { ...sequence, game, setGame, setPaused };
   });
   return {
      ...view,
      actions,
      perform: (action: Action) =>
         act(() => view.result.current.perform(action)),
   };
}
beforeEach(() => {
   vi.useFakeTimers();
   sound.play.mockReset();
});
afterEach(() => {
   vi.useRealTimers();
   vi.unstubAllGlobals();
});

describe("Opening sequence", () => {
   it("shows a fresh hand immediately when reduced motion is requested", () => {
      vi.stubGlobal("matchMedia", () => ({ matches: true }));
      const view = opening(fresh());
      expect(view.result.current.step).toBeNull();
      expect(view.result.current.busy).toBe(false);
   });
   it("holds bidding for the complete deal, kitty flip and hand reveal", () => {
      const view = opening(fresh());
      expect(view.result.current.step?.kind).toBe("deal");
      view.perform({ type: "pass" });
      advance(OPENING_DEAL_MS - 1);
      expect(view.result.current.busy).toBe(true);
      expect(view.actions).not.toHaveBeenCalled();
      expect(sound.play).not.toHaveBeenCalled();
      advance(1);
      expect(view.result.current.busy).toBe(false);
      view.perform({ type: "pass" });
      expect(view.actions).toHaveBeenCalledExactlyOnceWith({ type: "pass" });
      expect(sound.play).toHaveBeenCalledExactlyOnceWith("pass");
      expect(view.result.current.game.passes).toBe(1);
      expect(view.result.current.step).toBeNull();
   });

   it("shows a bot pass before advancing and ignores duplicate actions", () => {
      const view = opening(applyAction(fresh(), { type: "pass" }));
      view.perform({ type: "pass" });
      expect(view.result.current.step).toMatchObject({
         kind: "bid",
         text: "Passed",
         seat: 1,
      });
      view.perform({ type: "pass" });
      advance(1249);
      expect(sound.play).toHaveBeenCalledExactlyOnceWith("pass");
      expect(view.actions).not.toHaveBeenCalled();
      advance(1);
      expect(view.actions).toHaveBeenCalledTimes(1);
      expect(view.result.current.game.turn).toBe(2);
   });

   it("sounds every human and bot pass in both bidding rounds", () => {
      const view = opening(fresh());
      advance(OPENING_DEAL_MS);
      for (let i = 0; i < 8; i++) {
         view.perform({ type: "pass" });
         expect(sound.play).toHaveBeenCalledTimes(i + 1);
         expect(sound.play).toHaveBeenLastCalledWith("pass");
         advance(1250);
         advance(800);
      }
      expect(view.result.current.game.phase).toBe("round_complete");
   });

   it("finishes the final pass badge before tucking and flipping the kitty", () => {
      let game = fresh();
      for (let i = 0; i < 3; i++) game = applyAction(game, { type: "pass" });
      const view = opening(game);
      view.perform({ type: "pass" });
      advance(1250);
      expect(view.result.current.step?.kind).toBe("turn-down");
      expect(view.result.current.game.phase).toBe("bidding1");
      advance(799);
      expect(view.actions).not.toHaveBeenCalled();
      advance(1);
      expect(view.result.current.game.phase).toBe("bidding2");
      expect(view.result.current.busy).toBe(false);
   });

   it("sweeps the upcard to the dealer, then settles it in your six-card hand", () => {
      const view = opening({ ...fresh(), dealer: 0, turn: 1, passes: 1 });
      const suit = suitOf(view.result.current.game.upCard);
      view.perform({ type: "call", suit, alone: false });
      expect(view.result.current.step).toMatchObject({
         kind: "bid",
         text: "Ordered Up",
         seat: 1,
      });
      advance(1250);
      expect(view.result.current.step).toMatchObject({
         kind: "pickup",
         seat: 0,
      });
      expect(view.result.current.game.hands[0]).toHaveLength(5);
      advance(550);
      expect(view.result.current.game.phase).toBe("discard");
      expect(view.result.current.game.hands[0]).toHaveLength(6);
      expect(view.result.current.step?.kind).toBe("receive");
      view.perform({
         type: "discard",
         card: view.result.current.game.hands[0][0],
      });
      expect(view.actions).toHaveBeenCalledTimes(1);
      advance(99);
      expect(view.result.current.busy).toBe(true);
      advance(1);
      expect(view.result.current.busy).toBe(false);
      view.perform({
         type: "discard",
         card: view.result.current.game.hands[0][0],
      });
      expect(view.result.current.step?.kind).toBe("discard");
      advance(399);
      expect(view.result.current.game.hands[0]).toHaveLength(6);
      advance(1);
      expect(view.result.current.game.phase).toBe("playing");
      expect(view.result.current.game.hands[0]).toHaveLength(5);
      expect(view.actions).toHaveBeenCalledTimes(2);
   });

   it("sends an upcard ordered by you to the bot dealer", () => {
      const view = opening({ ...fresh(), passes: 1 });
      view.perform({
         type: "call",
         suit: suitOf(view.result.current.game.upCard),
         alone: false,
      });
      expect(view.result.current.step).toMatchObject({
         kind: "pickup",
         seat: 3,
      });
      advance(550);
      expect(view.result.current.game.turn).toBe(3);
      expect(view.result.current.game.hands[3]).toHaveLength(6);
      expect(view.result.current.busy).toBe(false);
   });

   it("announces a second-round suit without picking up the turned-down card", () => {
      let game = fresh();
      for (let i = 0; i < 5; i++) game = applyAction(game, { type: "pass" });
      const view = opening(game);
      const suit = game.upCard.endsWith("h") ? "s" : "h";
      view.perform({ type: "call", suit, alone: false });
      expect(view.result.current.step).toMatchObject({ kind: "bid", suit });
      advance(1250);
      expect(view.result.current.game.phase).toBe("playing");
      expect(view.result.current.game.hands[game.dealer]).toHaveLength(5);
      expect(view.result.current.step).toBeNull();
   });

   it("waits at the no-calls summary before fanning a redeal for the same dealer", () => {
      let game = fresh();
      for (let i = 0; i < 7; i++) game = applyAction(game, { type: "pass" });
      const view = opening(game);
      view.perform({ type: "pass" });
      advance(1250);
      expect(view.result.current.game.phase).toBe("round_complete");
      expect(view.result.current.game.message).toBe("No calls — Re-deal");
      expect(view.result.current.step).toBeNull();
      view.perform({ type: "advance" });
      expect(view.result.current.game.handNumber).toBe(2);
      expect(view.result.current.game.dealer).toBe(game.dealer);
      expect(view.result.current.step?.kind).toBe("deal");
   });

   it("preserves the remaining animation time while match details are open", () => {
      const view = opening(applyAction(fresh(), { type: "pass" }));
      view.perform({ type: "pass" });
      advance(400);
      act(() => view.result.current.setPaused(true));
      advance(5000);
      expect(view.actions).not.toHaveBeenCalled();
      act(() => view.result.current.setPaused(false));
      advance(849);
      expect(view.actions).not.toHaveBeenCalled();
      advance(1);
      expect(view.actions).toHaveBeenCalledTimes(1);
   });

   it("cancels pending actions on unmount or replacement of the game", () => {
      const view = opening(applyAction(fresh(), { type: "pass" }));
      view.perform({ type: "pass" });
      act(() => view.result.current.setGame({ ...fresh(), passes: 1 }));
      advance(2000);
      expect(view.actions).not.toHaveBeenCalled();
      view.perform({
         type: "call",
         suit: suitOf(view.result.current.game.upCard),
         alone: false,
      });
      view.unmount();
      advance(3000);
      expect(view.actions).not.toHaveBeenCalled();
   });
});
