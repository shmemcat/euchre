import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Card } from "@/components/Card";
import { useSound } from "@/context/SoundContext";
import type { OpeningStep } from "@/hooks/useOpeningSequence";
import { asset } from "@/lib/assets";

export function OpeningMotion({
   step,
   board,
   paused,
}: {
   step: OpeningStep | null;
   board: RefObject<HTMLElement | null>;
   paused: boolean;
}) {
   const flight = useRef<HTMLDivElement>(null);
   const animation = useRef<Animation | null>(null);
   const sound = useSound();
   const play = useRef(sound.play);
   play.current = sound.play;
   const flying =
      step?.kind === "pickup" || (step?.kind === "discard" && step.seat !== 0);

   useEffect(() => {
      if (flying) play.current("play");
   }, [step, flying]);

   useLayoutEffect(() => {
      if (
         !step ||
         (step.kind !== "pickup" && step.kind !== "discard") ||
         !flight.current ||
         !board.current
      )
         return;
      const root = board.current;
      const handCard = root.querySelector<HTMLElement>(
         `[data-hand-card="${step.card}"] .euchre-card`
      );
      const seatHand = root.querySelector(`.seat-${step.seat} .hidden-hand`);
      const seatTarget =
         seatHand && seatHand.getBoundingClientRect().width > 0
            ? seatHand
            : root.querySelector(`.seat-${step.seat} .player-seat-card`);
      const hand = step.seat === 0 ? handCard : seatTarget;
      const kitty = root.querySelector(".upcard-stack");
      const source = (
         step.kind === "pickup" ? kitty : hand
      )?.getBoundingClientRect();
      const target = (
         step.kind === "pickup" ? hand : kitty
      )?.getBoundingClientRect();
      if (!source || !target) return;
      const element = flight.current;
      const width =
         step.kind === "pickup"
            ? source.width
            : step.seat === 0
            ? source.width
            : 52;
      const height =
         step.kind === "pickup"
            ? source.height
            : step.seat === 0
            ? source.height
            : 73;
      Object.assign(element.style, {
         left: `${source.left + window.scrollX + (source.width - width) / 2}px`,
         top: `${source.top + window.scrollY + (source.height - height) / 2}px`,
         width: `${width}px`,
         height: `${height}px`,
      });
      const reduced = window.matchMedia?.(
         "(prefers-reduced-motion: reduce)"
      ).matches;
      const x = target.left + target.width / 2 - source.left - source.width / 2;
      const y =
         target.top +
         target.height / 2 -
         source.top -
         source.height / 2 -
         (step.kind === "pickup" && step.seat === 0 ? 6 : 0);
      const scale =
         step.kind === "pickup" && step.seat === 0
            ? (handCard?.offsetWidth || target.width) / width
            : step.kind === "discard"
            ? 0.7
            : 0.65;
      const handTransform = handCard?.closest<HTMLElement>(".hand-card");
      const matrix =
         handTransform && typeof DOMMatrix !== "undefined"
            ? new DOMMatrix(getComputedStyle(handTransform).transform)
            : null;
      const rotation =
         step.kind === "pickup" && step.seat === 0
            ? matrix
               ? (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI
               : 0
            : 0;
      animation.current =
         element.animate?.(
            [
               { opacity: 1, transform: "translate(0, 0) scale(1)" },
               {
                  opacity: step.kind === "pickup" && step.seat === 0 ? 1 : 0,
                  transform: reduced
                     ? "translate(0, 0)"
                     : `translate(${x}px, ${y}px) scale(${scale}) rotate(${rotation}deg)`,
               },
            ],
            {
               duration: step.duration,
               easing:
                  step.kind === "pickup"
                     ? "cubic-bezier(0.22, 1, 0.36, 1)"
                     : "ease-in",
               fill: "forwards",
            }
         ) ?? null;
      return () => {
         animation.current?.cancel();
         animation.current = null;
      };
   }, [step, board]);

   useEffect(() => {
      if (paused) animation.current?.pause();
      else animation.current?.play();
   }, [paused, step]);

   if (!flying || !step || (step.kind !== "pickup" && step.kind !== "discard"))
      return null;
   return createPortal(
      <div ref={flight} className="opening-flight" aria-hidden="true">
         {step.kind === "discard" ? (
            <img src={asset("cards/back.svg")} alt="" draggable={false} />
         ) : (
            <Card
               code={step.card}
               trump={step.kind === "pickup" ? step.suit : null}
            />
         )}
      </div>,
      document.body
   );
}
