import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAction, newGame, suitOf, type Game } from "@/game/engine";
import { useMultiplayerOpeningSequence } from "./useMultiplayerOpeningSequence";
import { OPENING_DEAL_MS } from "./useOpeningSequence";

const sound = vi.hoisted(() => ({ play: vi.fn() }));
vi.mock("@/context/SoundContext", () => ({ useSound: () => sound }));

const fresh = (): Game => ({
   ...newGame("easy", "You", () => 0.84),
   dealer: 0,
   turn: 1,
   passes: 1,
});
// Match the service: opponents' hands contain only null placeholders.
const redact = (game: Game): Game => ({
   ...game,
   hands: game.hands.map((hand, seat) =>
      seat === 0 ? hand : Array(hand.length).fill(null)
   ),
   kitty: [],
});
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const call = (game: Game) =>
   applyAction(game, { type: "call", suit: suitOf(game.upCard), alone: false });

function opening(initial: Game) {
   const actions = vi.fn();
   let props = { game: redact(initial), paused: false, disabled: false };
   const view = renderHook(
      ({ game, paused, disabled }) =>
         useMultiplayerOpeningSequence(game, actions, paused, disabled),
      { initialProps: props }
   );
   const configure = (next: Partial<typeof props>) => {
      props = { ...props, ...next };
      view.rerender(props);
   };
   return {
      ...view,
      actions,
      configure,
      server(game: Game) {
         const snapshot = redact(game);
         configure({ game: snapshot });
         return snapshot;
      },
   };
}

