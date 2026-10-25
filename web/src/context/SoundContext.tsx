import {
   createContext,
   useCallback,
   useContext,
   useEffect,
   useRef,
   useState,
   type ReactNode,
} from "react";
import { Howl } from "howler";
import { asset } from "@/lib/assets";
import { readStorage, writeStorage } from "@/lib/storage";
import { requestMusicPlayback } from "@/lib/musicPlayback";
type Sound =
   | "turn"
   | "playerJoin"
   | "notification"
   | "deal"
   | "shuffle"
   | "trump"
   | "pass"
   | "play"
   | "select"
   | "trick"
   | "round"
   | "win";
const FILES: Record<Sound, string[]> = {
   turn: ["sound-on"],
   playerJoin: ["join-ding"],
   notification: ["notification"],
   deal: ["card-fan-1"],
   // Short single taps keep adjacent deal packets from sounding like extra cards.
   shuffle: ["card-deal-group-1", "card-deal-group-2"],
   trump: ["trump-chosen-chime"],
   pass: ["pass"],
   play: [
      "card-slide-1",
      "card-slide-2",
      "card-slide-3",
      "card-slide-4",
      "card-slide-5",
      "card-slide-6",
      "card-slide-7",
      "card-slide-8",
   ],
   select: ["card-place-1", "card-place-2"],
   trick: ["cards-sweep-1", "cards-sweep-2"],
   round: ["round-end"],
   win: ["game-end"],
};
const MUSIC_FILES = [
   "sonican-jazzy-lofi-calm-background-loop-541849.mp3",
   "zephiramusic-jazzy-lofi-613380.mp3",
   "alex-morgan-lofi-coffee-shop-568150.mp3",
   "zephiramusic-lofi-beats-580208.mp3",
   "zephiramusic-lofi-focus-606303.mp3",
   "zephiramusic-chill-lofi-585360.mp3",
   "alex-morgan-lofi-restaurant-568157.mp3",
   "velariomusic-lofi-relaxing-598427.mp3",
   "zephiramusic-lofi-soul-588903.mp3",
   "zephiramusic-tokyo-lofi-604786.mp3",
];
function shuffleMusic(previous?: string): string[] {
   const files = [...MUSIC_FILES];
   for (let index = files.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [files[index], files[other]] = [files[other], files[index]];
   }
   // Avoid repeating the last song when a new round begins.
   if (files[0] === previous) {
      const other = 1 + Math.floor(Math.random() * (files.length - 1));
      [files[0], files[other]] = [files[other], files[0]];
   }
   return files;
}
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
   const track = useRef<Howl | null>(null);
   const ownsMusic = useRef(false);
   const musicId = useRef<number | undefined>(undefined);
   const resumeMusic = useCallback(() => {
      const audio = track.current;
      if (audio && !audio.playing()) {
         musicId.current = audio.play(musicId.current);
      }
   }, []);
   const musicEnabled = useRef(music);
   musicEnabled.current = music;
   const musicLevel = useRef(musicVolume);
   musicLevel.current = musicVolume;
   const play = useCallback(
      (sound: Sound) => {
         if (muted) return;
         const files = FILES[sound];
         const file = files[Math.floor(Math.random() * files.length)];
         const audio = new Audio(asset(`sounds/${file}.mp3`));
         audio.volume = volume;
         void audio.play().catch(() => {});
      },
      [muted, volume]
   );
   useEffect(() => {
      let remaining: string[] = [];
      let previous: string | undefined;
      const loadNextTrack = (): Howl => {
         if (remaining.length === 0) remaining = shuffleMusic(previous);
         const file = remaining.shift()!;
         previous = file;
         musicId.current = undefined;
         const audio = new Howl({
            src: [asset(`music/${file}`)],
            loop: false,
            preload: true,
            volume: musicLevel.current,
            onplay: () => {
               if (
                  track.current !== audio ||
                  !ownsMusic.current ||
                  !musicEnabled.current
               ) {
                  audio.pause();
               }
            },
            onend: () => {
               if (track.current !== audio) return;
               audio.unload();
               const next = loadNextTrack();
               if (musicEnabled.current && ownsMusic.current) {
                  musicId.current = next.play();
               }
            },
            onplayerror: () => {
               audio.once("unlock", () => {
                  if (
                     track.current === audio &&
                     musicEnabled.current &&
                     ownsMusic.current &&
                     !audio.playing()
                  )
                     musicId.current = audio.play(musicId.current);
               });
            },
         });
         track.current = audio;
         return audio;
      };
      loadNextTrack();
      return () => {
         track.current?.unload();
         track.current = null;
      };
   }, []);
   useEffect(() => {
      track.current?.volume(musicVolume);
   }, [musicVolume]);
   useEffect(() => {
      if (!music) return;
      return requestMusicPlayback((owner) => {
         ownsMusic.current = owner;
         if (owner) resumeMusic();
         else track.current?.pause();
      });
   }, [music, resumeMusic]);
   useEffect(() => {
      // Persist the migrated music level before the effects slider changes.
      writeStorage(MUSIC_VOLUME_KEY, musicVolume);
   }, [musicVolume]);
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
