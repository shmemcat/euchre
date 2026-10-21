import {
   createContext,
   useCallback,
   useContext,
   useEffect,
   useRef,
   useState,
   type ReactNode,
} from "react";
import { asset } from "@/lib/assets";
import { readStorage, writeStorage } from "@/lib/storage";
type Sound = "deal" | "trump" | "play" | "trick" | "round" | "win";
const FILES: Record<Sound, string> = {
   deal: "card-fan-1",
   trump: "trump-chosen-chime",
   play: "card-place-1",
   trick: "cards-sweep-1",
   round: "round-end",
   win: "game-end",
};
const MUSIC_VOLUME_KEY = "euchre.music-volume.v1";
const clampVolume = (value: number) =>
   Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.15;
function readVolume(key: string, fallback: number): number {
   const value = readStorage<unknown>(key, fallback);
   return typeof value === "number" && Number.isFinite(value)
      ? clampVolume(value)
      : fallback;
}
const Context = createContext<{
   muted: boolean;
   setMuted: (v: boolean) => void;
   music: boolean;
   setMusic: (v: boolean) => void;
   volume: number;
   setVolume: (v: number) => void;
   musicVolume: number;
   setMusicVolume: (v: number) => void;
   play: (s: Sound) => void;
} | null>(null);
export function SoundProvider({ children }: { children: ReactNode }) {
   const [muted, setMutedState] = useState(
      () => readStorage<unknown>("euchre.muted.v1", false) === true
   );
   const [music, setMusicState] = useState(
      () => readStorage<unknown>("euchre.music.v1", false) === true
   );
   const [volume, setVolumeState] = useState(() =>
      readVolume("euchre.volume.v1", 0.15)
   );
   const [musicVolume, setMusicVolumeState] = useState(() => {
      const previous = readStorage<unknown>("euchre.volume.v1", null);
      const fallback =
         typeof previous === "number" && Number.isFinite(previous)
            ? clampVolume(previous) * 0.35
            : 0.15;
      return readVolume(MUSIC_VOLUME_KEY, fallback);
   });
   const track = useRef<HTMLAudioElement | null>(null);
   const play = useCallback(
      (sound: Sound) => {
         if (muted) return;
         const audio = new Audio(asset(`sounds/${FILES[sound]}.mp3`));
         audio.volume = volume;
         void audio.play().catch(() => {});
      },
      [muted, volume]
   );
   useEffect(() => {
      const audio = new Audio(
         asset("sounds/abstraction-sketchbook-2025-11-26.ogg")
      );
      audio.loop = true;
      track.current = audio;
      return () => {
         audio.pause();
         track.current = null;
      };
   }, []);
   useEffect(() => {
      const audio = track.current;
      if (!audio) return;
      audio.volume = musicVolume;
      if (music) void audio.play().catch(() => {});
      else audio.pause();
   }, [music, musicVolume]);
   useEffect(() => {
      // Persist the migrated music level before the effects slider changes.
      writeStorage(MUSIC_VOLUME_KEY, musicVolume);
   }, [musicVolume]);
   useEffect(() => {
      // Browsers may defer a remembered music preference until a user gesture.
      const unlock = () => {
         if (music && track.current) void track.current.play().catch(() => {});
      };
      window.addEventListener("pointerdown", unlock);
      window.addEventListener("keydown", unlock);
      return () => {
         window.removeEventListener("pointerdown", unlock);
         window.removeEventListener("keydown", unlock);
      };
   }, [music]);
   const setMuted = (value: boolean) => {
      setMutedState(value);
      writeStorage("euchre.muted.v1", value);
   };
   const setMusic = (value: boolean) => {
      setMusicState(value);
      writeStorage("euchre.music.v1", value);
   };
   const setVolume = (value: number) => {
      const next = clampVolume(value);
      setVolumeState(next);
      writeStorage("euchre.volume.v1", next);
   };
   const setMusicVolume = (value: number) => {
      setMusicVolumeState(clampVolume(value));
   };
   return (
      <Context.Provider
         value={{
            muted,
            setMuted,
            music,
            setMusic,
            volume,
            setVolume,
            musicVolume,
            setMusicVolume,
            play,
         }}
      >
         {children}
      </Context.Provider>
   );
}
export function useSound() {
   const value = useContext(Context);
   if (!value) throw new Error("Missing SoundProvider");
   return value;
}