beforeEach(() => {
   vi.useFakeTimers();
   sound.play.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("Multiplayer opening playback", () => {
   it("sounds each confirmed pass once for every seat in both bidding rounds", () => {
      let game = { ...fresh(), passes: 0 };
      const view = opening(game);
      advance(OPENING_DEAL_MS);
      expect(sound.play).not.toHaveBeenCalled();
      for (let i = 0; i < 8; i++) {
         act(() => view.result.current.perform({ type: "pass" }));
         expect(sound.play).toHaveBeenCalledTimes(i);
         game = applyAction(game, { type: "pass" });
         view.server(game);
         expect(sound.play).toHaveBeenCalledTimes(i + 1);
         expect(sound.play).toHaveBeenLastCalledWith("pass");
         view.server({ ...game });
         advance(2050);
         expect(sound.play).toHaveBeenCalledTimes(i + 1);
      }
      expect(view.result.current.game?.phase).toBe("round_complete");
   });

   it("announces another player's order and receives the upcard before allowing a discard", () => {
      const game = fresh();
      const view = opening(game);
      const target = view.server(call(game));
      expect(view.result.current.step).toMatchObject({
         kind: "bid",
         text: "Ordered Up",
         seat: 1,
      });
      expect(sound.play).toHaveBeenCalledExactlyOnceWith("trump");
      expect(view.result.current.game?.hands[0]).toHaveLength(5);
      advance(1250);
      expect(view.result.current.step).toMatchObject({
         kind: "pickup",
         seat: 0,
      });
      advance(550);
      expect(view.result.current.game).toBe(target);
      expect(view.result.current.step?.kind).toBe("receive");
      act(() =>
         view.result.current.perform({
            type: "discard",
            card: game.hands[0][0],
         })
      );
      expect(view.actions).not.toHaveBeenCalled();
      advance(100);
      expect(view.result.current.busy).toBe(false);
      act(() =>
         view.result.current.perform({
            type: "discard",
            card: game.hands[0][0],
         })
      );
      expect(view.actions).toHaveBeenCalledOnce();
      expect(sound.play).toHaveBeenCalledOnce();
   });

   it("queues a hidden dealer discard and subsequent play while the order is still being announced", () => {
      const game = { ...fresh(), dealer: 3 as const };
      const view = opening(game);
      const ordered = call(game);
      const discarded = applyAction(ordered, {
         type: "discard",
         card: ordered.hands[3][0],
      });
      const played = applyAction(discarded, {
         type: "play",
         card: discarded.hands[0][0],
      });
      view.server(ordered);
      // Connection/status broadcasts must not cancel or replay an animation.
      view.server({
         ...ordered,
         seatNames: ["You", "West", "Partner", "East"],
      });
      view.server(discarded);
      const latest = view.server(played);
      advance(1250);
      expect(view.result.current.step).toMatchObject({
         kind: "pickup",
         seat: 3,
      });
      advance(550);
      expect(view.result.current.step).toMatchObject({
         kind: "discard",
         seat: 3,
         card: null,
      });
      expect(view.result.current.game?.phase).toBe("discard");
      advance(400);
      expect(view.result.current.step).toBeNull();
      expect(view.result.current.game).toBe(latest);
      expect(view.actions).not.toHaveBeenCalled();
      expect(sound.play).toHaveBeenCalledExactlyOnceWith("trump");
   });

   it("sends your order immediately and animates only after the server accepts it", () => {
      const game = { ...fresh(), dealer: 3 as const, turn: 0 as const };
      const view = opening(game);
      const action = {
         type: "call" as const,
         suit: suitOf(game.upCard),
         alone: false,
      };
      act(() => view.result.current.perform(action));
      expect(view.actions).toHaveBeenCalledExactlyOnceWith(action);
      expect(view.result.current.step).toBeNull();
      const target = view.server(call(game));
      expect(view.result.current.step?.kind).toBe("pickup");
      advance(550);
      expect(view.result.current.game).toBe(target);
      expect(view.result.current.busy).toBe(false);
      expect(view.actions).toHaveBeenCalledOnce();
   });

   it("keeps your chosen discard visible until its animation finishes", () => {
      const ordered = call(fresh());
      const view = opening(ordered);
      const card = ordered.hands[0][0];
      const target = view.server(
         applyAction(ordered, { type: "discard", card })
      );
      expect(view.result.current.step).toMatchObject({
         kind: "discard",
         seat: 0,
         card,
      });
      expect(view.result.current.game?.hands[0]).toContain(card);
      advance(400);
      expect(view.result.current.game).toBe(target);
      expect(view.result.current.game?.hands[0]).not.toContain(card);
   });

   it("finishes the final pass announcement before turning down the kitty", () => {
      const game = {
         ...fresh(),
         dealer: 1 as const,
         turn: 1 as const,
         passes: 3,
      };
      const view = opening(game);
      const target = view.server(applyAction(game, { type: "pass" }));
      expect(view.result.current.step).toMatchObject({
         kind: "bid",
         text: "Passed",
      });
      advance(1250);
      expect(view.result.current.step?.kind).toBe("turn-down");
      expect(view.result.current.game?.phase).toBe("bidding1");
      advance(800);
      expect(view.result.current.game).toBe(target);
   });

   it("announces the final pass before showing the summary and fans the confirmed redeal", () => {
      let game = newGame("easy", "You", () => 0.84);
      for (let i = 0; i < 7; i++) game = applyAction(game, { type: "pass" });
      const view = opening(game);
      const summary = applyAction(game, { type: "pass" });
      view.server(summary);
      expect(view.result.current.step).toMatchObject({ kind: "bid", text: "Passed" });
      expect(view.result.current.game?.phase).toBe("bidding2");
      advance(1250);
      expect(view.result.current.game?.message).toBe("No calls — Re-deal");
      expect(view.result.current.step).toBeNull();
      const redeal = view.server(applyAction(summary, { type: "advance" }));
      expect(view.result.current.game).toBe(redeal);
      expect(redeal.dealer).toBe(game.dealer);
      expect(view.result.current.step?.kind).toBe("deal");
   });

   it("announces second-round trump without picking up the kitty", () => {
      const game = { ...fresh(), phase: "bidding2" as const };
      const view = opening(game);
      const suit = suitOf(game.upCard) === "h" ? "s" : "h";
      const target = view.server(
         applyAction(game, { type: "call", suit, alone: true })
      );
      expect(view.result.current.step).toMatchObject({ kind: "bid", suit });
      advance(1250);
      expect(view.result.current.step).toBeNull();
      expect(view.result.current.game).toBe(target);
   });

   it("sounds your confirmed second-round call even though it needs no flight or toast", () => {
      const game = { ...fresh(), phase: "bidding2" as const, turn: 0 as const };
      const view = opening(game);
      const suit = suitOf(game.upCard) === "h" ? "s" : "h";
      const target = view.server(
         applyAction(game, { type: "call", suit, alone: false })
      );
      expect(view.result.current.step).toBeNull();
      expect(view.result.current.game).toBe(target);
      expect(sound.play).toHaveBeenCalledExactlyOnceWith("trump");
      view.server({ ...target });
      expect(sound.play).toHaveBeenCalledOnce();
   });

   it("preserves the remaining time and queued updates while match details are open", () => {
      const game = fresh();
      const view = opening(game);
      const ordered = call(game);
      view.server(ordered);
      advance(400);
      view.configure({ paused: true });
      view.server({ ...ordered });
      advance(5000);
      expect(view.result.current.step?.kind).toBe("bid");
      view.configure({ paused: false });
      advance(849);
      expect(view.result.current.step?.kind).toBe("bid");
      advance(1);
      expect(view.result.current.step?.kind).toBe("pickup");
      advance(550);
      advance(100);
      expect(view.result.current.busy).toBe(false);
      expect(sound.play).toHaveBeenCalledOnce();
   });

   it("fans new hands and queues updates that arrive during the deal", () => {
      const game = { ...fresh(), passes: 0 };
      const view = opening(game);
      expect(view.result.current.step?.kind).toBe("deal");
      view.server(applyAction(game, { type: "pass" }));
      expect(sound.play).not.toHaveBeenCalled();
      advance(OPENING_DEAL_MS);
      expect(sound.play).toHaveBeenCalledExactlyOnceWith("pass");
      expect(view.result.current.step).toMatchObject({
         kind: "bid",
         text: "Passed",
      });
      advance(1250);
      view.server({ ...game, handNumber: 2 });
      expect(view.result.current.step?.kind).toBe("deal");
   });

   it("clears stale playback for a replacement game or forced game end", () => {
      const game = fresh();
      const view = opening(game);
      view.server(call(game));
      view.server({ ...fresh(), id: "replacement" });
      advance(5000);
      expect(view.result.current.step).toBeNull();
      expect(view.result.current.game?.id).toBe("replacement");
      view.server(call({ ...game, id: "replacement" }));
      view.server({ ...game, id: "replacement", phase: "game_over" });
      expect(view.result.current.step).toBeNull();
      expect(view.result.current.game?.phase).toBe("game_over");
      expect(view.actions).not.toHaveBeenCalled();
   });

   it("blocks commands while disconnected or awaiting an acknowledgment", () => {
      const view = opening(fresh());
      view.configure({ disabled: true });
      act(() => view.result.current.perform({ type: "pass" }));
      expect(view.actions).not.toHaveBeenCalled();
      view.configure({ disabled: false });
      act(() => view.result.current.perform({ type: "pass" }));
      expect(view.actions).toHaveBeenCalledExactlyOnceWith({ type: "pass" });
   });
});
