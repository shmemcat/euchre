import { act, render } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "@/context/PreferencesContext";
import { newGame, type Seat } from "@/game/engine";
import { Trick } from "./Trick";

vi.mock("@/context/SoundContext", () => ({
   useSound: () => ({ play: vi.fn() }),
}));

const originalAnimate = Object.getOwnPropertyDescriptor(
   Element.prototype,
   "animate"
);
const animations: {
   cancel: ReturnType<typeof vi.fn>;
   pause: ReturnType<typeof vi.fn>;
   play: ReturnType<typeof vi.fn>;
}[] = [];
const animate = vi.fn(function (
   this: Element,
   _frames: Keyframe[],
   _options: KeyframeAnimationOptions
) {
   const animation = { cancel: vi.fn(), pause: vi.fn(), play: vi.fn() };
   animations.push(animation);
   return animation as unknown as Animation;
});

beforeEach(() => {
   vi.useFakeTimers();
   animations.length = 0;
   animate.mockClear();
   Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: animate,
   });
});

afterEach(() => {
   if (originalAnimate)
      Object.defineProperty(Element.prototype, "animate", originalAnimate);
   else Reflect.deleteProperty(Element.prototype, "animate");
   vi.useRealTimers();
   vi.unstubAllGlobals();
});

function collection(winner: Seat, mobile = false, reducedMotion = false) {
   const positions = mobile
      ? [
           [66, 135],
           [4, 60],
           [66, 0],
           [128, 60],
        ]
      : [
           [106, 200],
           [0, 100],
           [106, 0],
           [212, 100],
        ];
   vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
         const seat = Number(
            this.parentElement?.className.match(/trick-slot-(\d)/)?.[1] ?? 0
         );
         const [x, y] = positions[seat];
         return new DOMRect(x, y, mobile ? 52 : 72, mobile ? 73 : 100);
      }
   );
   vi.stubGlobal("matchMedia", () => ({ matches: reducedMotion }));
   const plays = ([0, 1, 2, 3] as Seat[]).map((seat) => ({
      seat,
      card: "9c" as const,
   }));
   const game = {
      ...newGame("easy", "You"),
      phase: "trick_complete" as const,
      turn: winner,
      trick: plays,
      completedTricks: [{ plays, winner }],
   };
   const onCollected = vi.fn();
   const content = (paused = false) => (
      <PreferencesProvider>
         <Trick game={game} paused={paused} onCollected={onCollected} />
      </PreferencesProvider>
   );
   const view = render(content());
   act(() => vi.advanceTimersByTime(1000));
   return {
      ...view,
      positions,
      pause: () => view.rerender(content(true)),
      resume: () => view.rerender(content()),
   };
}

describe("Trick sweep motion", () => {
   it.each(
      ([0, 1, 2, 3] as Seat[]).flatMap((winner) =>
         [false, true].map((mobile) => ({ winner, mobile }))
      )
   )(
      "swoops to seat $winner using the rendered slot positions (mobile=$mobile)",
      ({ winner, mobile }) => {
         const view = collection(winner, mobile);
         expect(animate).toHaveBeenCalledTimes(4);
         animate.mock.calls.forEach(([frames, options], seat) => {
            const x = view.positions[winner][0] - view.positions[seat][0];
            const y = view.positions[winner][1] - view.positions[seat][1];
            expect(frames.at(-1)).toEqual({
               opacity: 0,
               transform: `translate(${x}px, ${y}px)`,
            });
            expect(frames).toHaveLength(x && y ? 3 : 2);
            expect(options).toEqual({
               duration: 350,
               easing: "ease-in",
               fill: "forwards",
            });
         });
         view.pause();
         expect(
            animations.every(
               (animation) => animation.pause.mock.calls.length === 1
            )
         ).toBe(true);
         view.resume();
         expect(animate).toHaveBeenCalledTimes(4);
         view.unmount();
         expect(
            animations.every(
               (animation) => animation.cancel.mock.calls.length === 1
            )
         ).toBe(true);
      }
   );

   it("fades without moving when reduced motion is preferred", () => {
      collection(0, false, true);
      for (const [frames] of animate.mock.calls) {
         expect(frames).toHaveLength(2);
         expect(frames.at(-1)).toEqual({
            opacity: 0,
            transform: "translate(0px, 0px)",
         });
      }
   });
});
