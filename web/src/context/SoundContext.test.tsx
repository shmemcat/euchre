import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SoundProvider, useSound } from "./SoundContext";
import { writeStorage } from "@/lib/storage";

let players: TestAudio[];
class TestAudio {
   volume = 1;
   loop = false;
   play = vi.fn(() => Promise.resolve());
   pause = vi.fn();
   constructor(public src: string) {
      players.push(this);
   }
}
const renderSound = () =>
   renderHook(useSound, {
      wrapper: ({ children }: { children: ReactNode }) => (
         <SoundProvider>{children}</SoundProvider>
      ),
   });

beforeEach(() => {
   players = [];
   vi.stubGlobal("Audio", TestAudio);
});
afterEach(() => vi.unstubAllGlobals());

describe("Independent audio controls", () => {
   it("randomly chooses the short single-tap clips for deal groups", () => {
      const { result } = renderSound();
      vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.99);
      act(() => result.current.play("shuffle"));
      act(() => result.current.play("shuffle"));
      expect(players.slice(-2).map((audio) => audio.src)).toEqual([
         "/sounds/card-deal-group-1.mp3",
         "/sounds/card-deal-group-2.mp3",
      ]);
   });
   it("changes music and effects volume independently during playback", () => {
      const { result } = renderSound();
      const music = players.find((audio) => audio.loop)!;
      act(() => {
         result.current.setMusic(true);
         result.current.setMusicVolume(0.25);
         result.current.setVolume(0.8);
      });
      act(() => result.current.play("deal"));
      expect(music.volume).toBe(0.25);
      expect(players.at(-1)!.volume).toBe(0.8);

      act(() => result.current.setVolume(0.4));
      expect(music.volume).toBe(0.25);
      act(() => result.current.setMusicVolume(0.6));
      act(() => result.current.play("play"));
      expect(music.volume).toBe(0.6);
      expect(players.at(-1)!.volume).toBe(0.4);
   });

   it("preserves the old music level across reloads after effects change", () => {
      writeStorage("euchre.volume.v1", 0.6);
      writeStorage("euchre.music.v1", true);
      const first = renderSound();
      expect(first.result.current.musicVolume).toBeCloseTo(0.21);
      act(() => first.result.current.setVolume(0.1));
      first.unmount();

      const second = renderSound();
      expect(second.result.current.volume).toBe(0.1);
      expect(second.result.current.musicVolume).toBeCloseTo(0.21);
      act(() => second.result.current.setMusicVolume(0.55));
      second.unmount();
      expect(renderSound().result.current.musicVolume).toBe(0.55);
   });

   it("mutes effects and music independently", () => {
      const { result } = renderSound();
      const music = players.find((audio) => audio.loop)!;
      act(() => {
         result.current.setMuted(true);
         result.current.setMusic(true);
      });
      act(() => result.current.play("deal"));
      expect(music.play).toHaveBeenCalled();
      expect(players).toHaveLength(1);

      act(() => {
         result.current.setMusic(false);
         result.current.setMuted(false);
      });
      act(() => result.current.play("deal"));
      expect(music.pause).toHaveBeenCalled();
      expect(players).toHaveLength(2);
      expect(players[1].play).toHaveBeenCalled();
   });
});
