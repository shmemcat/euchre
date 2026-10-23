import { useRef } from "react";
import { render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DealMotion } from "./DealMotion";
import { act } from "@testing-library/react";
import {
   DEAL_DURATION_MS,
   DEAL_KITTY_START_MS,
   DEAL_PACKET_STARTS_MS,
   DEAL_SHUFFLE_MS,
} from "@/lib/dealAnimation";

const sound = vi.hoisted(() => ({ play: vi.fn() }));
vi.mock("@/context/SoundContext", () => ({ useSound: () => sound }));

const originalAnimate = Element.prototype.animate;
afterEach(() => {
   Element.prototype.animate = originalAnimate;
   vi.useRealTimers();
   sound.play.mockReset();
});

it("plays one fan before the deal, then once per packet and kitty group", () => {
   vi.useFakeTimers();
   render(<DealMotion dealer={0} board={{ current: null }} paused={false} />);
   act(() => vi.advanceTimersByTime(0));
   expect(sound.play).toHaveBeenCalledExactlyOnceWith("deal");
   act(() => vi.advanceTimersByTime(DEAL_SHUFFLE_MS));
   expect(sound.play).toHaveBeenCalledExactlyOnceWith("deal");
   let elapsed = DEAL_SHUFFLE_MS;
   for (const [packet, start] of DEAL_PACKET_STARTS_MS.entries()) {
      act(() => vi.advanceTimersByTime(start - elapsed));
      expect(sound.play).toHaveBeenCalledTimes(packet + 2);
      // The other cards in this packet leave 45/90ms later without extra sounds.
      act(() => vi.advanceTimersByTime(100));
      expect(sound.play).toHaveBeenCalledTimes(packet + 2);
      elapsed = start + 100;
   }
   act(() => vi.advanceTimersByTime(DEAL_KITTY_START_MS - elapsed));
   expect(sound.play).toHaveBeenCalledTimes(10);
   expect(
      sound.play.mock.calls.slice(1).every(([name]) => name === "shuffle")
   ).toBe(true);
   act(() => vi.advanceTimersByTime(DEAL_DURATION_MS));
   expect(sound.play).toHaveBeenCalledTimes(10);
});

it("pauses during shuffling and resumes the same animations without replaying sounds", () => {
   vi.useFakeTimers();
   const animations: {
      pause: ReturnType<typeof vi.fn>;
      play: ReturnType<typeof vi.fn>;
      cancel: ReturnType<typeof vi.fn>;
      finish: ReturnType<typeof vi.fn>;
   }[] = [];
   const animate = vi.fn(() => {
      const animation = {
         pause: vi.fn(),
         play: vi.fn(),
         cancel: vi.fn(),
         finish: vi.fn(),
      };
      animations.push(animation);
      return animation as unknown as Animation;
   });
   Element.prototype.animate = animate;
   function Table({ paused }: { paused: boolean }) {
      const board = useRef<HTMLDivElement>(null);
      return (
         <div ref={board}>
            <div className="upcard-stack" />
            {[0, 1, 2, 3].map((seat) => (
               <div key={seat} className={`seat-${seat}`}>
                  <div className="player-seat-card" />
                  <div className="hidden-hand">
                     {[0, 1, 2, 3, 4].map((card) => (
                        <span key={card} data-deal-card={card} />
                     ))}
                  </div>
               </div>
            ))}
            <div className="player-hand">
               <div className="hand-card" />
            </div>
            <DealMotion dealer={2} board={board} paused={paused} />
         </div>
      );
   }
   const view = render(<Table paused={false} />);
   expect(animations).toHaveLength(30);
   act(() => vi.advanceTimersByTime(DEAL_SHUFFLE_MS / 2));
   expect(sound.play.mock.calls).toEqual([["deal"]]);
   view.rerender(<Table paused />);
   act(() => vi.advanceTimersByTime(5000));
   expect(sound.play).toHaveBeenCalledTimes(1);
   expect(
      animations.every((animation) => animation.pause.mock.calls.length === 1)
   ).toBe(true);
   view.rerender(<Table paused={false} />);
   act(() =>
      vi.advanceTimersByTime(DEAL_PACKET_STARTS_MS[0] - DEAL_SHUFFLE_MS / 2)
   );
   expect(sound.play.mock.calls).toEqual([["deal"], ["shuffle"]]);
   act(() => vi.advanceTimersByTime(250));
   expect(sound.play.mock.calls).toEqual([["deal"], ["shuffle"], ["shuffle"]]);
   expect(animate).toHaveBeenCalledTimes(30);
   expect(
      animations.every((animation) => animation.play.mock.calls.length === 2)
   ).toBe(true);
   view.unmount();
   act(() => vi.advanceTimersByTime(5000));
   expect(sound.play).toHaveBeenCalledTimes(3);
   expect(
      animations.every((animation) => animation.cancel.mock.calls.length === 1)
   ).toBe(true);
});
