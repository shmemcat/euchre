import { createContext, useContext, useState, type ReactNode } from "react";
import { readStorage, writeStorage } from "@/lib/storage";
import type { HardLevel } from "@/game/ai";
export type Preferences = {
   hardLevel: HardLevel;
   cardStyle: "celestial" | "classic";
   playerName: string;
};
const DEFAULTS: Preferences = {
   hardLevel: "hard",
   cardStyle: "celestial",
   playerName: "You",
};
function loadPreferences(): Preferences {
   const value = readStorage<Partial<Preferences> | null>(
      "euchre.preferences.v1",
      null
   );
   return {
      hardLevel:
         value && ["hard", "harder", "hardest"].includes(value.hardLevel ?? "")
            ? value.hardLevel!
            : "hard",
      cardStyle: value?.cardStyle === "classic" ? "classic" : "celestial",
      playerName:
         typeof value?.playerName === "string"
            ? value.playerName.trim().slice(0, 24) || "You"
            : "You",
   };
}
const Context = createContext<{
   preferences: Preferences;
   update: (value: Partial<Preferences>) => void;
   saved: boolean;
} | null>(null);
export function PreferencesProvider({ children }: { children: ReactNode }) {
   const [preferences, setPreferences] = useState(loadPreferences);
   const [saved, setSaved] = useState(true);
   const update = (value: Partial<Preferences>) => {
      const next = { ...preferences, ...value };
      setPreferences(next);
      setSaved(writeStorage("euchre.preferences.v1", next));
   };
   return (
      <Context.Provider value={{ preferences, update, saved }}>
         {children}
      </Context.Provider>
   );
}
export function usePreferences() {
   const value = useContext(Context);
   if (!value) throw new Error("Missing PreferencesProvider");
   return value;
}
